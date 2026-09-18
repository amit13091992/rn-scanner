import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, PackageManager } from '../types/lockfile.js';
import { NPMLockParser } from '../parsers/npmLockParser.js';
import { parseYarnLock } from '../parsers/yarnLockParser.js';
import { parsePnpmLock } from '../parsers/pnpmLockParser.js';
import { parseBunLock } from '../parsers/bunLockParser.js';
import { resolveDependencyRoot } from './projectRoot.js';

export type { PackageManager, ParsedLockfile } from '../types/lockfile.js';

export interface LockfileInfo {
  manager: PackageManager;
  lockfilePath: string;
}

export function detectPackageManager(cwd: string = process.cwd()): LockfileInfo {
  const root = resolveDependencyRoot(cwd);
  const lockfiles: Array<[string, PackageManager]> = [
    ['bun.lock', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];

  for (const [filename, manager] of lockfiles) {
    const lockfilePath = resolve(root, filename);
    if (existsSync(lockfilePath)) {
      return {
        manager,
        lockfilePath,
      };
    }
  }

  return {
    manager: 'npm',
    lockfilePath: resolve(root, 'package-lock.json'),
  };
}

/**
 * Resolves and parses the project's lockfile. `cwd` is resolved to its dependency root first
 * (see `resolveDependencyRoot`) so this also finds a workspace root's lockfile when `cwd` is a
 * package inside an npm/yarn/pnpm/bun monorepo with no lockfile of its own.
 */
export async function parseLockfile(cwd: string = process.cwd()): Promise<ParsedLockfile | null> {
  try {
    const root = resolveDependencyRoot(cwd);
    const { manager, lockfilePath } = detectPackageManager(root);

    if (!existsSync(lockfilePath)) {
      return null;
    }

    if (manager === 'npm') {
      const content = readFileSync(lockfilePath, 'utf-8');
      const parser = new NPMLockParser();
      return parser.parse(content);
    }

    if (manager === 'yarn') {
      return parseYarnLock(root);
    }

    if (manager === 'pnpm') {
      return parsePnpmLock(root);
    }

    if (manager === 'bun') {
      return parseBunLock(root);
    }

    return null;
  } catch {
    return null;
  }
}
