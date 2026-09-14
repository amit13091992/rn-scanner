import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface JavaDetectionResult {
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

function normalizeJavaVersion(raw: string): string {
  // JavaVersion.VERSION_17 -> "17", JavaVersion.VERSION_1_8 -> "8"
  const versionUnderscore = /VERSION_1_(\d+)/.exec(raw);
  if (versionUnderscore) return versionUnderscore[1]!;
  const versionPlain = /VERSION_(\d+)/.exec(raw);
  if (versionPlain) return versionPlain[1]!;
  return raw;
}

/**
 * Detects the JDK/Java version targeted by the Android project, checking (in order):
 *  - android/gradle.properties `org.gradle.java.home` (path — version not derivable, so only
 *    used as a `source` hint) and any `java.version`-style properties some templates add
 *  - android/app/build.gradle(.kts) `compileOptions { sourceCompatibility JavaVersion.VERSION_17 }`
 *    or `sourceCompatibility = JavaVersion.VERSION_17`
 *  - android/build.gradle(.kts) with the same compileOptions form
 */
export function detectJavaVersion(cwd: string): JavaDetectionResult {
  const gradlePropsPath = join(cwd, 'android', 'gradle.properties');
  const gradleProps = readIfExists(gradlePropsPath);
  if (gradleProps) {
    const explicitVersion = /(?:^|\n)\s*java\.version\s*=\s*([\w.]+)/.exec(gradleProps);
    if (explicitVersion) {
      return { version: explicitVersion[1], source: gradlePropsPath };
    }
  }

  const candidates = [
    join(cwd, 'android', 'app', 'build.gradle'),
    join(cwd, 'android', 'app', 'build.gradle.kts'),
    join(cwd, 'android', 'build.gradle'),
    join(cwd, 'android', 'build.gradle.kts'),
  ];

  for (const path of candidates) {
    const content = readIfExists(path);
    if (!content) continue;

    const compatMatch = /sourceCompatibility\s*=?\s*JavaVersion\.(VERSION_\S+)/.exec(content);
    if (compatMatch) {
      return { version: normalizeJavaVersion(compatMatch[1]), source: path };
    }

    // Some configs use JavaLanguageVersion.of(17) (Kotlin DSL toolchain form)
    const toolchainMatch = /JavaLanguageVersion\.of\((\d+)\)/.exec(content);
    if (toolchainMatch) {
      return { version: toolchainMatch[1], source: path };
    }
  }

  return {};
}
