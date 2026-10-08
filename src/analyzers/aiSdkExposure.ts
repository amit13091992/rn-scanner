import type { DependencyInfo } from '../types/dependency.js';
import type { AiSdkExposureResult } from '../types/aiSdkExposure.js';
import { AI_SDK_PACKAGES } from '../data/aiSdkPackages.js';
import { scanForAiKeyLiterals } from '../detectors/aiSdkUsage.js';

/**
 * Flags React Native projects that call an AI provider SDK directly from client code, and/or
 * embed an AI-provider-key-shaped literal in source. Dependency-list cross-reference plus a
 * source scan — no network calls, no new runtime dependency, consistent with this project's
 * "prefer deterministic analysis" rule. A client calling an AI provider directly ships that
 * provider's key inside the app bundle, which is why `directCallWarning` fires independently of
 * whether a key literal was actually found — the SDK being present at all is the risk.
 */
export function analyzeAiSdkExposure(cwd: string, dependencies: DependencyInfo[]): AiSdkExposureResult {
  const installedNames = new Set(dependencies.map((d) => d.name));
  const sdksDetected = AI_SDK_PACKAGES.filter((entry) => installedNames.has(entry.packageName))
    .map((entry) => ({ packageName: entry.packageName, provider: entry.provider }));

  const { exposures, filesScanned } = scanForAiKeyLiterals(cwd);

  return {
    sdksDetected,
    directCallWarning: sdksDetected.length > 0,
    keyExposures: exposures,
    filesScanned,
  };
}
