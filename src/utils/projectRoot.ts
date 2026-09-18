import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const LOCKFILE_NAMES = ['bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];

/**
 * Resolves the directory that actually holds the lockfile and hoisted node_modules for a
 * project at `cwd`. In an npm/yarn/pnpm workspace, running the CLI from a workspace package
 * (e.g. apps/mobile) finds neither there — both live at the monorepo root — so a plain
 * `join(cwd, 'node_modules', ...)` silently resolves nothing. This walks up from `cwd`,
 * checking each ancestor for a lockfile first (the more reliable signal, since node_modules
 * can legitimately be absent before install) and falling back to node_modules presence,
 * stopping at the first match or the filesystem root. A single-package project resolves to
 * `cwd` on the first check, so this is a no-op for the common case.
 */
export function resolveDependencyRoot(cwd: string): string {
  let dir = resolve(cwd);

  while (true) {
    const hasLockfile = LOCKFILE_NAMES.some((name) => existsSync(resolve(dir, name)));
    if (hasLockfile || existsSync(resolve(dir, 'node_modules'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(cwd);
}
