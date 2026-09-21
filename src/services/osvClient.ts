import { coerce, gt as semverGt, gte as semverGte, lt as semverLt } from 'semver';
import type { RawPackageVulnerabilityResult, RawSecurityScanResult, VulnerabilityInfo, VulnerabilitySeverity } from '../types/vulnerability.js';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns/';
const TIMEOUT_MS = 8000;
const DETAIL_CONCURRENCY = 10;

interface OsvBatchQuery {
  package: { name: string; ecosystem: 'npm' };
  version: string;
}

interface OsvBatchResultEntry {
  vulns?: { id: string }[];
}

interface OsvBatchResponse {
  results?: OsvBatchResultEntry[];
}

interface OsvAffectedRange {
  events?: { introduced?: string; fixed?: string }[];
}

interface OsvAffected {
  package?: { name?: string; ecosystem?: string };
  ranges?: OsvAffectedRange[];
}

interface OsvVulnRecord {
  id: string;
  summary?: string;
  details?: string;
  affected?: OsvAffected[];
  references?: { url?: string }[];
  database_specific?: { severity?: string };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OSV's `severity[].score` field for a CVSS entry is the raw vector string (e.g.
 * "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), not a bare numeric score — deriving a
 * severity bucket from it would require actually implementing CVSS scoring, which this
 * project doesn't do. `database_specific.severity` (a plain LOW/MODERATE/HIGH/CRITICAL
 * string, populated for GHSA-sourced advisories, which covers the vast majority of npm
 * ecosystem entries in OSV) is the only source used — anything without it is honestly
 * reported as 'unknown' rather than guessed at.
 */
export function parseOsvSeverity(record: OsvVulnRecord): VulnerabilitySeverity {
  const explicit = record.database_specific?.severity?.toLowerCase();
  if (explicit === 'critical' || explicit === 'high' || explicit === 'moderate' || explicit === 'low') {
    return explicit;
  }
  return 'unknown';
}

/**
 * An OSV record can carry multiple `ranges` for the same package (e.g. one "fixed in 1.5.0"
 * for the 1.x line and another "fixed in 2.3.0" for the 2.x line). Picking the first `fixed`
 * event seen — regardless of which range the installed version actually falls in — can
 * report a fix version the project is already past. This walks each range's [introduced,
 * fixed) interval and only returns a fix version whose interval actually contains
 * `installedVersion`; if none match (e.g. the version couldn't be parsed), it falls back to
 * the smallest fixed version that is still ahead of the installed one, rather than an
 * arbitrary first match.
 */
export function extractFixedVersion(
  record: OsvVulnRecord,
  packageName: string,
  installedVersion?: string
): string | undefined {
  const installed = installedVersion ? coerce(installedVersion) : null;
  const candidateFixes: string[] = [];

  for (const affected of record.affected ?? []) {
    if (affected.package?.name !== packageName) continue;
    for (const range of affected.ranges ?? []) {
      let introduced: string | undefined;
      for (const event of range.events ?? []) {
        if (event.introduced !== undefined) introduced = event.introduced;
        if (!event.fixed) continue;

        candidateFixes.push(event.fixed);

        if (!installed) continue;
        const fixedCoerced = coerce(event.fixed);
        const introducedCoerced = introduced ? coerce(introduced) : null;
        if (!fixedCoerced) continue;
        const withinLowerBound = !introducedCoerced || semverGte(installed, introducedCoerced);
        if (withinLowerBound && semverLt(installed, fixedCoerced)) {
          return event.fixed;
        }
      }
    }
  }

  // No range's interval matched the installed version (unparseable version, or the OSV data
  // doesn't actually cover it) — fall back to the smallest fixed version ahead of installed.
  if (installed) {
    const ahead = candidateFixes
      .filter((v) => {
        const c = coerce(v);
        return c && semverGt(c, installed);
      })
      .sort((a, b) => (semverGt(coerce(a)!, coerce(b)!) ? 1 : -1));
    // Installed version is past every known fix (or no interval data at all) — there's
    // nothing meaningfully "ahead" to recommend.
    return ahead.length > 0 ? ahead[0] : undefined;
  }

  // No installed version was supplied at all — best effort, same as the old behavior.
  return candidateFixes[0];
}

export function parseOsvRecord(record: OsvVulnRecord, packageName: string, installedVersion?: string): VulnerabilityInfo {
  return {
    id: record.id,
    summary: record.summary || record.details || 'No summary available',
    severity: parseOsvSeverity(record),
    fixedVersion: extractFixedVersion(record, packageName, installedVersion),
    references: (record.references ?? []).map((r) => r.url).filter((url): url is string => !!url),
  };
}

/**
 * Queries OSV.dev for known vulnerabilities affecting the given npm packages at their
 * resolved versions. Two-phase: a single batch query for matching vulnerability IDs, then a
 * concurrency-limited detail fetch per unique ID (the batch endpoint only returns bare IDs,
 * not full records). Never throws — a network failure at either phase degrades to
 * `{ scanned: false, error, results: [] }` rather than failing the whole `check` run.
 */
export async function queryVulnerabilities(
  packages: { name: string; version: string }[]
): Promise<RawSecurityScanResult> {
  const queryable = packages.filter((p) => !!p.version);
  if (queryable.length === 0) {
    return { scanned: true, results: [] };
  }

  const queries: OsvBatchQuery[] = queryable.map((p) => ({
    package: { name: p.name, ecosystem: 'npm' },
    version: p.version,
  }));

  const batchResponse = await fetchJson<OsvBatchResponse>(OSV_BATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  });

  if (!batchResponse) {
    return { scanned: false, error: 'Could not reach OSV.dev (network unavailable or request failed)', results: [] };
  }

  const batchResults = batchResponse.results ?? [];
  const idsByPackageIndex: string[][] = batchResults.map((entry) => (entry.vulns ?? []).map((v) => v.id));
  const allIds = new Set(idsByPackageIndex.flat());

  const detailsById = new Map<string, OsvVulnRecord>();
  const idQueue = [...allIds];

  async function detailWorker() {
    while (idQueue.length > 0) {
      const id = idQueue.shift();
      if (!id) break;
      const record = await fetchJson<OsvVulnRecord>(`${OSV_VULN_URL}${id}`);
      if (record) detailsById.set(id, record);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, idQueue.length) }, detailWorker)
  );

  const results: RawPackageVulnerabilityResult[] = [];
  queryable.forEach((pkg, index) => {
    const ids = idsByPackageIndex[index] ?? [];
    const vulnerabilities = ids
      .map((id) => detailsById.get(id))
      .filter((record): record is OsvVulnRecord => !!record)
      .map((record) => parseOsvRecord(record, pkg.name, pkg.version));

    if (vulnerabilities.length > 0) {
      results.push({ package: pkg.name, version: pkg.version, vulnerabilities });
    }
  });

  return { scanned: true, results };
}
