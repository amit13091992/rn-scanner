import { getExpoGoInfo } from '../data/expo/goSupport.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { ExpoGoCheckResult } from '../types/expoGo.js';

/**
 * Same heuristic as `analyzers/newArchitecture.ts`'s LIKELY_NATIVE_MODULE_PATTERN: packages
 * matching this are very likely to ship native code, so an absent curated entry is a real
 * "verify manually" gap rather than something safe to assume works in Expo Go.
 */
const LIKELY_NATIVE_MODULE_PATTERN = /^(react-native-|@react-native-community\/|@react-native-firebase\/)/;

const TOOLING_EXCLUSION_PATTERN = /^@react-native-community\/cli(-|$)|-transformer$/;

/**
 * Reports, per installed dependency, whether it works inside the Expo Go sandbox app or
 * requires a custom dev client. Only meaningful for Expo projects — returns [] otherwise
 * rather than emitting a support verdict for a question that doesn't apply.
 */
export function analyzeExpoGoSupport(
  dependencies: DependencyInfo[],
  isExpoProject: boolean
): ExpoGoCheckResult[] {
  if (!isExpoProject) {
    return [];
  }

  const results: ExpoGoCheckResult[] = [];

  for (const dep of dependencies) {
    const info = getExpoGoInfo(dep.name);
    const version = dep.resolvedVersion || dep.requestedVersion;

    if (info) {
      results.push({ package: dep.name, version, support: info.support, reason: info.reason, notes: info.notes });
      continue;
    }

    if (LIKELY_NATIVE_MODULE_PATTERN.test(dep.name) && !TOOLING_EXCLUSION_PATTERN.test(dep.name)) {
      results.push({
        package: dep.name,
        version,
        support: 'unknown',
        notes: 'No Expo Go compatibility data available — verify manually before relying on Expo Go for this package',
      });
    }
  }

  return results;
}
