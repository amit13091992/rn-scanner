import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';

// Hermes bytecode files start with this 8-byte magic (little-endian 0x1F1903C103BC1FC6),
// followed by a uint32 bytecode format version.
const HBC_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

/** Reads the bytecode format version from a `.hbc` header; `null` if it isn't a Hermes bytecode file. */
export function readHbcBytecodeVersion(path: string): number | null {
  const header = Buffer.alloc(12);
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    if (readSync(fd, header, 0, 12, 0) < 12) return null;
  } finally {
    closeSync(fd);
  }
  return header.subarray(0, 8).equals(HBC_MAGIC) ? header.readUInt32LE(8) : null;
}

function installedVersion(projectRoot: string, packageName: string): string | null {
  // Reads only the installed manifest — never executes anything from node_modules.
  for (const root of new Set([projectRoot, resolveDependencyRoot(projectRoot)])) {
    const file = join(root, 'node_modules', packageName, 'package.json');
    if (!existsSync(file)) continue;
    try {
      const version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;
      if (typeof version === 'string') return version;
    } catch {
      return null;
    }
  }
  return null;
}

/** Version of the installed Metro bundler, or `null` when it can't be read. */
export const detectMetroVersion = (projectRoot: string): string | null => installedVersion(projectRoot, 'metro');

/** Version of the installed `hermes-compiler` package (RN 0.81+), or `null` when absent. */
export const detectHermesCompilerVersion = (projectRoot: string): string | null => installedVersion(projectRoot, 'hermes-compiler');
