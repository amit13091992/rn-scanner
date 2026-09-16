import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { detectJavaVersion, detectInstalledJavaVersion } from '../detectors/android/java.js';
import { detectKotlinVersion } from '../detectors/android/kotlin.js';
import { detectAgpVersion } from '../detectors/android/agp.js';
import { detectGradleVersion } from '../detectors/android/gradle.js';
import { detectSdkVersions } from '../detectors/android/sdk.js';
import { detectNdkVersion } from '../detectors/android/ndk.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function compareVersionStrings(a: string, b: string): number {
  const aParts = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Coarse AGP-major -> minimum-compatible-Gradle-major table, used only to flag an
 * AGP/Gradle combination that's known to be incompatible (via the `reason` field) — not a
 * substitute for the full official compatibility matrix.
 */
function minGradleForAgp(agpMajor: number): number | undefined {
  if (agpMajor >= 8) return 8;
  if (agpMajor === 7) return 7;
  return undefined;
}

/**
 * Analyzes the Android native toolchain (JDK, Kotlin, AGP, Gradle, SDK levels, NDK,
 * buildToolsVersion) against the baseline React Native expects for `rnVersion`, modeling the
 * RN -> AGP -> Gradle -> JDK dependency chain rather than comparing each dimension in isolation.
 */
export function analyzeAndroidEnvironment(cwd: string, rnVersion: string): EnvironmentRequirement[] {
  const androidDir = join(cwd, 'android');
  const requirements = getReactNativeRequirements(rnVersion);

  if (!existsSync(androidDir)) {
    return [
      {
        name: 'Android project',
        status: 'unknown',
        reason: 'No android/ directory found — this does not look like a full React Native checkout.',
      },
    ];
  }

  // Prefer the project's declared JDK (authoritative when Gradle is pinned to it via
  // org.gradle.java.home or sourceCompatibility); fall back to the actually-installed JDK
  // on this machine (ground truth, like Xcode/Node) when the project doesn't declare one —
  // increasingly common since recent React Native Gradle Plugin versions set their own
  // defaults internally rather than requiring an explicit project declaration.
  let java = detectJavaVersion(cwd);
  if (!java.version) {
    const installed = detectInstalledJavaVersion();
    if (installed) {
      java = { version: installed, source: 'java -version (installed)' };
    }
  }
  const kotlin = detectKotlinVersion(cwd);
  const agp = detectAgpVersion(cwd);
  const gradle = detectGradleVersion(cwd);
  const sdk = detectSdkVersions(cwd);
  const ndk = detectNdkVersion(cwd);

  const results: EnvironmentRequirement[] = [];

  const agpMajor = agp.version ? Number.parseInt(agp.version, 10) : undefined;
  const gradleMajor = gradle.version ? Number.parseInt(gradle.version, 10) : undefined;
  let gradleAgpReason: string | undefined;
  if (agpMajor !== undefined && gradleMajor !== undefined) {
    const minGradle = minGradleForAgp(agpMajor);
    if (minGradle !== undefined && gradleMajor < minGradle) {
      gradleAgpReason = `Gradle ${gradle.version} is too old for AGP ${agp.version}; AGP ${agpMajor}.x requires Gradle ${minGradle}.x or newer.`;
    }
  }

  results.push(
    buildRequirement('JDK', java.version, requirements?.android.jdk, java.source, (current, required) =>
      compareVersionStrings(current, required) >= 0
        ? undefined
        : `JDK ${current} is older than the ${required} React Native ${rnVersion} expects.`,
    ),
  );

  results.push(
    buildRequirement('Kotlin', kotlin.version, requirements?.android.kotlin, kotlin.source, (current, required) =>
      compareVersionStrings(current, required) >= 0
        ? undefined
        : `Kotlin ${current} is older than the ${required} React Native ${rnVersion} expects.`,
    ),
  );

  results.push(
    buildRequirement('Android Gradle Plugin (AGP)', agp.version, requirements?.android.agp, agp.source, (current, required) =>
      compareVersionStrings(current, required) >= 0
        ? undefined
        : `AGP ${current} is older than the ${required} React Native ${rnVersion} expects.`,
    ),
  );

  results.push(
    buildRequirement(
      'Gradle',
      gradle.version,
      requirements?.android.gradle,
      gradle.source,
      (current, required) => {
        if (gradleAgpReason) return gradleAgpReason;
        return compareVersionStrings(current, required) >= 0
          ? undefined
          : `Gradle ${current} is older than the ${required} React Native ${rnVersion} expects.`;
      },
    ),
  );

  results.push(
    buildSdkRequirement('compileSdk', sdk.compileSdk, requirements?.android.compileSdk, sdk.source),
  );
  results.push(buildSdkRequirement('targetSdk', sdk.targetSdk, requirements?.android.targetSdk, sdk.source));
  results.push(buildSdkRequirement('minSdk', sdk.minSdk, requirements?.android.minSdk, sdk.source, true));

  results.push(
    buildRequirement('NDK', ndk.version, requirements?.android.ndk, ndk.source, (current, required) => {
      // NDK versions can legitimately diverge in the patch/build component; only flag a
      // mismatch when the major.minor differs from what RN expects.
      const currentMajorMinor = current.split('.').slice(0, 2).join('.');
      const requiredMajorMinor = required.split('.').slice(0, 2).join('.');
      return currentMajorMinor === requiredMajorMinor
        ? undefined
        : `NDK ${current} differs from the ${required} React Native ${rnVersion} expects.`;
    }),
  );

  // buildToolsVersion is informational-only: AGP supplies a sensible default when absent, so
  // its absence is never an error.
  results.push({
    name: 'Build Tools',
    current: sdk.buildToolsVersion,
    recommended: requirements?.android.buildToolsVersion,
    status: sdk.buildToolsVersion ? 'ok' : 'unknown',
    source: sdk.source,
    reason: sdk.buildToolsVersion
      ? undefined
      : 'Not explicitly set — AGP supplies a default, so this is informational only.',
  });

  return results;
}

