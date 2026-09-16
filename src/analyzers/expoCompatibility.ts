import { coerce } from 'semver';
import { detectExpo } from '../detectors/expo.js';
import { getExpoSdkRequirements } from '../data/expo/registry.js';
import type { ExpoCompatibilityResult } from '../types/expo.js';

interface PackageJsonContent {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Cross-references the detected Expo SDK version against the React Native version it's
 * expected to pin (see `data/expo/registry.ts`). Expo apps build against an exact React
 * Native version per SDK — unlike a bare React Native project, a mismatch here isn't just a
 * compatibility nuance, it typically means `expo install` / `expo-doctor` hasn't been run
 * since the last SDK bump and the project won't build via `expo prebuild`/EAS.
 */
export function analyzeExpoCompatibility(
  cwd: string,
  rnVersion: string | null,
  packageJson: PackageJsonContent
): ExpoCompatibilityResult {
  const detection = detectExpo(cwd, packageJson);

  if (!detection.isExpo) {
    return {
      isExpoProject: false,
      sdkVersion: null,
      actualReactNative: rnVersion,
      reactNativeMismatch: false,
      newArchRequired: false,
      messages: [],
    };
  }

  const messages: string[] = [];

  if (detection.sdkVersion === null) {
    return {
      isExpoProject: true,
      sdkVersion: null,
      actualReactNative: rnVersion,
      reactNativeMismatch: false,
      newArchRequired: false,
      messages: ['Expo project detected, but the SDK version could not be determined from package.json or app config.'],
    };
  }

  const requirements = getExpoSdkRequirements(detection.sdkVersion);
  if (!requirements) {
    return {
      isExpoProject: true,
      sdkVersion: detection.sdkVersion,
      actualReactNative: rnVersion,
      reactNativeMismatch: false,
      newArchRequired: false,
      messages: [`No compatibility data for Expo SDK ${detection.sdkVersion} yet — verify manually against https://expo.dev/changelog.`],
    };
  }

  const actualCoerced = rnVersion ? coerce(rnVersion) : null;
  const expectedCoerced = coerce(requirements.reactNative);
  const reactNativeMismatch = !!(
    actualCoerced &&
    expectedCoerced &&
    (actualCoerced.major !== expectedCoerced.major || actualCoerced.minor !== expectedCoerced.minor)
  );

  if (reactNativeMismatch) {
    messages.push(
      `Expo SDK ${detection.sdkVersion} pins React Native ${requirements.reactNative}, but this project has ${rnVersion} installed — run \`npx expo install --fix\` to align versions.`
    );
  } else if (!actualCoerced) {
    messages.push(
      `Expo SDK ${detection.sdkVersion} pins React Native ${requirements.reactNative}, but this project's React Native version could not be detected to confirm alignment.`
    );
  }

  if (requirements.newArchRequired) {
    messages.push(`Expo SDK ${detection.sdkVersion} requires the New Architecture — the legacy bridge is not available.`);
  }

  if (requirements.confidence === 'estimated') {
    messages.push(`Expo SDK ${detection.sdkVersion}'s expected React Native version is an estimate — verify against https://expo.dev/changelog.`);
  }

  return {
    isExpoProject: true,
    sdkVersion: detection.sdkVersion,
    expectedReactNative: requirements.reactNative,
    actualReactNative: rnVersion,
    reactNativeMismatch,
    newArchRequired: requirements.newArchRequired,
    messages,
  };
}
