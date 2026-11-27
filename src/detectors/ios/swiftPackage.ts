import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../../utils/projectRoot.js';

export interface IosPackagingFiles {
  podspec: boolean;
  packageSwift: boolean;
}

function hasPodspec(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith('.podspec'));
  } catch {
    return false;
  }
}

/**
 * Which iOS packaging manifests an installed package ships: a `*.podspec` (CocoaPods) and/or a
 * `Package.swift` (Swift Package Manager), at the package root or under `ios/`. Returns null when
 * the package is not installed at the hoisted `node_modules/<name>` location (unknown, not "none").
 * Static file checks only — nothing in the package is executed.
 */
export function detectIosPackagingFiles(cwd: string, packageName: string): IosPackagingFiles | null {
  const packageDir = join(resolveDependencyRoot(cwd), 'node_modules', packageName);
  if (!existsSync(packageDir)) return null;
  const dirs = [packageDir, join(packageDir, 'ios')];
  return {
    podspec: dirs.some(hasPodspec),
    packageSwift: dirs.some((d) => existsSync(join(d, 'Package.swift'))),
  };
}
