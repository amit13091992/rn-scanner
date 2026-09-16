import type { DependencyInfo } from '../types/dependency.js';
import type { BreakingChange } from '../types/dependency.js';
import { versionInRange, parseVersion } from '../utils/versionComparison.js';

export interface BreakingChangeIssue {
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
  migrationGuide?: string;
  references?: string[];
  introducedInVersion: string;
  /**
   * True when the installed version is far enough past introducedInVersion that this is
   * very likely already baked into the codebase rather than a pending action item — an
   * entry with no upper-bounded affectedVersions would otherwise match forever. Since
   * `check` has no way to know whether the user just upgraded or has been on this version
   * for years, we downgrade old matches to informational rather than claiming urgency we
   * can't actually back up.
   */
  stale: boolean;
}

/**
 * A breaking change is treated as historical/stale once the installed version has drifted
 * far enough past introducedInVersion that the change is very unlikely to be a fresh,
 * pending action. Two majors ahead, or (within the same major — the common case for both
 * 0.x-versioned react-native and typical semver libraries whose minor bumps are frequent
 * but rarely breaking) six or more minors ahead, counts as stale.
 */
function isStaleBreakingChange(introducedInVersion: string, currentVersion: string): boolean {
  const introduced = parseVersion(introducedInVersion);
  const current = parseVersion(currentVersion);

  if (current.major !== introduced.major) {
    return current.major - introduced.major >= 2;
  }
  return current.minor - introduced.minor >= 6;
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
  {
    package: 'redux',
    introducedInVersion: '5.0.0',
    affectedVersions: ['>=5.0.0'],
    severity: 'high',
    changes: [
      'Dropped support for Node.js < 18',
      'Changed TypeScript types structure',
      'Removed old middleware API',
    ],
    migrationGuide: 'https://redux.js.org/usage/store-setup',
  },
  {
    package: 'expo',
    introducedInVersion: '50.0.0',
    affectedVersions: ['>=50.0.0'],
    severity: 'high',
    changes: [
      'Removed EAS Build v1 support',
      'Changed app.json schema',
      'Requires SDK 50+ React Native version',
    ],
    migrationGuide: 'https://docs.expo.dev/home/',
  },
  {
    package: 'react-native-gesture-handler',
    introducedInVersion: '3.0.0',
    affectedVersions: ['>=3.0.0'],
    severity: 'high',
    changes: [
      'Changed native module initialization',
      'Removed old touch handling',
      'Modified gesture state API',
    ],
    migrationGuide: 'https://docs.swmansion.com/react-native-gesture-handler/docs/upgrade-guide',
  },
  {
    package: 'react-native-svg',
    introducedInVersion: '15.0.0',
    affectedVersions: ['>=15.0.0'],
    severity: 'medium',
    changes: [
      'Updated SVG spec compliance',
      'Changed prop naming conventions',
      'Modified viewBox handling',
    ],
  },
  {
    package: 'expo-camera',
    introducedInVersion: '14.0.0',
    affectedVersions: ['>=14.0.0'],
    severity: 'high',
    changes: [
      'Removed deprecated permissions API',
      'Changed camera types structure',
      'Modified flash mode options',
    ],
  },
  {
    package: 'firebase',
    introducedInVersion: '10.0.0',
    affectedVersions: ['>=10.0.0'],
    severity: 'high',
    changes: [
      'Removed compat API',
      'Changed import paths',
      'Modified auth state handling',
    ],
    migrationGuide: 'https://firebase.google.com/docs/web/modular-upgrade',
  },
  {
    package: '@react-native-community/async-storage',
    introducedInVersion: '2.0.0',
    affectedVersions: ['>=2.0.0'],
    severity: 'medium',
    changes: [
      'Changed error handling',
      'Removed promise-based batch operations',
      'Modified multiGet/multiSet API',
    ],
  },
];

/**
 * @param staleAsOfVersion The version to measure staleness from — normally the same as
 *   dep's own version, but callers evaluating a *hypothetical* future version (e.g.
 *   `upgrade --to` simulating react-native at the target version) should pass the actual
 *   currently-installed version here instead. Otherwise a change introduced long before an
 *   ambitious target version gets wrongly marked stale/"already migrated" when it's really a
 *   brand new, actionable change for that specific upgrade.
 */
export function detectBreakingChanges(
  dep: DependencyInfo,
  staleAsOfVersion?: string
): BreakingChangeCheckResult {
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
          stale: isStaleBreakingChange(change.introducedInVersion, staleAsOfVersion ?? version),
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

/**
 * @param referenceDependencies The actual currently-installed dependencies, used only to
 *   anchor staleness when `dependencies` simulates a future/target state (see
 *   `detectBreakingChanges`'s `staleAsOfVersion`). Defaults to `dependencies` itself, which
 *   makes staleness a no-op adjustment for plain "check what I have now" callers.
 */
export function analyzeBreakingChanges(
  dependencies: DependencyInfo[],
  referenceDependencies: DependencyInfo[] = dependencies
): BreakingChangeCheckResult[] {
  const referenceByName = new Map(referenceDependencies.map(dep => [dep.name, dep]));
  return dependencies.map(dep => {
    const reference = referenceByName.get(dep.name);
    const staleAsOfVersion = reference ? (reference.resolvedVersion || reference.requestedVersion) : undefined;
    return detectBreakingChanges(dep, staleAsOfVersion);
  });
}
