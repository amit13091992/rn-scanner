import { existsSync, readFileSync } from 'node:fs';
import { listZipEntries, type ZipEntry } from '../../utils/zip.js';

export interface IpaListing {
  entries: ZipEntry[];
}

/**
 * Reads an .ipa (or .xcarchive, since both are plain zips) and lists its entries. Returns
 * null when the path doesn't exist or isn't a well-formed zip, rather than throwing — this
 * runs against a user-supplied build artifact path, not a guaranteed-valid input.
 */
export function readIpaListing(ipaPath: string): IpaListing | null {
  if (!existsSync(ipaPath)) return null;

  let buffer: Buffer;
  try {
    buffer = readFileSync(ipaPath);
  } catch {
    return null;
  }

  const entries = listZipEntries(buffer);
  if (!entries) return null;

  return { entries };
}

/**
 * Extracts the app name from a Payload/<AppName>.app/ entry (the standard .ipa layout) or a
 * Products/Applications/<AppName>.app/ entry (the .xcarchive layout).
 */
export function findAppName(entries: ZipEntry[]): string | null {
  for (const entry of entries) {
    const match = /(?:^Payload\/|\/Products\/Applications\/)([^/]+)\.app\//.exec(entry.name);
    if (match) return match[1];
  }
  return null;
}

/** True if any entry looks like a dSYM bundle for the given app name. */
export function hasDsymForApp(entries: ZipEntry[], appName: string): boolean {
  const dsymPattern = new RegExp(`${escapeRegExp(appName)}\\.app\\.dSYM/Contents/Resources/DWARF/`);
  return entries.some((entry) => dsymPattern.test(entry.name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
