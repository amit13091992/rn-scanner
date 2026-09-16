import { queryVulnerabilities } from '../services/osvClient.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { SecurityScanResult, VulnerabilitySeverity } from '../types/vulnerability.js';

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
 */
export async function analyzeSecurityVulnerabilities(
  dependencies: DependencyInfo[]
): Promise<SecurityAnalysisResult> {
  const packages = dependencies
    .map((d) => ({ name: d.name, version: resolveQueryableVersion(d) }))
    .filter((p): p is { name: string; version: string } => p.version !== null);

  const scan = await queryVulnerabilities(packages);

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
