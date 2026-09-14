import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface NdkDetectionResult {
  version?: string;
  source?: string;
}

function readIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Detects the NDK version pinned via `ndkVersion "27.1.12297006"` (or `ndkVersion =`) in
 * android/build.gradle(.kts) or android/app/build.gradle(.kts).
 */
export function detectNdkVersion(cwd: string): NdkDetectionResult {
  const candidates = [
    join(cwd, 'android', 'app', 'build.gradle'),
    join(cwd, 'android', 'app', 'build.gradle.kts'),
    join(cwd, 'android', 'build.gradle'),
    join(cwd, 'android', 'build.gradle.kts'),
  ];

  for (const path of candidates) {
    const content = readIfExists(path);
    if (!content) continue;

    const match = /ndkVersion\s*[= ]\s*["']([\w.]+)["']/.exec(content);
    if (match) {
      return { version: match[1], source: path };
    }
  }

  return {};
}
