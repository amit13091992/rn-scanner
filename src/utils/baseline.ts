import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { SecurityScanResult, VulnerabilitySeverity } from '../types/vulnerability.js';

export const BASELINE_FILENAME = '.rn-dep-scanner-baseline.json';

export interface BaselineFinding {
  key: string;
  package: string;
  version: string;
  id: string;
  severity: VulnerabilitySeverity;
  summary: string;
}

export interface BaselineFile {
  createdAt: string;
  /** "<package>@<version>:<vulnerability id>" keys — one per known finding at baseline time. */
  entries: string[];
  /** Human-readable detail for each entry, so a later run can say what was accepted and what has
   *  since been fixed. Absent in baselines written by older versions — `entries` stays authoritative. */
  findings?: BaselineFinding[];
}

export interface BaselineDiff {
  /** Scan restricted to findings not present in the baseline. */
  newFindings: SecurityScanResult;
  /** Baselined findings that are still present in the current scan. */
  unchanged: number;
  /** Baselined keys that no longer appear in the current scan (fixed, upgraded away, or removed). */
  resolved: Array<string | BaselineFinding>;
}

export function severityCounts(results: SecurityScanResult['results']): Record<VulnerabilitySeverity, number> {
  const counts: Record<VulnerabilitySeverity, number> = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const r of results) for (const v of r.vulnerabilities) counts[v.severity]++;
  return counts;
}

function findingKey(pkg: string, version: string, vulnId: string): string {
  return `${pkg}@${version}:${vulnId}`;
}

/**
 * Snapshots a security scan's current findings into a baseline file. Scoped to security
 * vulnerabilities specifically (not every `check` issue category) — vulnerability findings are
 * the ones with a stable, unambiguous identity (package + version + advisory ID) to diff
 * against later; a compatibility warning or breaking-change flag doesn't have an equally clean
 * identity to track across runs.
 */
export function createBaseline(securityResult: SecurityScanResult): BaselineFile {
  const findings: BaselineFinding[] = [];
  for (const result of securityResult.results) {
    for (const vuln of result.vulnerabilities) {
      findings.push({
        key: findingKey(result.package, result.version, vuln.id),
        package: result.package,
        version: result.version,
        id: vuln.id,
        severity: vuln.severity,
        summary: vuln.summary,
      });
    }
  }
  findings.sort((a, b) => a.key.localeCompare(b.key));
  return { createdAt: new Date().toISOString(), entries: findings.map((f) => f.key), findings };
}

/**
 * Filters a security scan down to only the findings not present in `baseline` — a package
 * upgrade that resolves a baselined vulnerability naturally drops out (its key no longer
 * appears in the current scan at all), and a genuinely new vulnerability (new package, new
 * advisory against an existing package) is what's left.
 */
export function diffAgainstBaseline(securityResult: SecurityScanResult, baseline: BaselineFile): SecurityScanResult {
  const known = new Set(baseline.entries);
  const results = securityResult.results
    .map((r) => ({
      ...r,
      vulnerabilities: r.vulnerabilities.filter((v) => !known.has(findingKey(r.package, r.version, v.id))),
    }))
    .filter((r) => r.vulnerabilities.length > 0);

  return { ...securityResult, results };
}

/** `diffAgainstBaseline` plus the two numbers a reviewer needs next to it: how many accepted
 *  findings are still present, and which accepted findings have since disappeared. */
export function diffBaselineDetailed(securityResult: SecurityScanResult, baseline: BaselineFile): BaselineDiff {
  const newFindings = diffAgainstBaseline(securityResult, baseline);
  const current = new Set<string>();
  for (const r of securityResult.results) for (const v of r.vulnerabilities) current.add(findingKey(r.package, r.version, v.id));

  const detailByKey = new Map((baseline.findings ?? []).map((f) => [f.key, f]));
  const resolved = baseline.entries.filter((key) => !current.has(key)).map((key) => detailByKey.get(key) ?? key);
  return { newFindings, unchanged: baseline.entries.length - resolved.length, resolved };
}

/** Reads and validates a baseline file. A truncated, hand-edited or merge-conflicted file is
 *  reported as `corrupt` with a reason instead of throwing, so `--create` can replace it and a
 *  check can say exactly what is wrong. */
export function readBaselineFile(path: string): { status: 'missing' } | { status: 'ok'; baseline: BaselineFile } | { status: 'corrupt'; reason: string } {
  if (!existsSync(path)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BaselineFile>;
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.some((e) => typeof e !== 'string')) {
      return { status: 'corrupt', reason: 'missing or invalid "entries" array' };
    }
    return { status: 'ok', baseline: { createdAt: String(parsed.createdAt ?? 'unknown'), entries: parsed.entries, ...(Array.isArray(parsed.findings) ? { findings: parsed.findings } : {}) } };
  } catch (error) {
    return { status: 'corrupt', reason: error instanceof Error ? error.message : 'not valid JSON' };
  }
}

/** Write-then-rename so an interrupted run can never leave a half-written baseline behind. */
export function writeBaselineFile(path: string, baseline: BaselineFile): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
  renameSync(tmp, path);
}