function buildRequirement(
  name: string,
  current: string | undefined,
  required: string | undefined,
  source: string | undefined,
  compare: (current: string, required: string) => string | undefined,
): EnvironmentRequirement {
  if (!current) {
    return {
      name,
      required,
      status: 'unknown',
      source,
      reason: `Could not detect ${name} from the Android project files.`,
    };
  }

  if (!required) {
    return {
      name,
      current,
      status: 'unknown',
      source,
      reason: `No baseline requirement known for this React Native version.`,
    };
  }

  const reason = compare(current, required);
  return {
    name,
    current,
    required,
    status: reason ? 'warning' : 'ok',
    source,
    reason,
  };
}

function buildSdkRequirement(
  name: string,
  current: string | undefined,
  required: string | undefined,
  source: string | undefined,
  lowerIsBetter = false,
): EnvironmentRequirement {
  if (!current) {
    return {
      name,
      required,
      status: 'unknown',
      source,
      reason: `Could not detect ${name} from the Android project files.`,
    };
  }

  if (!required) {
    return {
      name,
      current,
      status: 'unknown',
      source,
      reason: 'No baseline requirement known for this React Native version.',
    };
  }

  const currentInt = toInt(current);
  const requiredInt = toInt(required);
  if (currentInt === undefined || requiredInt === undefined) {
    return { name, current, required, status: 'unknown', source, reason: 'Could not parse SDK level as a number.' };
  }

  const meetsRequirement = lowerIsBetter ? currentInt <= requiredInt : currentInt >= requiredInt;
  return {
    name,
    current,
    required,
    status: meetsRequirement ? 'ok' : 'warning',
    source,
    reason: meetsRequirement
      ? undefined
      : lowerIsBetter
        ? `${name} ${current} is higher than the ${required} React Native's baseline expects; this raises your minimum supported OS version.`
        : `${name} ${current} is lower than the ${required} React Native's baseline expects.`,
  };
}
