import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstalledManifest {
  version: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
}

interface RawManifest {
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function readManifestAt(packageJsonPath: string): InstalledManifest | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as RawManifest;
    return {
      version: raw.version ?? '',
      dependencies: raw.dependencies ?? {},
      peerDependencies: raw.peerDependencies ?? {},
      peerDependenciesMeta: raw.peerDependenciesMeta ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Reads a package's own package.json as actually installed under node_modules — not what
 * the root project declared, but what that package itself asks for. Returns null when the
 * package isn't installed at all (separate concern from this check) or its manifest can't
 * be parsed (caller should surface that as "not checked", not silently skip it).
 */
export function readInstalledDependencyManifest(cwd: string, packageName: string): InstalledManifest | null {
  return readManifestAt(join(cwd, 'node_modules', packageName, 'package.json'));
}

/**
 * Resolves whether `dependencyName` is actually installed somewhere node's own module
 * resolution would find it from `parentName`'s install location: nested under the parent
 * (node_modules/<parent>/node_modules/<dep>) first, since npm/yarn/pnpm all nest a
 * dependency there when hoisting to the root would conflict, then hoisted to the project
 * root (node_modules/<dep>).
 */
export function resolveInstalledVersion(cwd: string, parentName: string, dependencyName: string): string | null {
  const nested = readManifestAt(join(cwd, 'node_modules', parentName, 'node_modules', dependencyName, 'package.json'));
  if (nested) return nested.version || null;

  const hoisted = readManifestAt(join(cwd, 'node_modules', dependencyName, 'package.json'));
  if (hoisted) return hoisted.version || null;

  return null;
}
