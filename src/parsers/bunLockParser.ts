import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1');
}

export function parseBunLock(cwd: string): ParsedLockfile {
  const dependencies = new Map<string, ResolvedDependency>();

  try {
    const bunLockPath = resolve(cwd, 'bun.lock');
    const raw = readFileSync(bunLockPath, 'utf-8');
    const content = JSON.parse(stripTrailingCommas(raw));

    if (content.packages && typeof content.packages === 'object') {
      for (const value of Object.values<unknown>(content.packages)) {
        const spec = Array.isArray(value) ? value[0] : undefined;
        if (typeof spec !== 'string') continue;

        const atIndex = spec.lastIndexOf('@');
        if (atIndex <= 0) continue;

        const name = spec.slice(0, atIndex);
        const version = spec.slice(atIndex + 1);
        if (name && version) {
          dependencies.set(name, {
            name,
            requestedVersion: version,
            resolvedVersion: version,
          });
        }
      }
    }
  } catch {
    // Missing or unparsable bun.lock (e.g. legacy binary bun.lockb) — return empty result.
  }

  return {
    manager: 'bun',
    dependencies,
    timestamp: Date.now(),
  };
}
