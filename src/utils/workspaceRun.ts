import { resolveDependencyRoot } from './projectRoot.js';
import { findWorkspacePackages } from './workspacePackages.js';

export interface WorkspaceTarget {
  name: string;
  dir: string;
}

/**
 * Lists every workspace package directory at the monorepo root containing `cwd`, sorted by
 * name for deterministic multi-package output (`--all-workspaces`). Empty when `cwd` isn't
 * inside an npm/yarn/pnpm/bun workspace at all (no `workspaces` field, or none found) — callers
 * should fall back to scanning `cwd` alone rather than treating this as an error, since
 * `--all-workspaces` on a single-package project is a no-op, not a failure.
 */
export function listWorkspaceTargets(cwd: string): WorkspaceTarget[] {
  const root = resolveDependencyRoot(cwd);
  const packages = findWorkspacePackages(root);
  return Array.from(packages.values())
    .map((p) => ({ name: p.name, dir: p.dir }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
