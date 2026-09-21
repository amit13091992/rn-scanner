import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';

interface RawManifest {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}

/**
 * Reads a package's own declared license from its installed manifest. Handles the modern
 * string `"license": "MIT"` field, the legacy object form `{ "type": "MIT" }`, and the very old
 * `"licenses": [{ "type": "MIT" }]` array some pre-SPDX packages still ship. Returns null when
 * the package isn't installed, its manifest can't be read, or none of these fields are
 * present — never a guessed default, since a false "no license" or fabricated license both
 * carry real legal-review consequences.
 */
export function readInstalledPackageLicense(cwd: string, packageName: string): string | null {
  const root = resolveDependencyRoot(cwd);
  const manifestPath = join(root, 'node_modules', packageName, 'package.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawManifest;
    if (typeof raw.license === 'string' && raw.license.trim()) return raw.license.trim();
    if (raw.license && typeof raw.license === 'object' && raw.license.type) return raw.license.type;
    if (Array.isArray(raw.licenses) && raw.licenses[0]?.type) return raw.licenses[0].type;
    return null;
  } catch {
    return null;
  }
}
