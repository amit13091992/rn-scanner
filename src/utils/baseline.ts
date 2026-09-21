import type { SecurityScanResult } from '../types/vulnerability.js';

export const BASELINE_FILENAME = '.rn-dep-scanner-baseline.json';

export interface BaselineFile {
  createdAt: string;
  /** "<package>@<version>:<vulnerability id>" keys — one per known finding at baseline time. */
  entries: string[];
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
  const entries: string[] = [];
  for (const result of securityResult.results) {
    for (const vuln of result.vulnerabilities) {
      entries.push(findingKey(result.package, result.version, vuln.id));
    }
  }
  return { createdAt: new Date().toISOString(), entries: entries.sort() };
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
