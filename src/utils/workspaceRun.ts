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

class CommandExitSentinel extends Error {}

/**
 * Runs one of this project's own self-contained command functions (`checkCommand`,
 * `doctorCommand`, `whyCommand`, `treeCommand`) with its console output captured and its own
 * `process.exit` calls intercepted instead of actually terminating the process. Used by each
 * command's own `--all-workspaces` aggregator to run the exact same, already-tested
 * single-project logic once per workspace package without one package's non-zero exit ending
 * the whole aggregated run before the remaining packages are scanned. Mirrors this project's
 * own test harness pattern (see `test/*.test.ts`'s `captureStdout`), applied in production so
 * each command's aggregation reuses its real logic rather than duplicating it.
 */
export async function runCapturingExit(fn: () => Promise<void>): Promise<{ output: string; exitCode?: number }> {
  const originalLog = console.log;
  const originalExit = process.exit;
  let output = '';
  let exitCode: number | undefined;

  console.log = (msg?: unknown) => {
    output += `${String(msg)}\n`;
  };
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new CommandExitSentinel();
  }) as typeof process.exit;

  try {
    await fn();
  } catch (err) {
    if (!(err instanceof CommandExitSentinel)) throw err;
  } finally {
    console.log = originalLog;
    process.exit = originalExit;
  }

  return { output, exitCode };
}
