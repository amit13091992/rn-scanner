import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findWorkspacePackages } from './workspacePackages.js';

const LOCKFILE_NAMES = ['bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];

/**
 * Resolves the directory that actually holds the lockfile and hoisted node_modules for a
 * project at `cwd`. In an npm/yarn/pnpm/bun workspace, running the CLI from a workspace package
 * (e.g. apps/mobile) finds neither there — both live at the monorepo root — so a plain
 * `join(cwd, 'node_modules', ...)` silently resolves nothing.
 *
 * Walks up for the nearest ancestor with a lockfile. If `cwd` itself has no `node_modules` of
 * its own, that ancestor is trusted outright — there's nothing locally that could compete with
 * it as a signal. If `cwd` *does* have its own `node_modules`, the ancestor's lockfile is only
 * trusted when that ancestor's own workspace config (`workspaces` field / `pnpm-workspace.yaml`)
 * actually declares `cwd` as one of its packages — otherwise `cwd`'s own `node_modules` is the
 * more reliable local signal, and `cwd` resolves to itself.
 *
 * This distinction matters because pnpm's isolated `node_modules` strategy (and bun, in
 * practice) creates a real `node_modules` directory inside *every* workspace package, not just
 * the monorepo root — so "does cwd have a node_modules" alone can't tell a workspace package
 * apart from a directory that's merely nested inside an unrelated project with its own
 * unrelated lockfile. Checking the workspace declaration resolves that ambiguity; trusting
 * `node_modules` presence unconditionally (the previous behavior) stopped the walk at the
 * workspace package itself and never found the real lockfile one or more directories up —
 * silently falling back to this project's best-effort (direct-dependency-only,
 * unresolved-version) graph for an otherwise ordinary pnpm/bun workspace sub-package.
 */
export function resolveDependencyRoot(cwd: string): string {
  const start = resolve(cwd);
  const startHasNodeModules = existsSync(resolve(start, 'node_modules'));

  let dir = start;
  while (true) {
    if (LOCKFILE_NAMES.some((name) => existsSync(resolve(dir, name)))) {
      if (dir === start || !startHasNodeModules) return dir;
      const workspaces = findWorkspacePackages(dir);
      const isDeclaredWorkspace = Array.from(workspaces.values()).some((w) => resolve(w.dir) === start);
      return isDeclaredWorkspace ? dir : start;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // No lockfile anywhere above cwd — fall back to the nearest ancestor with a node_modules
  // directory (better than nothing for an unlocked/pre-install project).
  dir = start;
  while (true) {
    if (existsSync(resolve(dir, 'node_modules'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return start;
}
