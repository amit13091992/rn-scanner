import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';
import { detectPackageManager } from '../utils/lockfile.js';
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
 * `name@version`. Never throws; an unreadable lockfile yields an empty map.
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

/** Yarn classic (v1) only: each block has a `version` and an `integrity` line. Yarn berry's
 *  `checksum` hashes Yarn's own repacked archive, not the registry tarball, so it is not the same
 *  digest an SBOM consumer would verify against the registry and is deliberately not emitted. */
export function parseYarnV1Integrity(text: string): Map<string, CycloneDxHash> {
  const result = new Map<string, CycloneDxHash>();
  if (!/^# yarn lockfile v1/m.test(text)) return result;

  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => !l.startsWith('#') && l.trim() !== '');
    const header = lines[0];
    if (!header || header.startsWith(' ')) continue;
    const version = /^\s+version "([^"]+)"/m.exec(block)?.[1];
    const integrity = /^\s+integrity (\S+)/m.exec(block)?.[1];
    if (!version || !integrity) continue;
    const hash = integrityToHash(integrity);
    if (!hash) continue;

    for (const raw of header.replace(/:$/, '').split(',')) {
      const spec = raw.trim().replace(/^"|"$/g, '');
      const at = spec.lastIndexOf('@');
      if (at > 0) result.set(`${spec.slice(0, at)}@${version}`, hash);
    }
  }
  return result;
}

/** pnpm v6+/v9: `packages:` entries keyed `name@version` with `resolution: {integrity: ...}`. */
export function parsePnpmIntegrity(text: string): Map<string, CycloneDxHash> {
  const result = new Map<string, CycloneDxHash>();
  const start = text.search(/^packages:\s*$/m);
  if (start === -1) return result;
  const bodyStart = text.indexOf('\n', start) + 1;
  const end = text.slice(bodyStart).search(/^\S/m);
  const section = end === -1 ? text.slice(bodyStart) : text.slice(bodyStart, bodyStart + end);

  let key: string | null = null;
  for (const line of section.split('\n')) {
    const keyMatch = /^ {2}'?\/?((?:@[^/@']+\/)?[^@'(\s]+)@([^@'(:\s]+)[^:]*:\s*$/.exec(line);
    if (keyMatch) {
      key = `${keyMatch[1]}@${keyMatch[2]}`;
      continue;
    }
    const integrity = key ? /^ {4}resolution: \{.*integrity: ([^,}\s]+)/.exec(line)?.[1] : undefined;
    if (key && integrity) {
      const hash = integrityToHash(integrity);
      if (hash) result.set(key, hash);
    }
  }
  return result;
}

/** bun.lock: each `packages` value is `[ "name@version", registry, meta, "<integrity>" ]`. */
export function parseBunIntegrity(text: string): Map<string, CycloneDxHash> {
  const result = new Map<string, CycloneDxHash>();
  const content = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as { packages?: Record<string, unknown> };
  for (const value of Object.values(content.packages ?? {})) {
    if (!Array.isArray(value)) continue;
    const [spec, , , integrity] = value as unknown[];
    if (typeof spec !== 'string' || typeof integrity !== 'string') continue;
    const at = spec.lastIndexOf('@');
    const hash = integrityToHash(integrity);
    if (at > 0 && hash) result.set(spec, hash);
  }
  return result;
}

/**
 * Registry integrity hashes for whichever lockfile the project uses (npm, yarn classic, pnpm,
 * bun), keyed `name@version`. A package with no integrity in the lockfile (git/tarball/link
 * dependencies, yarn berry) is simply absent — a hash is never fabricated. Never throws.
 */
export function readLockfileIntegrity(cwd: string): Map<string, CycloneDxHash> {
  try {
    const { manager, lockfilePath } = detectPackageManager(cwd);
    if (manager === 'npm') return readNpmLockfileIntegrity(cwd);
    if (!existsSync(lockfilePath)) return new Map();
    const text = readFileSync(lockfilePath, 'utf-8');
    if (manager === 'yarn') return parseYarnV1Integrity(text);
    if (manager === 'pnpm') return parsePnpmIntegrity(text);
    return parseBunIntegrity(text);
  } catch {
    return new Map();
  }
}
