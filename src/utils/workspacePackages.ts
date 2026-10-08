import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspacePackageInfo {
  name: string;
  dir: string;
  version: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
}

/**
 * Expands the workspace glob patterns this project supports: an exact relative path
 * ("packages/shared"), or a single trailing `/*` wildcard ("packages/*", "apps/*") expanded to
 * every immediate subdirectory. Deliberately doesn't support recursive `**`, bracket
 * expansion, or negation (`!...`) patterns — consistent with this project's "prefer
 * deterministic analysis" rule, and covers the overwhelming majority of real-world yarn/pnpm/bun
 * workspace configs, which use exactly this `packages/*` shape.
 */
function expandWorkspaceGlobs(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue; // negation patterns not supported — skip rather than misinterpret
    if (pattern.endsWith('/*')) {
      const base = join(rootDir, pattern.slice(0, -2));
      if (!existsSync(base)) continue;
      let entries;
      try {
        entries = readdirSync(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) dirs.push(join(base, entry.name));
      }
    } else {
      const exact = join(rootDir, pattern);
      if (existsSync(exact)) dirs.push(exact);
    }
  }
  return dirs;
}

/** pnpm-workspace.yaml's top-level `packages:` list — pnpm ignores package.json's `workspaces`
 *  field entirely and only honors this file. */
function readPnpmWorkspaceGlobs(rootDir: string): string[] {
  const pnpmWsPath = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(pnpmWsPath)) return [];

  let content: string;
  try {
    content = readFileSync(pnpmWsPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (item) {
      patterns.push(item[1]);
      continue;
    }
    if (/^\S/.test(line)) break; // back to indent 0 — packages: block ended
  }
  return patterns;
}

/** npm/yarn/bun all read the root `package.json`'s `workspaces` field — either a plain array
 *  of globs, or `{ packages: [...] }`. */
function readPackageJsonWorkspaceGlobs(rootDir: string): string[] {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) return ws;
    if (ws && Array.isArray(ws.packages)) return ws.packages;
  } catch {
    return [];
  }
  return [];
}

/**
 * Finds every workspace package declared at the monorepo root, keyed by package name —
 * used to cross-link a sibling workspace package as a graph node (instead of silently
 * dropping it, or worse, matching a same-named registry package) when another workspace
 * package depends on it. pnpm-workspace.yaml takes precedence when present (pnpm ignores
 * package.json's `workspaces` field entirely); otherwise falls back to package.json's
 * `workspaces` field (npm/yarn/bun's convention).
 */
export function findWorkspacePackages(rootDir: string): Map<string, WorkspacePackageInfo> {
  const result = new Map<string, WorkspacePackageInfo>();

  const patterns = readPnpmWorkspaceGlobs(rootDir);
  const globs = patterns.length > 0 ? patterns : readPackageJsonWorkspaceGlobs(rootDir);
  if (globs.length === 0) return result;

  const dirs = expandWorkspaceGlobs(rootDir, globs);
  for (const dir of dirs) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        version?: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      if (typeof pkg.name !== 'string' || !pkg.name) continue;
      result.set(pkg.name, {
        name: pkg.name,
        dir,
        version: typeof pkg.version === 'string' ? pkg.version : '',
        dependencies: pkg.dependencies ?? {},
        optionalDependencies: pkg.optionalDependencies ?? {},
      });
    } catch {
      continue;
    }
  }
  return result;
}
