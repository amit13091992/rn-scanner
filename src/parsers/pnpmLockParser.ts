import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export function parsePnpmLock(cwd: string): ParsedLockfile {
  try {
    const pnpmLockPath = resolve(cwd, 'pnpm-lock.yaml');
    const content = readFileSync(pnpmLockPath, 'utf-8');

    const dependencies = new Map<string, ResolvedDependency>();

    const lines = content.split('\n');
    let inDeps = false;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line === 'dependencies:') {
        inDeps = true;
        i++;
        continue;
      }

      if (inDeps && line.startsWith('  ') && !line.startsWith('    ')) {
        const match = line.match(/^  '?(.+?)'?:\s*$/);
        if (match) {
          const packageName = match[1];
          i++;

          let version: string | undefined;
          while (i < lines.length) {
            const contentLine = lines[i];
            if (!contentLine.startsWith('    ')) {
              break;
            }

            if (contentLine.includes('specifier:')) {
              const specMatch = contentLine.match(/specifier:\s*(.+)/);
              if (specMatch) {
                version = specMatch[1].trim();
              }
            }

            if (contentLine.includes('version:')) {
              const verMatch = contentLine.match(/version:\s*(.+)/);
              if (verMatch) {
                version = verMatch[1].trim();
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

      if (inDeps && !line.startsWith('  ')) {
        inDeps = false;
      }

      i++;
    }

    return {
      manager: 'pnpm',
      dependencies,
      timestamp: Date.now(),
    };
  } catch {
    return {
      manager: 'pnpm',
      dependencies: new Map(),
      timestamp: Date.now(),
    };
  }
}
