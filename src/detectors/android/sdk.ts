import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SdkDetectionResult {
  compileSdk?: string;
  targetSdk?: string;
  minSdk?: string;
  buildToolsVersion?: string;
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

function extractSdkValue(content: string, names: string[]): string | undefined {
  for (const name of names) {
    // Old syntax: compileSdkVersion 31 / compileSdkVersion rootProject.ext.compileSdkVersion
    // New syntax: compileSdk 31 / compileSdk = 31
    const numeric = new RegExp(`${name}\\s*=?\\s*(\\d+)`).exec(content);
    if (numeric) return numeric[1];
  }
  return undefined;
}

/**
 * Detects compileSdk/targetSdk/minSdk/buildToolsVersion from android/build.gradle(.kts) and
 * android/app/build.gradle(.kts), supporting both the old `compileSdkVersion 31` syntax and the
 * new `compileSdk 31` syntax. buildToolsVersion is informational-only — absent is normal, since
 * AGP supplies a sensible default when it's omitted.
 */
export function detectSdkVersions(cwd: string): SdkDetectionResult {
  const candidates = [
    join(cwd, 'android', 'app', 'build.gradle'),
    join(cwd, 'android', 'app', 'build.gradle.kts'),
    join(cwd, 'android', 'build.gradle'),
    join(cwd, 'android', 'build.gradle.kts'),
  ];

  const result: SdkDetectionResult = {};
  let source: string | undefined;

  for (const path of candidates) {
    const content = readIfExists(path);
    if (!content) continue;
    source ??= path;

    if (!result.compileSdk) {
      result.compileSdk = extractSdkValue(content, ['compileSdkVersion', 'compileSdk']);
    }
    if (!result.targetSdk) {
      result.targetSdk = extractSdkValue(content, ['targetSdkVersion', 'targetSdk']);
    }
    if (!result.minSdk) {
      result.minSdk = extractSdkValue(content, ['minSdkVersion', 'minSdk']);
    }
    if (!result.buildToolsVersion) {
      const buildToolsMatch = /buildToolsVersion\s*[= ]\s*["']([\d.]+)["']/.exec(content);
      if (buildToolsMatch) {
        result.buildToolsVersion = buildToolsMatch[1];
      }
    }
  }

  if (source) {
    result.source = source;
  }

  return result;
}
