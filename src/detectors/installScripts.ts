import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'] as const;

/**
 * Lists the npm install-time lifecycle hooks (`preinstall`/`install`/`postinstall`) an installed
 * package declares — the hooks a supply-chain worm runs on `npm install`. Returns null when the
 * package isn't installed at the hoisted `node_modules/<name>` location or its manifest can't
 * be read (unknown, not "no hooks"); an empty array means it was read and declares none. Reads
 * the manifest as data only — the scripts themselves are never executed.
 */
export function readInstallScriptHooks(cwd: string, packageName: string): string[] | null {
  const root = resolveDependencyRoot(cwd);
  const manifestPath = join(root, 'node_modules', packageName, 'package.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { scripts?: Record<string, unknown> };
    const scripts = raw.scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    return INSTALL_HOOKS.filter((hook) => typeof scripts[hook] === 'string' && (scripts[hook] as string).trim() !== '');
  } catch {
    return null;
  }
}
