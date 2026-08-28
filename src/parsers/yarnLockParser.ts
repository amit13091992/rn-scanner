import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export function parseYarnLock(cwd: string): ParsedLockfile {
  try {
    const yarnLockPath = resolve(cwd, 'yarn.lock');
    const content = readFileSync(yarnLockPath, 'utf-8');

    const dependencies = new Map<string, ResolvedDependency>();

    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line === '' || line.startsWith('#')) {
        i++;
        continue;
      }

      if (line.includes('@') && (line.includes('npm:') || line.includes('yarn:'))) {
        const match = line.match(/^"?(.+?)"?\s*:/);
        if (match) {
          const fullEntry = match[1];
          const packageMatch = fullEntry.match(/^(.+?)@/);
          if (packageMatch) {
            const packageName = packageMatch[1];
            i++;

            let version: string | undefined;
            while (i < lines.length) {
              const contentLine = lines[i];
              if (!contentLine.startsWith('  ') || contentLine.trim() === '') {
                break;
              }

              if (contentLine.includes('version')) {
                const versionMatch = contentLine.match(/version\s+["']?([^"'\s]+)["']?/);
                if (versionMatch) {
                  version = versionMatch[1];
                }
              }

              i++;
            }

            if (version) {
              dependencies.set(packageName, {
                name: packageName,
                requestedVersion: version,
                resolvedVersion: version,
              });
            }
            continue;
          }
        }
      }

      i++;
    }

    return {
      manager: 'yarn',
      dependencies,
      timestamp: Date.now(),
    };
  } catch {
    return {
      manager: 'yarn',
      dependencies: new Map(),
      timestamp: Date.now(),
    };
  }
}
