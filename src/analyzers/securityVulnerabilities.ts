import { queryVulnerabilities } from '../services/osvClient.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import type { PackageVulnerabilityResult, SecurityScanResult, VulnerabilitySeverity } from '../types/vulnerability.js';
import { matchKnownMalwarePackages } from '../data/knownMalwarePackages.js';
import { loadMalwareFeed, type MalwareFeedLoad } from '../services/malwareFeed.js';

export interface SecurityAnalysisResult extends SecurityScanResult {
  summary: Record<VulnerabilitySeverity, number>;
  /** Present only when a `knownMalwareFeed` is configured. */
  malwareFeed?: Pick<MalwareFeedLoad, 'source' | 'skipped' | 'error'> & { entries: number };
}

/**
 * Resolves the exact installed version to query OSV with, or null if none is known.
 * Prefers `resolvedVersion` (what the lockfile actually installed) since that's always an
 * exact pin. Falls back to `requestedVersion` only when it is *itself* already an exact
 * version (e.g. "0.82.1", no range operator) — a range/wildcard/protocol reference
 * (`^1.2.3`, `*`, `latest`, `workspace:*`, `npm:`, `1.0.0 || 2.0.0`, ...) can't be resolved
 * to one real installed version, and querying OSV with a mangled guess would risk silently
 * reporting "no known vulnerabilities" for a package that was never actually checked —
 * worse than skipping it outright for a security feature.
 */
function resolveQueryableVersion(dep: DependencyInfo): string | null {
  const resolved = dep.resolvedVersion?.trim();
  if (resolved) return resolved;

  const requested = dep.requestedVersion?.trim();
  if (requested && /^\d+\.\d+\.\d+/.test(requested)) return requested;

  return null;
}

/**
 * Checks resolved dependency versions against OSV.dev. Uses `resolvedVersion` (what the
 * lockfile actually installed) over `requestedVersion` (the package.json range) — matching
 * this project's established convention that security-relevant checks operate on what's
 * actually installed, not what's declared.
 *
 * When `graph` is supplied (from `buildDependencyGraph`), every unique (name, version) pair
 * reachable anywhere in the dependency tree is scanned — not just `package.json`'s direct
 * dependencies — so a vulnerable package several levels deep (e.g. `eslint > file-entry-cache >
 * flat-cache > keyv`) is still caught. For npm this is a complete transitive scan
 * (`graph.hierarchyComplete === true`); for yarn/pnpm/bun the graph is direct-dependency-only
 * today, so coverage there is unchanged from a `dependencies`-only scan. When no graph is
 * available at all, falls back to `dependencies` alone with `direct: true`/`paths: []` — never
 * silently claiming "not direct" or "no path" as if that were confirmed.
 */
export async function analyzeSecurityVulnerabilities(
  dependencies: DependencyInfo[],
  ignoreVulnerabilityIds: string[] = [],
  graph?: DependencyGraph | null,
  /** `knownMalwareFeed` from the config, and the directory a relative path resolves against. */
  malwareFeed?: { source: string | undefined; cwd: string }
): Promise<SecurityAnalysisResult> {
  const graphVersions = graph ? collectAllPackageVersions(graph) : null;

  const packages = graphVersions
    ? graphVersions.map((v) => ({ name: v.name, version: v.version }))
    : dependencies
        .map((d) => ({ name: d.name, version: resolveQueryableVersion(d) }))
        .filter((p): p is { name: string; version: string } => p.version !== null);

  const rawScan = await queryVulnerabilities(packages);

  const metaByKey = new Map(
    (graphVersions ?? []).map((v) => [`${v.name}@${v.version}`, { direct: v.direct, paths: v.paths }])
  );
  const withGraphMeta: PackageVulnerabilityResult[] = rawScan.results.map((r) => {
    const meta = metaByKey.get(`${r.package}@${r.version}`);
    return { ...r, direct: meta?.direct ?? true, paths: meta?.paths ?? [] };
  });
  const scanWithMeta: SecurityScanResult = { ...rawScan, results: withGraphMeta };

  // Accepted-risk suppression (.rn-dep-scanner.json ignoreVulnerabilities): drop specific
  // advisory IDs, and drop a package entirely if that removes its last remaining vulnerability
  // — never invent a "clean" scan when the scan itself failed (scanned: false is untouched).
  const ignoreSet = new Set(ignoreVulnerabilityIds);
  const scan: SecurityScanResult = ignoreSet.size === 0
    ? scanWithMeta
    : {
        ...scanWithMeta,
        results: scanWithMeta.results
          .map((r) => ({ ...r, vulnerabilities: r.vulnerabilities.filter((v) => !ignoreSet.has(v.id)) }))
          .filter((r) => r.vulnerabilities.length > 0),
      };

  // Known-malware check runs locally regardless of whether the OSV.dev network call succeeded —
  // closes the gap where a live worm-strain incident (e.g. Mini Shai-Hulud) hasn't been given
  // a GHSA ID yet, so OSV wouldn't surface it even with network access. Merged into the same
  // `results` shape rather than a parallel field, so every existing consumer (check/security
  // commands, --json, baseline/policy) sees it without new wiring.
  const feed = malwareFeed?.source ? await loadMalwareFeed(malwareFeed.source, malwareFeed.cwd) : null;
  const malwareMatches = matchKnownMalwarePackages(packages, feed?.entries ?? []);
  const resultsWithMalware: PackageVulnerabilityResult[] = [...scan.results];
  for (const match of malwareMatches) {
    const meta = metaByKey.get(`${match.package}@${match.version}`);
    const vuln = {
      id: `RNDS-MALWARE-${match.package}@${match.version}`,
      summary: `${match.incident}: ${match.summary}`,
      severity: 'critical' as VulnerabilitySeverity,
      references: [match.reference],
    };
    const existing = resultsWithMalware.find((r) => r.package === match.package && r.version === match.version);
    if (existing) {
      existing.vulnerabilities = [...existing.vulnerabilities, vuln];
    } else {
      resultsWithMalware.push({
        package: match.package,
        version: match.version,
        vulnerabilities: [vuln],
        direct: meta?.direct ?? true,
        paths: meta?.paths ?? [],
      });
    }
  }

  const summary: Record<VulnerabilitySeverity, number> = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    unknown: 0,
  };

  for (const result of resultsWithMalware) {
    for (const vuln of result.vulnerabilities) {
      summary[vuln.severity]++;
    }
  }

  return {
    ...scan,
    results: resultsWithMalware,
    summary,
    ...(feed ? { malwareFeed: { source: feed.source, entries: feed.entries.length, skipped: feed.skipped, ...(feed.error ? { error: feed.error } : {}) } } : {}),
  };
}
