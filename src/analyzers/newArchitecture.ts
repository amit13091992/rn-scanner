import { getNewArchInfo } from '../data/newArchitecture.js';
import { detectNewArchitectureStatus } from '../detectors/newArchitecture.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { NewArchCheckResult } from '../types/newArchitecture.js';

/**
 * Packages matching this pattern are very likely to ship native (Android/iOS) code and
 * therefore care about New Architecture support, even when we have no curated entry for
 * them in data/newArchitecture.ts. Since RN 0.82 removed the legacy bridge entirely, having
 * no compatibility signal for a native module is a real risk worth surfacing, not silence.
 */
const LIKELY_NATIVE_MODULE_PATTERN = /^(react-native-|@react-native-community\/|@react-navigation\/)/;

/**
 * Build-time/dev tooling that happens to match LIKELY_NATIVE_MODULE_PATTERN but ships no
 * runtime native module of its own, so it has no New Architecture (Fabric/TurboModules)
 * status to speak of — flagging it as "verify manually before upgrading" is a false positive.
 */
const TOOLING_EXCLUSION_PATTERN = /^@react-native-community\/cli(-|$)|-transformer$/;

export function analyzeNewArchitecture(
  dependencies: DependencyInfo[],
  reactNativeVersion: string | null
): { status: ReturnType<typeof detectNewArchitectureStatus>; results: NewArchCheckResult[] } {
  const status = detectNewArchitectureStatus(reactNativeVersion);
  const results: NewArchCheckResult[] = [];

  if (!status.isNewArchDefault) {
    return { status, results };
  }

  for (const dep of dependencies) {
    const info = getNewArchInfo(dep.name);
    const version = dep.resolvedVersion || dep.requestedVersion;

    if (info) {
      results.push({ package: dep.name, version, support: info.support, notes: info.notes });
      continue;
    }

    if (LIKELY_NATIVE_MODULE_PATTERN.test(dep.name) && !TOOLING_EXCLUSION_PATTERN.test(dep.name)) {
      results.push({
        package: dep.name,
        version,
        support: 'unknown',
        notes: 'No New Architecture compatibility data available — verify manually before upgrading',
      });
    }
  }

  return { status, results };
}
