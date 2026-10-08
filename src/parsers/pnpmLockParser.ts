import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedLockfile, ResolvedDependency } from '../types/lockfile.js';

/** Strips a peer-dependency parenthetical suffix and a leading "/" from a pnpm lockfile key
 *  (e.g. "/foo@1.0.0(react@18.0.0)" or "foo@1.0.0") and splits it into name/version. */
function parseKey(rawKey: string): { name: string; version: string } {
  let key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey;
  const parenIdx = key.indexOf('(');
  if (parenIdx !== -1) key = key.slice(0, parenIdx);
  const atIndex = key.startsWith('@') ? key.indexOf('@', 1) : key.indexOf('@');
  if (atIndex === -1) return { name: key, version: '' };
  return { name: key.slice(0, atIndex), version: key.slice(atIndex + 1) };
}

/** Reads every 2-space-indented "name@version:" (or "name@version: {}") key in a block,
 *  ignoring its nested content — used for both the current `snapshots:` block (v9+) and the
 *  legacy `packages:` block (v5.x/v6.x), which share this same top-level key shape. */
function collectBlockVersions(lines: string[], startIdx: number, into: Map<string, ResolvedDependency>): void {
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\S/.test(line)) break; // indent 0 — block ended

    const keyMatch = line.match(/^ {2}(.+?):(\s*\{\})?\s*$/);
    if (keyMatch) {
      const { name, version } = parseKey(keyMatch[1].replace(/^['"]|['"]$/g, ''));
      if (name && version && !into.has(name)) {
        into.set(name, { name, requestedVersion: version, resolvedVersion: version });
      }
    }
    i++;
  }
}

/** Legacy (v5.x) shape: a top-level `dependencies:` block with inline "name: version" lines —
 *  v6+/v9+ moved this under `importers:` per workspace package instead (not read here, since
 *  the `snapshots:`/`packages:` block above already gives every resolved version regardless of
 *  which importer declared it — sufficient for this parser's "name -> resolved version"
 *  lookup table, which the caller filters down to what's actually in package.json anyway). */
function collectLegacyTopLevelDependencies(lines: string[], into: Map<string, ResolvedDependency>): void {
  let inDependencies = false;
  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === 'dependencies:' && !line.startsWith(' ')) {
      inDependencies = true;
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
          if (inlineVersion && !into.has(packageName)) {
            into.set(packageName, { name: packageName, requestedVersion: inlineVersion, resolvedVersion: inlineVersion });
          }
        }
      }
    }
  }
}

export function parsePnpmLock(cwd: string): ParsedLockfile {
  try {
    const pnpmLockPath = resolve(cwd, 'pnpm-lock.yaml');
    const content = readFileSync(pnpmLockPath, 'utf-8');
    const lines = content.split('\n');
    const dependencies = new Map<string, ResolvedDependency>();

    // Current (v9+) pnpm puts the actual resolved dependency graph in `snapshots:` — the
    // `packages:` block itself carries resolution/engines metadata only, no versions useful
    // here. Legacy (v5.x/v6.x) pnpm put resolved versions directly in `packages:` keys, with
    // direct-dependency versions sometimes only available via a top-level `dependencies:`
    // block. Reading all three that exist (each only filling names the previous one didn't
    // already cover) means this parser doesn't silently return nothing for any current pnpm
    // project, which is what happened when it only ever looked for the legacy top-level
    // `dependencies:` shape — a shape v6+/v9+ don't have at all.
    const snapshotsIdx = lines.findIndex((l) => l.trimEnd() === 'snapshots:');
    const packagesIdx = lines.findIndex((l) => l.trimEnd() === 'packages:');
    if (snapshotsIdx !== -1) collectBlockVersions(lines, snapshotsIdx + 1, dependencies);
    if (packagesIdx !== -1) collectBlockVersions(lines, packagesIdx + 1, dependencies);
    collectLegacyTopLevelDependencies(lines, dependencies);

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
