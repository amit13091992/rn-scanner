import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { readInstalledPackageLicense } from '../detectors/license.js';

export interface PackageLicenseResult {
  name: string;
  version: string;
  /** null when no license field could be read from the installed manifest — distinct from an
   *  empty string, and never guessed at (ADR-0004). */
  license: string | null;
}

export interface LicenseAnalysisResult {
  results: PackageLicenseResult[];
  /** Package names grouped by license identifier, for a quick "what licenses am I shipping" scan. */
  byLicense: Record<string, string[]>;
  /** Packages whose license matches an entry in the configured denylist (case-insensitive). */
  denied: PackageLicenseResult[];
  /** Packages with no readable license at all — worth a manual look, not necessarily a problem. */
  unknown: PackageLicenseResult[];
}

/**
 * Reads each installed dependency's own declared license and cross-references it against an
 * optional denylist (`.rn-dep-scanner.json`'s `licenseDenylist`, e.g. `["GPL-3.0", "AGPL-3.0"]`
 * for a project that can't ship copyleft-licensed code). Matching is case-insensitive and
 * exact against the license identifier as declared — it does not parse SPDX expression syntax
 * (`(MIT OR Apache-2.0)`), so a package using an SPDX expression is reported under that literal
 * string rather than split into its component licenses.
 *
 * When `graph` is supplied, every package in the full transitive dependency tree is covered
 * (same convention as the security analyzer) rather than just `package.json`'s direct
 * dependencies — a copyleft license three levels deep is just as much a legal-review problem
 * as one in a direct dependency.
 */
export function analyzeLicenses(
  cwd: string,
  dependencies: DependencyInfo[],
  denylist: string[] = [],
  graph?: DependencyGraph | null
): LicenseAnalysisResult {
  const denySet = new Set(denylist.map((l) => l.toLowerCase()));
  const packages = graph
    ? collectAllPackageVersions(graph).map((v) => ({ name: v.name, version: v.version }))
    : dependencies.map((dep) => ({ name: dep.name, version: dep.resolvedVersion || dep.requestedVersion }));

  const results: PackageLicenseResult[] = packages.map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    license: readInstalledPackageLicense(cwd, pkg.name),
  }));

  const byLicense: Record<string, string[]> = {};
  for (const r of results) {
    const key = r.license ?? 'UNKNOWN';
    (byLicense[key] ??= []).push(r.name);
  }

  const denied = results.filter((r) => r.license && denySet.has(r.license.toLowerCase()));
  const unknown = results.filter((r) => !r.license);

  return { results, byLicense, denied, unknown };
}
