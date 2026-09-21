import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DependencyInfo } from '../types/dependency.js';
import { isToolingOnlyPackage } from '../data/toolingOnlyPackages.js';

// `ios`/`android`/`Pods` are excluded outright (native project trees with no JS/TS source to
// scan, and `ios/Pods` or `android/build` can be enormous) rather than relying on the
// extension filter alone to skip them efficiently.
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.expo', '.next', 'ios', 'android', 'Pods']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
// Both plain requires/imports (`require('pkg')`, `from 'pkg'`) and dynamic `import('pkg')`.
const IMPORT_PATTERN = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:from|import)\s+['"]([^'"]+)['"]/g;
const MAX_FILES_SCANNED = 5000;

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

/**
 * Walks project source files (excluding node_modules and common build output dirs) collecting
 * every package name referenced via `require`/`import`. Deliberately regex-based rather than a
 * full AST parse — consistent with this project's "prefer deterministic analysis, profile
 * before adding complexity" performance rule — so it can pick up a false negative on unusual
 * syntax (a computed require, a re-exported barrel) but never crashes on a file it can't parse.
 * Capped at `MAX_FILES_SCANNED` so a huge project degrades to a partial (not stalled) scan.
 */
function collectImportedPackageNames(cwd: string): { imported: Set<string>; filesScanned: number } {
  const imported = new Set<string>();
  let filesScanned = 0;

  function walk(dir: string): void {
    if (filesScanned >= MAX_FILES_SCANNED) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= MAX_FILES_SCANNED) return;
      if (entry.startsWith('.') && !entry.startsWith('.expo') && !entry.startsWith('.next')) continue;
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry)) continue;
        walk(fullPath);
        continue;
      }

      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      filesScanned++;
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;
        const packageName = specifierToPackageName(specifier);
        if (packageName) imported.add(packageName);
      }
    }
  }

  walk(cwd);
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
