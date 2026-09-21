import { queryVulnerabilities } from '../services/osvClient.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import type { PackageVulnerabilityResult, SecurityScanResult, VulnerabilitySeverity } from '../types/vulnerability.js';

export interface SecurityAnalysisResult extends SecurityScanResult {
  summary: Record<VulnerabilitySeverity, number>;
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
  graph?: DependencyGraph | null
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

  const summary: Record<VulnerabilitySeverity, number> = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    unknown: 0,
  };

  for (const result of scan.results) {
    for (const vuln of result.vulnerabilities) {
      summary[vuln.severity]++;
    }
  }

  return { ...scan, summary };
}
