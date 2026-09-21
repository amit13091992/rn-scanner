import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// `ios`/`android`/`Pods` are excluded outright (native project trees with no JS/TS source to
// scan, and `ios/Pods` or `android/build` can be enormous) rather than relying on the
// extension filter alone to skip them efficiently.
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.expo', '.next', 'ios', 'android', 'Pods']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const DEFAULT_MAX_FILES = 5000;

/**
 * Walks project source files (excluding `node_modules`, native project trees, and common build
 * output dirs) and invokes `onFile` with each file's path and content. Shared by every
 * source-scanning analyzer (`unusedDependencies`, `legacyApiUsage`) so they all apply the same
 * exclude list and file cap rather than drifting apart. Deliberately a plain directory walk
 * with no parsing here — each caller decides how to read the content (regex, etc.), consistent
 * with this project's "prefer deterministic analysis, profile before adding complexity" rule.
 * Capped at `maxFiles` so a huge project degrades to a partial (not stalled) scan; a read/stat
 * failure on any single entry is skipped rather than aborting the whole walk.
 */
export function walkSourceFiles(
  cwd: string,
  onFile: (filePath: string, content: string) => void,
  maxFiles: number = DEFAULT_MAX_FILES
): { filesScanned: number } {
  let filesScanned = 0;

  function walk(dir: string): void {
    if (filesScanned >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= maxFiles) return;
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

      onFile(fullPath, content);
    }
  }

  walk(cwd);
  return { filesScanned };
}
