import type { DependencyInfo } from '../types/dependency.js';
import { versionInRange } from '../utils/versionComparison.js';
import { readInstalledDependencyManifest } from '../detectors/dependencyCompleteness.js';

/** A version-range spec that isn't resolvable semver (workspace/npm/file/git/link protocol
 *  references, or a bare "*"/"latest") — evaluating it against a target version can't produce
 *  a trustworthy true/false, so callers must report "unknown", never guess. */
function isUnresolvableRange(range: string): boolean {
  return /:|^\*$|^latest$/.test(range);
}

export interface WhyNotConstraint {
  /** Name of the package imposing this constraint, or "package.json" for the root project's own declared range. */
  requiredBy: string;
  kind: 'root-declared' | 'peerDependency' | 'dependency';
  range: string;
  /** null when `range` isn't a resolvable semver range (ADR-0004: uncertainty representable, never defaulted to true/false). */
  satisfied: boolean | null;
}

export interface WhyNotResult {
  package: string;
  targetVersion: string;
  installable: boolean;
  constraints: WhyNotConstraint[];
  blockers: WhyNotConstraint[];
}

function evaluate(range: string, targetVersion: string): boolean | null {
  if (isUnresolvableRange(range)) return null;
  return versionInRange(targetVersion, range);
}

/**
 * Explains why a specific version of `packageName` can or can't be installed: checks the root
 * project's own declared range, then every other installed package's own `peerDependencies`/
 * `dependencies` entry for `packageName` (read from its actual installed manifest under
 * `node_modules`, not the root `package.json` — matching `dependencyCompleteness`'s convention
 * of trusting what's actually installed). A constraint whose range can't be resolved to real
 * semver (a workspace/npm/git reference) is reported as unknown, not silently passed.
 */
export function analyzeWhyNot(
  cwd: string,
  dependencies: DependencyInfo[],
  packageName: string,
  targetVersion: string
): WhyNotResult {
  const constraints: WhyNotConstraint[] = [];

  const rootDeclared = dependencies.find((d) => d.name === packageName);
  if (rootDeclared) {
    constraints.push({
      requiredBy: 'package.json',
      kind: 'root-declared',
      range: rootDeclared.requestedVersion,
      satisfied: evaluate(rootDeclared.requestedVersion, targetVersion),
    });
  }

  for (const dep of dependencies) {
    if (dep.name === packageName) continue;
    const manifest = readInstalledDependencyManifest(cwd, dep.name);
    if (!manifest) continue;

    const peerRange = manifest.peerDependencies[packageName];
    if (peerRange) {
      constraints.push({
        requiredBy: dep.name,
        kind: 'peerDependency',
        range: peerRange,
        satisfied: evaluate(peerRange, targetVersion),
      });
    }

    const depRange = manifest.dependencies[packageName];
    if (depRange) {
      constraints.push({
        requiredBy: dep.name,
        kind: 'dependency',
        range: depRange,
        satisfied: evaluate(depRange, targetVersion),
      });
    }
  }

  const blockers = constraints.filter((c) => c.satisfied === false);

  return {
    package: packageName,
    targetVersion,
    installable: blockers.length === 0,
    constraints,
    blockers,
  };
}
