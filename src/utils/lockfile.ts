import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, PackageManager } from '../types/lockfile.js';
import { NPMLockParser } from '../parsers/npmLockParser.js';
import { parseYarnLock } from '../parsers/yarnLockParser.js';
import { parsePnpmLock } from '../parsers/pnpmLockParser.js';
import { parseBunLock } from '../parsers/bunLockParser.js';

export type { PackageManager, ParsedLockfile } from '../types/lockfile.js';

export interface LockfileInfo {
  manager: PackageManager;
  lockfilePath: string;
}

export function detectPackageManager(cwd: string = process.cwd()): LockfileInfo {
  const lockfiles: Array<[string, PackageManager]> = [
    ['bun.lock', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];

  for (const [filename, manager] of lockfiles) {
    const lockfilePath = resolve(cwd, filename);
    if (existsSync(lockfilePath)) {
      return {
        manager,
        lockfilePath,
      };
    }
  }

  return {
    manager: 'npm',
    lockfilePath: resolve(cwd, 'package-lock.json'),
  };
}

export async function parseLockfile(cwd: string = process.cwd()): Promise<ParsedLockfile | null> {
  try {
    const { manager, lockfilePath } = detectPackageManager(cwd);

    if (!existsSync(lockfilePath)) {
      return null;
    }

    if (manager === 'npm') {
      const content = readFileSync(lockfilePath, 'utf-8');
      const parser = new NPMLockParser();
      return parser.parse(content);
    }

    if (manager === 'yarn') {
      return parseYarnLock(cwd);
    }

    if (manager === 'pnpm') {
      return parsePnpmLock(cwd);
    }

    if (manager === 'bun') {
      return parseBunLock(cwd);
    }

    return null;
  } catch {
    return null;
  }
}
