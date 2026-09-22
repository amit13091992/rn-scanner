import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readVersionCatalogVersion } from './versionCatalog.js';

export interface KotlinDetectionResult {
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
 * Detects the Kotlin version declared in the Android project, checking (in order):
 *  - android/build.gradle(.kts) `ext { kotlinVersion = "..." }` (old Groovy DSL)
 *  - android/build.gradle(.kts) / android/settings.gradle(.kts) `id("org.jetbrains.kotlin.android")
 *    version "..."` (plugin DSL, incl. the `pluginManagement { plugins { ... } }` block newer
 *    templates put in settings.gradle)
 *  - android/app/build.gradle(.kts) with the same forms
 *  - android/gradle/libs.versions.toml `[versions] kotlin = "..."` (Gradle version catalog)
 */
export function detectKotlinVersion(cwd: string): KotlinDetectionResult {
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

    // ext { kotlinVersion = "1.9.24" } or kotlinVersion = "1.9.24"
    const extMatch = /kotlinVersion\s*=\s*['"]([\d.]+)['"]/.exec(content);
    if (extMatch) {
      return { version: extMatch[1], source: path };
    }

    // id("org.jetbrains.kotlin.android") version "1.9.24"
    const pluginMatch = /org\.jetbrains\.kotlin\.android["'`]\s*\)?\s*version\s*["'`]([\d.]+)["'`]/.exec(content);
    if (pluginMatch) {
      return { version: pluginMatch[1], source: path };
    }

    // kotlin("android") version "1.9.24"
    const kotlinDslMatch = /kotlin\(\s*["'`]android["'`]\s*\)\s*version\s*["'`]([\d.]+)["'`]/.exec(content);
    if (kotlinDslMatch) {
      return { version: kotlinDslMatch[1], source: path };
    }
  }

  const catalogResult = readVersionCatalogVersion(cwd, ['kotlin', 'kotlin-android', 'kotlinAndroid']);
  if (catalogResult.version) {
    return catalogResult;
  }

  return {};
}
