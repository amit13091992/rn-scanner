import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface VersionCatalogResult {
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
 * Reads a Gradle version catalog TOML file at `path` for one of the given `[versions]` keys.
 * Regex-based (consistent with every other detector here) rather than a full TOML parser,
 * since only a single flat `[versions]` key = "value" pair needs to be read.
 */
function readCatalogAt(path: string, keys: string[]): VersionCatalogResult {
  const content = readIfExists(path);
  if (!content) return {};

  const versionsSectionMatch = /\[versions\]([\s\S]*?)(?:\n\[|$)/.exec(content);
  const versionsSection = versionsSectionMatch ? versionsSectionMatch[1] : content;

  for (const key of keys) {
    const keyPattern = new RegExp(`^\\s*${key}\\s*=\\s*["']([\\d.]+)["']`, 'm');
    const match = keyPattern.exec(versionsSection);
    if (match) {
      return { version: match[1], source: path };
    }
  }

  return {};
}

/**
 * Reads the project's own Gradle version catalog (`android/gradle/libs.versions.toml`) for one
 * of the given `[versions]` keys. Modern RN templates increasingly declare AGP/Kotlin here
 * (referenced from `android/settings.gradle`'s `pluginManagement` block via
 * `alias(libs.plugins....)`) rather than as a literal version string in a `build.gradle`
 * classpath/plugin line — without this, `detectAgpVersion`/`detectKotlinVersion` report
 * nothing for any project using this pattern.
 */
export function readVersionCatalogVersion(cwd: string, keys: string[]): VersionCatalogResult {
  return readCatalogAt(join(cwd, 'android', 'gradle', 'libs.versions.toml'), keys);
}

/**
 * Reads `@react-native/gradle-plugin`'s own bundled version catalog
 * (`node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml`) as a last resort.
 * Confirmed against a real `react-native init` (0.76.9) project: as of RN 0.76+, the AGP
 * version isn't declared anywhere in the user's own project files at all —
 * `android/build.gradle`'s classpath line is version-less (`classpath("com.android.tools.build:gradle")`)
 * and there's no project-level `libs.versions.toml` either; the actual version Gradle resolves
 * comes from this bundled catalog via `android/settings.gradle`'s
 * `includeBuild("../node_modules/@react-native/gradle-plugin")`. It's the one AGP/Kotlin
 * version the project's own Gradle build will actually use, just not declared in a project file
 * — not a guess at an unrelated library's own build requirements.
 */
export function readReactNativeGradlePluginCatalogVersion(cwd: string, keys: string[]): VersionCatalogResult {
  return readCatalogAt(join(cwd, 'node_modules', '@react-native', 'gradle-plugin', 'gradle', 'libs.versions.toml'), keys);
}
