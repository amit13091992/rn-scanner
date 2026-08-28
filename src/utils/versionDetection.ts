import type { DependencyInfo } from '../types/dependency.js';

export interface VersionMismatch {
  package: string;
  declared: string;
  installed?: string;
  latest?: string;
  hasMismatch: boolean;
  reason?: string;
}

export interface DuplicateDependency {
  package: string;
  versions: string[];
  severity: 'critical' | 'high' | 'medium';
}

export function detectVersionMismatches(dependencies: DependencyInfo[]): VersionMismatch[] {
  return dependencies
    .filter(dep => dep.resolvedVersion && dep.requestedVersion !== dep.resolvedVersion)
    .map(dep => ({
      package: dep.name,
      declared: dep.requestedVersion,
      installed: dep.resolvedVersion,
      latest: dep.latestVersion,
      hasMismatch: true,
      reason: `Declared ${dep.requestedVersion}, but ${dep.resolvedVersion} is installed`,
    }));
}

export function detectDuplicateDependencies(
  dependencies: DependencyInfo[]
): DuplicateDependency[] {
  const versionsByPackage = new Map<string, Set<string>>();

  dependencies.forEach(dep => {
    const version = dep.resolvedVersion || dep.requestedVersion;
    if (!versionsByPackage.has(dep.name)) {
      versionsByPackage.set(dep.name, new Set());
    }
    versionsByPackage.get(dep.name)!.add(version);
  });

  const duplicates: DuplicateDependency[] = [];

  versionsByPackage.forEach((versions, packageName) => {
    if (versions.size > 1) {
      const versionArray = Array.from(versions).sort();

      let severity: 'critical' | 'high' | 'medium' = 'medium';
      if (
        packageName === 'react' ||
        packageName === 'react-native' ||
        packageName.startsWith('react-native-')
      ) {
        severity = 'critical';
      } else if (packageName.startsWith('@react-navigation')) {
        severity = 'high';
      }

      duplicates.push({
        package: packageName,
        versions: versionArray,
        severity,
      });
    }
  });

  return duplicates.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

export function detectPeerDependencyConflicts(
  dependencies: DependencyInfo[]
): Array<{ package: string; conflict: string; dependents: string[] }> {
  const conflicts: Array<{ package: string; conflict: string; dependents: string[] }> = [];

  dependencies.forEach(dep => {
    if (!dep.peerDependencies) return;

    Object.entries(dep.peerDependencies).forEach(([peerName, peerRange]) => {
      const peerDep = dependencies.find(d => d.name === peerName);
      if (!peerDep) return;

      const version = peerDep.resolvedVersion || peerDep.requestedVersion;

      const rangeChars = peerRange.split('');
      let isCompatible = true;
      let reason = '';

      if (peerRange.startsWith('^')) {
        const baseParts = peerRange.slice(1).split('.');
        const depParts = version.split('.');
        if (baseParts[0] !== depParts[0]) {
          isCompatible = false;
          reason = `${peerName}@${peerRange} requires major version ${baseParts[0]}, but ${version} has ${depParts[0]}`;
        }
      } else if (peerRange.startsWith('~')) {
        const baseParts = peerRange.slice(1).split('.');
        const depParts = version.split('.');
        if (baseParts[0] !== depParts[0] || baseParts[1] !== depParts[1]) {
          isCompatible = false;
          reason = `${peerName}@${peerRange} requires version ${baseParts[0]}.${baseParts[1]}.x, but ${version} is installed`;
        }
      }

      if (!isCompatible) {
        const existing = conflicts.find(
          c => c.package === peerName && c.conflict === reason
        );
        if (existing) {
          existing.dependents.push(dep.name);
        } else {
          conflicts.push({
            package: peerName,
            conflict: reason,
            dependents: [dep.name],
          });
        }
      }
    });
  });

  return conflicts;
}

export function isReactNativeCompatible(
  reactNativeVersion: string,
  reactVersion: string
): { compatible: boolean; issue?: string } {
  const rnMajor = parseInt(reactNativeVersion.split('.')[0], 10);
  const reactMajor = parseInt(reactVersion.split('.')[0], 10);

  if (rnMajor === 0 && reactMajor >= 18) {
    return {
      compatible: false,
      issue: 'React Native 0.x requires React 16.x or 17.x, but React 18+ is installed',
    };
  }

  if (rnMajor >= 1 && reactMajor < 18) {
    return {
      compatible: false,
      issue: 'React Native 1.x+ requires React 18+, but older React is installed',
    };
  }

  return { compatible: true };
}
