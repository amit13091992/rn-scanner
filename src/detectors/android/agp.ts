import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readVersionCatalogVersion } from './versionCatalog.js';

export interface AgpDetectionResult {
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
 * Detects the Android Gradle Plugin (AGP) version, checking (in order):
 *  - android/build.gradle(.kts) `com.android.tools.build:gradle:X.Y.Z` (classpath DSL)
 *  - android/build.gradle(.kts) / android/settings.gradle(.kts) `id("com.android.application")
 *    version "X.Y.Z"` (plugin DSL, incl. the `pluginManagement { plugins { ... } }` block newer
 *    templates put in settings.gradle rather than build.gradle)
 *  - android/gradle/libs.versions.toml `[versions] agp = "X.Y.Z"` (Gradle version catalog —
 *    the pattern newest RN templates use, resolved indirectly via `alias(libs.plugins.agp)`
 *    rather than a literal version string anywhere in a build.gradle file)
 */
export function detectAgpVersion(cwd: string): AgpDetectionResult {
  const candidates = [
    join(cwd, 'android', 'build.gradle'),
    join(cwd, 'android', 'build.gradle.kts'),
    join(cwd, 'android', 'app', 'build.gradle'),
    join(cwd, 'android', 'app', 'build.gradle.kts'),
    join(cwd, 'android', 'settings.gradle'),
    join(cwd, 'android', 'settings.gradle.kts'),
  ];

  for (const path of candidates) {
    const content = readIfExists(path);
    if (!content) continue;

    // classpath("com.android.tools.build:gradle:8.3.1") or 'com.android.tools.build:gradle:8.3.1'
    const classpathMatch = /com\.android\.tools\.build:gradle:([\d.]+)/.exec(content);
    if (classpathMatch) {
      return { version: classpathMatch[1], source: path };
    }

    // id("com.android.application") version "8.3.1"
    const pluginMatch = /com\.android\.application["'`]\s*\)?\s*version\s*["'`]([\d.]+)["'`]/.exec(content);
    if (pluginMatch) {
      return { version: pluginMatch[1], source: path };
    }
  }

  const catalogResult = readVersionCatalogVersion(cwd, ['agp', 'android-gradle-plugin', 'androidGradlePlugin']);
  if (catalogResult.version) {
    return catalogResult;
  }

  return {};
}
