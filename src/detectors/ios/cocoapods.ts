import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Parses ios/Podfile.lock for the `COCOAPODS: X.Y.Z` line, which standard
 * CocoaPods lockfiles include near the end of the file, to determine the
 * CocoaPods version used to generate the lock.
 */
export function detectCocoaPodsVersion(cwd: string): string | null {
  const content = readFileSafe(join(cwd, 'ios', 'Podfile.lock'));
  if (!content) return null;

  const match = content.match(/^COCOAPODS:\s*([\d.]+)\s*$/m);
  return match ? match[1] : null;
}
