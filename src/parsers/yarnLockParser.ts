import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

export function parseYarnLock(cwd: string): ParsedLockfile {
  try {
    const yarnLockPath = resolve(cwd, 'yarn.lock');
    const content = readFileSync(yarnLockPath, 'utf-8');

    const dependencies = new Map<string, ResolvedDependency>();
    const seenPackages = new Set<string>();

    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        i++;
        continue;
      }

      const isEntry = line.startsWith('"') || (!line.startsWith(' ') && line.includes(':'));
      if (isEntry && !line.startsWith(' ')) {
        const match = line.match(/^["']?(.+?)["']?\s*:/);
        if (match) {
          const fullEntry = match[1].trim();
          let packageName = fullEntry;

          if (fullEntry.includes('@')) {
            if (fullEntry.startsWith('@')) {
              const parts = fullEntry.split('@').slice(1);
              if (parts.length >= 2) {
                packageName = '@' + parts[0];
              }
            } else {
              packageName = fullEntry.split('@')[0];
            }
          }

          i++;
          let version: string | undefined;

          while (i < lines.length) {
            const contentLine = lines[i];
            if (!contentLine.startsWith('  ') || contentLine.trim() === '') {
              break;
            }

            const contentTrimmed = contentLine.trim();
            if (contentTrimmed.startsWith('version')) {
              const versionMatch = contentTrimmed.match(/version\s+["']?([^"'\s]+)["']?/);
              if (versionMatch) {
                version = versionMatch[1];
              }
            }

            i++;
          }

          if (version && !seenPackages.has(packageName)) {
            seenPackages.add(packageName);
            dependencies.set(packageName, {
              name: packageName,
              requestedVersion: version,
              resolvedVersion: version,
            });
          }
          continue;
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
