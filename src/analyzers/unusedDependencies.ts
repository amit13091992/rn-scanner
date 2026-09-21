import type { DependencyInfo } from '../types/dependency.js';
import { isToolingOnlyPackage } from '../data/toolingOnlyPackages.js';
import { walkSourceFiles } from '../utils/sourceFiles.js';

// Both plain requires/imports (`require('pkg')`, `from 'pkg'`) and dynamic `import('pkg')`.
const IMPORT_PATTERN = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:from|import)\s+['"]([^'"]+)['"]/g;

/**
 * Extracts the package name a module specifier resolves to: scoped packages keep their first
 * two path segments (`@scope/name`), everything else keeps its first segment
 * (`name/lib/thing` -> `name`). Relative/absolute specifiers aren't packages at all.
 */
function specifierToPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const segments = specifier.split('/');
  if (specifier.startsWith('@') && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? null;
}

function collectImportedPackageNames(cwd: string): { imported: Set<string>; filesScanned: number } {
  const imported = new Set<string>();

  const { filesScanned } = walkSourceFiles(cwd, (_filePath, content) => {
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const packageName = specifierToPackageName(specifier);
      if (packageName) imported.add(packageName);
    }
  });

  return { imported, filesScanned };
}

export interface UnusedDependencyResult {
  name: string;
  type: DependencyInfo['type'];
}

export interface UnusedDependenciesResult {
  unused: UnusedDependencyResult[];
  /** Packages excluded from the scan as known tooling-only (never imported from source) — for
   *  transparency about what was deliberately not flagged, not itself a problem to report. */
  excludedAsTooling: string[];
  filesScanned: number;
}

/**
 * Flags declared dependencies with no detected `require`/`import` anywhere in project source.
 * Heuristic, not proof: a package used only from a config file (Metro, Babel, native build
 * scripts) that isn't in `data/toolingOnlyPackages.ts`'s curated exclude list will still be a
 * false positive here — this is a starting point for manual review, not an automatic-removal
 * tool, so results are reported as "no import found", never as "safe to delete".
 */
export function analyzeUnusedDependencies(cwd: string, dependencies: DependencyInfo[]): UnusedDependenciesResult {
  const { imported, filesScanned } = collectImportedPackageNames(cwd);

  const unused: UnusedDependencyResult[] = [];
  const excludedAsTooling: string[] = [];

  for (const dep of dependencies) {
    if (dep.type === 'peerDependency' || dep.type === 'optionalDependency') continue;
    if (isToolingOnlyPackage(dep.name)) {
      excludedAsTooling.push(dep.name);
      continue;
    }
    if (!imported.has(dep.name)) {
      unused.push({ name: dep.name, type: dep.type });
    }
  }

  return { unused, excludedAsTooling, filesScanned };
}
