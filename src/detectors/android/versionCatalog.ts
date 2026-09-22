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
 * Reads a Gradle version catalog (`android/gradle/libs.versions.toml`) for one of the given
 * `[versions]` keys. Modern RN templates increasingly declare AGP/Kotlin here (referenced from
 * `android/settings.gradle`'s `pluginManagement` block via `alias(libs.plugins....)`) rather
 * than as a literal version string in a `build.gradle` classpath/plugin line — without this,
 * `detectAgpVersion`/`detectKotlinVersion` report nothing for any project using this pattern.
 * Regex-based (consistent with every other detector here) rather than a full TOML parser,
 * since only a single flat `[versions]` key = "value" pair needs to be read.
 */
export function readVersionCatalogVersion(cwd: string, keys: string[]): VersionCatalogResult {
  const path = join(cwd, 'android', 'gradle', 'libs.versions.toml');
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
