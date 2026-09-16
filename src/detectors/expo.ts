import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoDetectionResult } from '../types/expo.js';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseSdkMajor(version: string): number | null {
  const match = /(\d+)/.exec(version.replace(/^[\^~>=<\s]+/, ''));
  return match ? Number.parseInt(match[1], 10) : null;
}

interface PackageJsonContent {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detects whether this is an Expo project and, if so, its SDK major version. Checks (in
 * priority order):
 *  - package.json `dependencies.expo` / `devDependencies.expo` (e.g. "~52.0.11" -> SDK 52) —
 *    the most reliable signal for any project using local builds (SDK 46+).
 *  - app.json / app.config.json `expo.sdkVersion` (e.g. "50.0.0") — older managed-workflow
 *    style declaration, used as a fallback when the expo package isn't a direct dependency.
 */
export function detectExpo(cwd: string, packageJson: PackageJsonContent): ExpoDetectionResult {
  const expoRange = packageJson.dependencies?.expo ?? packageJson.devDependencies?.expo;
  if (expoRange) {
    const sdkVersion = parseSdkMajor(expoRange);
    return { isExpo: true, sdkVersion, source: 'package.json (expo dependency)' };
  }

  for (const fileName of ['app.json', 'app.config.json']) {
    const content = readFileSafe(join(cwd, fileName));
    if (!content) continue;

    try {
      const parsed = JSON.parse(content);
      const sdkVersionString = parsed?.expo?.sdkVersion;
      if (typeof sdkVersionString === 'string') {
        return {
          isExpo: true,
          sdkVersion: parseSdkMajor(sdkVersionString),
          source: `${fileName} (expo.sdkVersion)`,
        };
      }
      if (parsed?.expo) {
        // Has an "expo" config block but no explicit sdkVersion field.
        return { isExpo: true, sdkVersion: null, source: fileName };
      }
    } catch {
      // ignore malformed JSON, best-effort detection
    }
  }

  return { isExpo: false, sdkVersion: null };
}
