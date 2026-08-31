import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export interface TransitiveDependency extends ResolvedDependency {
  depth: number;
  parents: string[];
  isDirect: boolean;
}

export interface TransitiveResolutionResult {
  dependencies: Map<string, TransitiveDependency>;
  conflicts: Array<{
    package: string;
    versions: string[];
    affectedBy: string[];
  }>;
}

export function resolveTransitiveDependencies(
  lockfile: ParsedLockfile,
  directDependencies: Set<string>
): TransitiveResolutionResult {
  const result: TransitiveResolutionResult = {
    dependencies: new Map(),
    conflicts: [],
  };

  const conflicts = new Map<string, Set<string>>();

  lockfile.dependencies.forEach((dep, packageName) => {
    const isDirect = directDependencies.has(packageName);

    const existing = result.dependencies.get(packageName);
    if (existing) {
      if (existing.resolvedVersion !== dep.resolvedVersion) {
        if (!conflicts.has(packageName)) {
          conflicts.set(packageName, new Set());
        }
        conflicts.get(packageName)!.add(dep.resolvedVersion);
        conflicts.get(packageName)!.add(existing.resolvedVersion);
      }
    } else {
      result.dependencies.set(packageName, {
        ...dep,
        depth: isDirect ? 0 : 1,
        parents: [],
        isDirect,
      });
    }
  });

  conflicts.forEach((versions, packageName) => {
    result.conflicts.push({
      package: packageName,
      versions: Array.from(versions),
      affectedBy: [],
    });
  });

  return result;
}

export function detectDuplicateVersions(
  transitive: TransitiveResolutionResult,
  criticalPackages: string[] = ['react', 'react-native']
): Array<{
  package: string;
  versions: string[];
  severity: 'critical' | 'high' | 'medium';
  reason: string;
}> {
  const duplicates: Array<{
    package: string;
    versions: string[];
    severity: 'critical' | 'high' | 'medium';
    reason: string;
  }> = [];

  transitive.conflicts.forEach((conflict) => {
    const severity = criticalPackages.includes(conflict.package) ? 'critical' : 'high';
    duplicates.push({
      package: conflict.package,
      versions: conflict.versions,
      severity,
      reason:
        severity === 'critical'
          ? `Multiple versions of ${conflict.package} detected - this causes React Native runtime errors`
          : `Multiple versions detected - may cause unexpected behavior`,
    });
  });

  return duplicates;
}
