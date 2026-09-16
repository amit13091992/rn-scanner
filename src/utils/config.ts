import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RnDepScannerConfig } from '../types/config.js';

const CONFIG_FILENAME = '.rn-dep-scanner.json';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Loads per-project rule overrides from `.rn-dep-scanner.json` at the project root, if
 * present. Never throws: a missing file returns an empty config, and a malformed file (bad
 * JSON, wrong field types) is ignored field-by-field rather than failing the whole `check`
 * run — a typo in a config file shouldn't take down the scanner.
 */
export function loadConfig(cwd: string): RnDepScannerConfig {
  const configPath = join(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const config: RnDepScannerConfig = {};
    if (isStringArray(parsed.ignorePackages)) config.ignorePackages = parsed.ignorePackages;
    if (isStringArray(parsed.ignoreVulnerabilities)) config.ignoreVulnerabilities = parsed.ignoreVulnerabilities;
    return config;
  } catch {
    return {};
  }
}
