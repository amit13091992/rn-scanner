import { satisfies } from 'semver';
import { compatibilityRules, getCompatibilityRules } from '../data/compatibility.js';
import type { DependencyInfo } from '../types/dependency.js';
import { cleanVersion } from '../detectors/reactNative.js';

export interface CompatibilityIssue {
  package: string;
  version: string;
  status: 'compatible' | 'warning' | 'error';
  messages: string[];
}

export function analyzeCompatibility(
  dep: DependencyInfo,
  reactNativeVersion: string | null,
  reactVersion: string | null
): CompatibilityIssue {
  const rules = getCompatibilityRules(dep.name);
  const messages: string[] = [];
  let status: 'compatible' | 'warning' | 'error' = 'compatible';

  if (rules.length === 0) {
    return {
      package: dep.name,
      version: dep.requestedVersion,
      status: 'compatible',
      messages: ['No compatibility rules defined'],
    };
  }

  const cleanDepVersion = cleanVersion(dep.requestedVersion);

  for (const rule of rules) {
    const versionPattern = rule.version.replace('x', '\\d+').replace('.', '\\.');
    const isVersionMatch = new RegExp(`^${versionPattern}`).test(cleanDepVersion);

    if (!isVersionMatch) continue;

    if (rule.reactNative && reactNativeVersion) {
      const cleanRNVersion = cleanVersion(reactNativeVersion);
      try {
        if (!satisfies(cleanRNVersion, rule.reactNative)) {
          status = 'error';
          messages.push(
            `React Native ${cleanRNVersion} does not satisfy ${rule.reactNative}`
          );
        } else {
          messages.push(
            `✓ Compatible with React Native ${cleanRNVersion}`
          );
        }
      } catch (error) {
        messages.push(`Could not parse React Native version: ${cleanRNVersion}`);
      }
    }

    if (rule.react && reactVersion) {
      const cleanReactVersion = cleanVersion(reactVersion);
      try {
        if (!satisfies(cleanReactVersion, rule.react)) {
          status = status === 'error' ? 'error' : 'warning';
          messages.push(
            `React ${cleanReactVersion} does not satisfy ${rule.react}`
          );
        } else {
          messages.push(`✓ Compatible with React ${cleanReactVersion}`);
        }
      } catch (error) {
        messages.push(`Could not parse React version: ${cleanReactVersion}`);
      }
    }
  }

  if (messages.length === 0) {
    messages.push('Compatibility check passed');
  }

  return {
    package: dep.name,
    version: dep.requestedVersion,
    status,
    messages,
  };
}

export function analyzeAllDependencies(
  dependencies: DependencyInfo[],
  reactNativeVersion: string | null,
  reactVersion: string | null
): CompatibilityIssue[] {
  return dependencies.map((dep) =>
    analyzeCompatibility(dep, reactNativeVersion, reactVersion)
  );
}
