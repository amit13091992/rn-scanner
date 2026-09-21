import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DependencyInfo } from '../types/dependency.js';
import { resolveDependencyRoot } from '../utils/projectRoot.js';

export interface PackageSizeResult {
  name: string;
  /** Total size on disk (bytes) of node_modules/<name>, including its own nested node_modules
   *  (a dependency this package pulls in only for itself, e.g. a version-conflicted transitive
   *  dep, is part of what installing this package actually costs). */
  sizeBytes: number;
}

export interface BundleSizeResult {
  packages: PackageSizeResult[];
  totalBytes: number;
}

/**
 * Sums file sizes under `dir` recursively. Not a real Metro/Webpack bundle analysis (which
 * needs the bundler's own serializer output — a real bundle stat file, only produced by
 * actually running Metro) — this is on-disk install size, a cheap and dependency-free proxy
 * for "how much does this package weigh", consistent with this project's rule to prefer
 * deterministic analysis and add complexity (a Metro integration, a new dependency) only after
 * profiling shows this proxy isn't good enough. Never throws: an unreadable entry is skipped,
 * not counted, rather than aborting the whole measurement.
 */
function directorySize(dir: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      total += directorySize(fullPath);
    } else if (stat.isFile()) {
      total += stat.size;
    }
  }

  return total;
}

/**
 * Reports each direct dependency's on-disk install size, largest first — an approximation of
 * bundle-contribution weight, not the actual JS bundle size a real Metro build would produce
 * (source maps, unused exports, and platform-specific files are all included here but might be
 * tree-shaken/excluded from a real bundle). Scoped to direct dependencies only: a package's
 * transitive footprint is already reflected in its own total (see `directorySize`'s doc), and
 * reporting every transitive package separately would double-count and clutter the output.
 */
export function analyzeBundleSize(cwd: string, dependencies: DependencyInfo[]): BundleSizeResult {
  const root = resolveDependencyRoot(cwd);

  const packages: PackageSizeResult[] = dependencies
    .filter((dep) => dep.type === 'dependency')
    .map((dep) => ({
      name: dep.name,
      sizeBytes: directorySize(join(root, 'node_modules', dep.name)),
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  const totalBytes = packages.reduce((sum, p) => sum + p.sizeBytes, 0);

  return { packages, totalBytes };
}
