import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { versionInRange } from '../utils/versionComparison.js';
import { readInstalledDependencyManifest, resolveInstalledVersion } from '../detectors/dependencyCompleteness.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyCompletenessResult, MissingDependency } from '../types/dependencyCompleteness.js';

function checkOne(
  cwd: string,
  parent: string,
  parentVersion: string,
  dependency: string,
  requiredRange: string,
  kind: MissingDependency['kind'],
  optional: boolean
): MissingDependency | null {
  const installedVersion = resolveInstalledVersion(cwd, parent, dependency);

  if (installedVersion === null) {
    return { parent, parentVersion, dependency, requiredRange, installedVersion: null, kind, optional };
  }

  if (!versionInRange(installedVersion, requiredRange)) {
    return { parent, parentVersion, dependency, requiredRange, installedVersion, kind, optional };
  }

  return null;
}

/**
 * For each installed top-level dependency, reads that package's own package.json (as
 * actually installed under node_modules, not what the root project declared) and verifies
 * its dependencies/peerDependencies are themselves resolvable and version-satisfied. Catches
 * both real installation gaps (partial install, npm link, CI cache staleness) and the
 * yarn/pnpm/bun transitive-graph blind spot noted in known-limitations.md, since this reads
 * node_modules directly rather than relying on a lockfile hierarchy.
 */
export function analyzeDependencyCompleteness(
  cwd: string,
  dependencies: DependencyInfo[]
): DependencyCompletenessResult {
  const missing: MissingDependency[] = [];
  const notChecked: DependencyCompletenessResult['notChecked'] = [];

  for (const dep of dependencies) {
    const installedPath = join(cwd, 'node_modules', dep.name, 'package.json');
    if (!existsSync(installedPath)) {
      // Not installed at all — a different, existing check's job (declared vs. installed).
      continue;
    }

    const manifest = readInstalledDependencyManifest(cwd, dep.name);
    if (!manifest) {
      notChecked.push({ parent: dep.name, reason: 'Could not read or parse its installed package.json' });
      continue;
    }

    for (const [depName, range] of Object.entries(manifest.dependencies)) {
      const result = checkOne(cwd, dep.name, manifest.version, depName, range, 'dependency', false);
      if (result) missing.push(result);
    }

    for (const [peerName, range] of Object.entries(manifest.peerDependencies)) {
      const optional = manifest.peerDependenciesMeta[peerName]?.optional === true;
      const result = checkOne(cwd, dep.name, manifest.version, peerName, range, 'peerDependency', optional);
      if (result) missing.push(result);
    }
  }

  return { missing, notChecked };
}
