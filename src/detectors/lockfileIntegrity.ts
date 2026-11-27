import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';
import type { CycloneDxHash } from '../types/sbom.js';

const ALGORITHMS: Array<[prefix: string, alg: CycloneDxHash['alg']]> = [
  ['sha512-', 'SHA-512'],
  ['sha384-', 'SHA-384'],
  ['sha256-', 'SHA-256'],
  ['sha1-', 'SHA-1'],
];

/** Converts an npm SRI string (`sha512-<base64>`, possibly several space-separated) to the
 *  strongest hash it carries as a CycloneDX hex hash; null if none is recognizable. */
export function integrityToHash(integrity: string): CycloneDxHash | null {
  const parts = integrity.trim().split(/\s+/);
  for (const [prefix, alg] of ALGORITHMS) {
    const part = parts.find((p) => p.startsWith(prefix));
    if (!part) continue;
    const hex = Buffer.from(part.slice(prefix.length), 'base64').toString('hex');
    return hex ? { alg, content: hex } : null;
  }
  return null;
}

/**
 * Reads the registry-recorded integrity hash of each package from `package-lock.json`, keyed by
 * `name@version`. npm only: yarn/pnpm/bun lockfiles keep integrity in different shapes the graph
 * builder doesn't retain, so for them this returns an empty map and the SBOM simply omits
 * `hashes` (absent, never fabricated). Never throws.
 */
export function readNpmLockfileIntegrity(cwd: string): Map<string, CycloneDxHash> {
  const result = new Map<string, CycloneDxHash>();
  const lockPath = join(resolveDependencyRoot(cwd), 'package-lock.json');
  if (!existsSync(lockPath)) return result;

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
      packages?: Record<string, { version?: string; integrity?: string; link?: boolean }>;
    };
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      const marker = 'node_modules/';
      const at = path.lastIndexOf(marker);
      if (at === -1 || entry.link || !entry.version || !entry.integrity) continue;
      const hash = integrityToHash(entry.integrity);
      if (hash) result.set(`${path.slice(at + marker.length)}@${entry.version}`, hash);
    }
  } catch {
    return new Map();
  }
  return result;
}
