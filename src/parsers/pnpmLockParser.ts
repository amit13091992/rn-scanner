import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export function parsePnpmLock(cwd: string): ParsedLockfile {
  try {
    const pnpmLockPath = resolve(cwd, 'pnpm-lock.yaml');
    const content = readFileSync(pnpmLockPath, 'utf-8');

    const dependencies = new Map<string, ResolvedDependency>();
    const lines = content.split('\n');

    let i = 0;
    let inDependencies = false;

    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine === 'dependencies:') {
        inDependencies = true;
        i++;
        continue;
      }

      if (inDependencies) {
        if (!line.startsWith(' ')) {
          inDependencies = false;
        } else if (line.startsWith('  ') && !line.startsWith('    ') && trimmedLine) {
          const match = line.match(/^  '?([^':\s]+)'?:\s*(.+)?$/);
          if (match) {
            const packageName = match[1];
            const inlineVersion = match[2]?.trim();

            if (inlineVersion) {
              dependencies.set(packageName, {
                name: packageName,
                requestedVersion: inlineVersion,
                resolvedVersion: inlineVersion,
              });
            }
          }
        }
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
