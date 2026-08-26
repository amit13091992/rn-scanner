import { existsSync } from 'fs';
import { resolve } from 'path';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

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
