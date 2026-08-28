import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export function parseBunLock(cwd: string): ParsedLockfile {
  try {
    const bunLockPath = resolve(cwd, 'bun.lockb');

    readFileSync(bunLockPath);

    const dependencies = new Map<string, ResolvedDependency>();

    try {
      const bunJsonPath = resolve(cwd, 'bun.lock.json');
      const bunLockJson = JSON.parse(readFileSync(bunJsonPath, 'utf-8'));

      if (bunLockJson.dependencies) {
        Object.entries(bunLockJson.dependencies).forEach(([name, info]: [string, any]) => {
          if (typeof info === 'object' && info.version) {
            dependencies.set(name, {
              name,
              requestedVersion: info.version,
              resolvedVersion: info.version,
            });
          }
        });
      }

      if (bunLockJson.packages) {
        Object.entries(bunLockJson.packages).forEach(([key, info]: [string, any]) => {
          if (typeof info === 'object' && info.version) {
            const name = key.split('@')[0] === '' ? '@' + key.split('@')[1] : key.split('@')[0];
            dependencies.set(name, {
              name,
              requestedVersion: info.version,
              resolvedVersion: info.version,
            });
          }
        });
      }
    } catch {
      return {
        manager: 'bun',
        dependencies: new Map(),
        timestamp: Date.now(),
      };
    }

    return {
      manager: 'bun',
      dependencies,
      timestamp: Date.now(),
    };
  } catch {
    return {
      manager: 'bun',
      dependencies: new Map(),
      timestamp: Date.now(),
    };
  }
}
