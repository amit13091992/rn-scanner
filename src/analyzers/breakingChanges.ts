import type { DependencyInfo } from '../types/dependency.js';
import type { BreakingChange } from '../types/dependency.js';
import { versionInRange } from '../utils/versionComparison.js';

export interface BreakingChangeIssue {
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
  migrationGuide?: string;
  references?: string[];
  introducedInVersion: string;
}

export interface BreakingChangeCheckResult {
  package: string;
  version: string;
  detected: boolean;
  hasData: boolean;
  issue?: BreakingChangeIssue;
}

const breakingChangeDatabase: BreakingChange[] = [
  {
    package: 'react-native',
    introducedInVersion: '0.73.0',
    affectedVersions: ['>=0.73.0'],
    severity: 'critical',
    changes: [
      'Removed Flipper support by default',
      'Changed TypeScript configuration requirements',
      'Modified native module linking process',
    ],
    migrationGuide: 'https://reactnative.dev/docs/upgrading',
  },
  {
    package: 'react-native',
    introducedInVersion: '0.72.0',
    affectedVersions: ['>=0.72.0'],
    severity: 'high',
    changes: [
      'Removed support for Android API level < 21',
      'Changed Gradle plugin requirements',
      'Modified Hermes compilation flags',
    ],
  },
  {
    package: 'react-native',
    introducedInVersion: '0.71.0',
    affectedVersions: ['>=0.71.0'],
    severity: 'high',
    changes: [
      'Deprecated useWindowDimensions API',
      'Changed Metro bundler default configuration',
    ],
  },
  {
    package: 'react-native-reanimated',
    introducedInVersion: '4.0.0',
    affectedVersions: ['>=4.0.0'],
    severity: 'critical',
    changes: [
      'Removed Animated API compatibility',
      'Changed worklet syntax and compilation',
      'Modified gesture handler integration',
    ],
    migrationGuide: 'https://docs.swmansion.com/react-native-reanimated/docs/migration',
  },
  {
    package: 'react-native-reanimated',
    introducedInVersion: '3.0.0',
    affectedVersions: ['>=3.0.0', '<4.0.0'],
    severity: 'high',
    changes: [
      'Removed layout animation support',
      'Changed animation callback signatures',
    ],
  },
  {
    package: 'react-native-screens',
    introducedInVersion: '4.0.0',
    affectedVersions: ['>=4.0.0'],
    severity: 'high',
    changes: [
      'Removed deprecated navigation events',
      'Changed screen lifecycle methods',
    ],
  },
  {
    package: '@react-navigation/native',
    introducedInVersion: '7.0.0',
    affectedVersions: ['>=7.0.0'],
    severity: 'critical',
    changes: [
      'Removed deprecated navigator props',
      'Changed route params API',
      'Modified listener API signature',
    ],
    migrationGuide: 'https://reactnavigation.org/docs/upgrading-from-5.x',
  },
  {
    package: '@react-navigation/native',
    introducedInVersion: '6.0.0',
    affectedVersions: ['>=6.0.0', '<7.0.0'],
    severity: 'high',
    changes: [
      'Removed context-based navigation',
      'Changed action dispatching mechanism',
    ],
  },
];

export function detectBreakingChanges(dep: DependencyInfo): BreakingChangeCheckResult {
  const version = dep.resolvedVersion || dep.requestedVersion;
  const relevantChanges = breakingChangeDatabase.filter(change => change.package === dep.name);

  if (relevantChanges.length === 0) {
    return {
      package: dep.name,
      version,
      detected: false,
      hasData: false,
    };
  }

  for (const change of relevantChanges) {
    const affectsVersion = change.affectedVersions.some(range => versionInRange(version, range));

    if (affectsVersion) {
      return {
        package: dep.name,
        version,
        detected: true,
        hasData: true,
        issue: {
          package: dep.name,
          version,
          severity: change.severity,
          changes: change.changes,
          migrationGuide: change.migrationGuide,
          references: change.references,
          introducedInVersion: change.introducedInVersion,
        },
      };
    }
  }

  return {
    package: dep.name,
    version,
    detected: false,
    hasData: true,
  };
}

export function analyzeBreakingChanges(
  dependencies: DependencyInfo[]
): BreakingChangeCheckResult[] {
  return dependencies.map(dep => detectBreakingChanges(dep));
}
