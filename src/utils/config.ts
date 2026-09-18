import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RnDepScannerConfig } from '../types/config.js';

const CONFIG_FILENAME = '.rn-dep-scanner.json';
const KNOWN_KEYS: Array<keyof RnDepScannerConfig> = ['ignorePackages', 'ignoreVulnerabilities'];

export interface LoadConfigResult {
  config: RnDepScannerConfig;
  /** Problems found while reading/validating the config — surfaced to the user (ADR-0004:
   *  a config mistake is silently dropped from the resulting config, but never silently hidden
   *  from the user), never thrown. Empty when the file is absent or fully valid. */
  warnings: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Loads per-project rule overrides from `.rn-dep-scanner.json` at the project root, if
 * present. Never throws: a missing file returns an empty config, and a malformed file (bad
 * JSON, wrong field types, unknown keys) degrades to the valid subset rather than failing the
 * whole `check` run — a mistake in a config file shouldn't take down the scanner. What's wrong
 * is reported back via `warnings` instead, so a typo doesn't silently do nothing.
 */
export function loadConfig(cwd: string): LoadConfigResult {
  const configPath = join(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) return { config: {}, warnings: [] };

  const warnings: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    return {
      config: {},
      warnings: [`${CONFIG_FILENAME}: could not be read (${error instanceof Error ? error.message : 'unknown error'}) — ignoring`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      config: {},
      warnings: [`${CONFIG_FILENAME}: invalid JSON (${error instanceof Error ? error.message : 'parse error'}) — ignoring`],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: {}, warnings: [`${CONFIG_FILENAME}: expected a JSON object at the top level — ignoring`] };
  }

  const record = parsed as Record<string, unknown>;
  const config: RnDepScannerConfig = {};

  if ('ignorePackages' in record) {
    if (isStringArray(record.ignorePackages)) {
      config.ignorePackages = record.ignorePackages;
    } else {
      warnings.push(`${CONFIG_FILENAME}: "ignorePackages" must be an array of strings, got ${describeType(record.ignorePackages)} — ignoring this field`);
    }
  }

  if ('ignoreVulnerabilities' in record) {
    if (isStringArray(record.ignoreVulnerabilities)) {
      config.ignoreVulnerabilities = record.ignoreVulnerabilities;
    } else {
      warnings.push(`${CONFIG_FILENAME}: "ignoreVulnerabilities" must be an array of strings, got ${describeType(record.ignoreVulnerabilities)} — ignoring this field`);
    }
  }

  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.includes(key as keyof RnDepScannerConfig)) {
      warnings.push(`${CONFIG_FILENAME}: unknown option "${key}" — ignoring (known options: ${KNOWN_KEYS.join(', ')})`);
    }
  }

  return { config, warnings };
}
