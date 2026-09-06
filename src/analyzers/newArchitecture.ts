import { getNewArchInfo } from '../data/newArchitecture.js';
import { detectNewArchitectureStatus } from '../detectors/newArchitecture.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { NewArchCheckResult } from '../types/newArchitecture.js';

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
    if (!info) continue;

    results.push({
      package: dep.name,
      version: dep.resolvedVersion || dep.requestedVersion,
      support: info.support,
      notes: info.notes,
    });
  }

  return { status, results };
}
