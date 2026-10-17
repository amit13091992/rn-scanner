import { satisfies } from 'semver';
import { getCompatibilityRules } from '../data/compatibility.js';
import type { DependencyInfo, CompatibilityCheckResult, CompatibilityStatus, CompatibilityRule } from '../types/dependency.js';
import { normalizeVersion } from '../utils/versionComparison.js';

export function analyzeCompatibility(
  dep: DependencyInfo,
  reactNativeVersion: string | null,
  reactVersion: string | null,
  customRules: CompatibilityRule[] = []
): CompatibilityCheckResult {
  // Project-specific rules (`.rn-dep-scanner.json`'s `customCompatibilityRules`) are checked
  // in addition to the curated built-ins, not instead of them — an internal fork or an
  // unreleased dependency this project depends on can get a rule without waiting on
  // `data/compatibility.ts` to be updated upstream.
  const rules = [...getCompatibilityRules(dep.name), ...customRules.filter((r) => r.package === dep.name)];
  const messages: string[] = [];
  let status: CompatibilityStatus = 'compatible';
  let detectedFrom: 'rules' | 'no-rules' | 'no-lock-file' = 'rules';

  if (rules.length === 0) {
    return {
      package: dep.name,
      version: dep.resolvedVersion || dep.requestedVersion,
      status: 'not-checked',
      reason: 'No compatibility rules defined for this package',
      messages: [],
      detectedFrom: 'no-rules',
    };
  }

  const depVersion = normalizeVersion(dep.resolvedVersion || dep.requestedVersion);

  if (!depVersion) {
    return {
      package: dep.name,
      version: dep.resolvedVersion || dep.requestedVersion,
      status: 'error',
      reason: 'Could not parse package version',
      messages: ['Invalid version format'],
      detectedFrom: 'rules',
    };
  }

  let foundMatchingRule = false;

  for (const rule of rules) {
    const ruleVersion = normalizeVersion(rule.version);
    if (!ruleVersion) continue;

    let isVersionMatch = false;

    if (rule.version.includes('x') || rule.version.includes('*')) {
      const pattern = rule.version
        .replace(/\*/g, '\\d+')
        .replace(/x/g, '\\d+')
        .replace(/\./g, '\\.');
      isVersionMatch = new RegExp(`^${pattern}`).test(depVersion);
    } else {
      isVersionMatch = satisfies(depVersion, rule.version);
    }

    if (!isVersionMatch) continue;

    foundMatchingRule = true;

    if (rule.reactNative && reactNativeVersion) {
      const cleanRNVersion = normalizeVersion(reactNativeVersion);
      try {
        if (!satisfies(cleanRNVersion, rule.reactNative)) {
          status = 'error';
          messages.push(
            `✕ Incompatible with React Native ${cleanRNVersion} (requires ${rule.reactNative})`
          );
        } else if (rule.reactNativeTested && !satisfies(cleanRNVersion, rule.reactNativeTested)) {
          status = status === 'error' ? 'error' : 'warning';
          messages.push(
            `⚠ React Native ${cleanRNVersion} is newer than the range this package documents as tested (${rule.reactNativeTested}) — not known to be broken; verify on your own build`
          );
        } else {
          messages.push(
            `✓ Compatible with React Native ${cleanRNVersion}`
          );
        }
      } catch {
        messages.push(`Could not parse React Native version: ${cleanRNVersion}`);
      }
    }

    if (rule.react && reactVersion) {
      const cleanReactVersion = normalizeVersion(reactVersion);
      try {
        if (!satisfies(cleanReactVersion, rule.react)) {
          status = status === 'error' ? 'error' : 'warning';
          messages.push(
            `⚠ Potential issue with React ${cleanReactVersion} (requires ${rule.react})`
          );
        } else {
          messages.push(`✓ Compatible with React ${cleanReactVersion}`);
        }
      } catch {
        messages.push(`Could not parse React version: ${cleanReactVersion}`);
      }
    }
  }

  if (!foundMatchingRule) {
    return {
      package: dep.name,
      version: dep.resolvedVersion || dep.requestedVersion,
      status: 'not-checked',
      reason: 'No matching compatibility rule for this version',
      messages: [],
      detectedFrom: 'no-rules',
    };
  }

  if (messages.length === 0) {
    messages.push('✓ Compatibility check passed');
  }

  return {
    package: dep.name,
    version: dep.resolvedVersion || dep.requestedVersion,
    status,
    messages,
    detectedFrom: 'rules',
  };
}

export function analyzeAllDependencies(
  dependencies: DependencyInfo[],
  reactNativeVersion: string | null,
  reactVersion: string | null,
  customRules: CompatibilityRule[] = []
): CompatibilityCheckResult[] {
  return dependencies.map((dep) =>
    analyzeCompatibility(dep, reactNativeVersion, reactVersion, customRules)
  );
}
