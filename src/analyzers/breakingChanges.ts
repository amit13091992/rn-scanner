import type { DependencyInfo } from '../types/dependency.js';
import type { BreakingChange } from '../types/dependency.js';
import { versionInRange, parseVersion, compareVersions } from '../utils/versionComparison.js';

/**
 * Whether a breaking change is historical (already true before the version being evaluated
 * against — e.g. already baked into the project prior to an `upgrade --to` run, so it isn't
 * caused by *this* upgrade), or newly relevant to the transition from `referenceVersion` to
 * the version being checked. `action_required` is the high/critical subset of `relevant` —
 * the changes that should actually influence a risk/verdict computation.
 */
export type BreakingChangeRelevance = 'historical' | 'relevant' | 'action_required';

function classifyRelevance(
  introducedInVersion: string,
  referenceVersion: string,
  severity: BreakingChange['severity']
): BreakingChangeRelevance {
  const alreadyInEffect = compareVersions(referenceVersion, introducedInVersion) >= 0;
  if (alreadyInEffect) return 'historical';
  return severity === 'critical' || severity === 'high' ? 'action_required' : 'relevant';
}

export interface BreakingChangeIssue {
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
  migrationGuide?: string;
  references?: string[];
  introducedInVersion: string;
  /**
   * `historical` when this change was already true at `staleAsOfVersion` (the currently
   * installed version) — not caused by whatever transition is being evaluated, so it should
   * not drive a risk/verdict computation. `relevant`/`action_required` when the change is
   * newly triggered by moving from the current version to the version being checked.
   * `action_required` is the critical/high-severity subset of `relevant`.
   *
   * Only present when a real transition is being evaluated (`upgrade --to`, which passes a
   * distinct `referenceDependencies` to `analyzeBreakingChanges`) — for a plain `check` (no
   * transition, just "what's true right now"), every match is trivially `historical` by
   * definition (see breakingChangeDatabase's `>=introducedInVersion`-style ranges), which
   * would misleadingly read as "safe to ignore" on an active, unaddressed issue. `check`
   * should keep using `stale` for its own action-required signal instead.
   */
  relevance?: BreakingChangeRelevance;
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
 *
 * This is deliberately a different, coarser test than `classifyRelevance`'s `historical`
 * value above: `stale` answers "is this old enough to stop nagging about on a plain check"
 * (an age-drift heuristic, always computed), while `relevance` answers "was this caused by
 * the specific transition an `upgrade --to` run is evaluating" (an exact version-boundary
 * comparison, only computed for a real transition). They can disagree — e.g. a change one
 * minor before the current version is not `stale` but is `historical` per `relevance` — and
 * that's expected: `check`'s action-required signal should keep using `stale`, `upgrade`'s
 * should keep using `relevance`. Don't conflate the two or try to derive one from the other.
 */
function isStaleBreakingChange(introducedInVersion: string, currentVersion: string): boolean {
  const introduced = parseVersion(introducedInVersion);
  const current = parseVersion(currentVersion);

  if (current.major !== introduced.major) {
    return current.major - introduced.major >= 2;
  }
  // A library's major-line migration (x.0.0) is almost certainly done once a few minors have
  // shipped on it; react-native's 0.x minors are each a migration, so they keep the wider window.
  return current.minor - introduced.minor >= (introduced.major === 0 ? 6 : 3);
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
    introducedInVersion: '0.88.0',
    affectedVersions: ['>=0.88.0'],
    severity: 'medium',
    changes: [
      'No user-facing API removals, but several deprecations: react-native/Libraries/Core/InitializeCore (use react-native/setup-env), InputAccessoryView (iOS), experimental_background* style keys (use backgroundSize/Position/Repeat)',
      'Events now follow the W3C EventTarget model by default — code reaching into RN event internals or the plugin registry may break',
      'Behavior changes: Android User-Agent now includes app name/version, radial gradients reject percentage radii, iOS text defaults to right-aligned in RTL when textAlign is unset',
      'iOS SceneDelegate (UIScene lifecycle) is added and becomes mandatory when building with the iOS 27 SDK / Xcode 27 — migrate AppDelegate entry points and add UIApplicationSceneManifest to Info.plist',
      'ObjC TurboModule ArrayBuffer type change was reverted before 0.88.0; Android TurboModule ArrayBuffer bytes are only valid during a synchronous call (copy with ArrayBuffer.arrayBufferWithCopiedBytes)',
      'Metro minimum is 0.87.1, React 19.3.0; babel-preset Platform.OS inlining now needs the inlinePlatform option',
    ],
    migrationGuide: 'https://reactnative.dev/blog/2026/10/19/react-native-0.88',
  },
  {
    package: 'react-native',
    introducedInVersion: '0.87.0',
    affectedVersions: ['>=0.87.0'],
    severity: 'high',
    changes: [
      'Strict TypeScript API is the default: deep imports from react-native/Libraries/* are type errors and ref types are now instance types',
      'Removed: InteractionManager (use requestIdleCallback), the Touchable root export (use ViewProps), NativeMethods types, the Modal animated prop, and several StatusBar props',
      'Deprecated: ImageBackground (use a View with an absolutely positioned Image)',
      'Toolchain floor raised: Android Gradle Plugin 9, compileSdk/buildTools 37, Node 22.13+',
    ],
    migrationGuide: 'https://reactnative.dev/docs/upgrading',
  },
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
    severity: 'high',
    changes: [
      'Requires the New Architecture — the legacy architecture is no longer supported',
      'Worklets moved into the separate react-native-worklets package, which must be installed as a peer dependency',
      'The Babel plugin moved from react-native-reanimated/plugin to react-native-worklets/plugin (babel-preset-expo handles this for Expo projects)',
      'Several APIs deprecated in 3.x were removed, e.g. useAnimatedGestureHandler (use the Gesture Handler 2 API instead)',
    ],
    migrationGuide: 'https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/',
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
    severity: 'high',
    changes: [
      'navigation.navigate() no longer navigates back to an existing screen in the stack — use popTo() for that behavior',
      'APIs deprecated during 6.x were removed (see the upgrade guide for the full list)',
      'Requires newer react-native-screens and react-native-safe-area-context peers',
    ],
    migrationGuide: 'https://reactnavigation.org/docs/upgrading-from-6.x',
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
    migrationGuide: 'https://reactnavigation.org/docs/upgrading-from-5.x',
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
    introducedInVersion: '58.0.0',
    affectedVersions: ['>=58.0.0'],
    severity: 'high',
    changes: [
      'SDK 58 pins React Native 0.88 and the strict TypeScript API: react-native/Libraries/* deep imports are type errors; InteractionManager, Touchable, NativeMethods types and the Modal animated prop are removed',
      'iOS UIScene lifecycle: prebuild generates SceneDelegate.swift; custom AppDelegate code or hand-managed ios/ directories need migration',
      'Android R8 minification is enabled by default in release builds',
      'expo-router: forked React Navigation APIs partly removed, withLayoutContext deprecated (use integrateWithRouter), server output is the default when web.output is unset; @expo/ui and expo-symbols are now optional peer dependencies',
      'expo-sqlite: libSQL support removed (syncLibSQL(), libSQLOptions)',
      'expo-file-system: File.write() is async (use File.writeSync() for the old behavior); File.md5 deprecated in favor of File.digest()',
      'expo-notifications: foreground notifications are shown by default',
      'expo-localization: supportsRTL no longer forces RTL on iOS',
      'expo-media-library: Asset.getUri() resolves the current video version',
      '@expo/ui: <Host> top-aligns on iOS and spacing defaults to nil',
      'NODE_ENV is set automatically, which changes which .env files load; Expo Go for SDK 58 supports SDK 58 only',
    ],
    migrationGuide: 'https://expo.dev/changelog/sdk-58',
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
  staleAsOfVersion?: string,
  isTransition = false
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

  const all = collectBreakingChanges(dep, relevantChanges, version, staleAsOfVersion, isTransition);
  if (all.length > 0) {
    return { package: dep.name, version, detected: true, hasData: true, issue: all[0]! };
  }

  return {
    package: dep.name,
    version,
    detected: false,
    hasData: true,
  };
}

function compareIntroduced(a: BreakingChange, b: BreakingChange): number {
  return compareVersions(b.introducedInVersion, a.introducedInVersion);
}

/**
 * Every database entry that applies to `version`, newest first. All non-stale entries are
 * returned (a project on react-native 0.88 is affected by both the 0.87 and 0.88 notes); if
 * every match is stale, only the newest is kept as a single historical note — the older
 * stale ones would just be noise. Previously the first-listed entry won, so an old entry such
 * as react-native 0.73 permanently hid every newer one.
 */
function collectBreakingChanges(
  dep: DependencyInfo,
  candidates: BreakingChange[],
  version: string,
  staleAsOfVersion: string | undefined,
  isTransition: boolean
): BreakingChangeIssue[] {
  const issues = candidates
    .filter((change) => change.affectedVersions.some((range) => versionInRange(version, range)))
    .sort(compareIntroduced)
    .map((change): BreakingChangeIssue => ({
      package: dep.name,
      version,
      severity: change.severity,
      changes: change.changes,
      migrationGuide: change.migrationGuide,
      references: change.references,
      introducedInVersion: change.introducedInVersion,
      stale: isStaleBreakingChange(change.introducedInVersion, staleAsOfVersion ?? version),
      ...(isTransition
        ? { relevance: classifyRelevance(change.introducedInVersion, staleAsOfVersion ?? version, change.severity) }
        : {}),
    }));

  // An entry from an earlier major line is superseded once a newer major's entry applies
  // (react-navigation 7.x is not asked to re-review the 6.0 migration). 0.x packages keep every
  // minor: each react-native minor is its own migration.
  const newest = issues[0];
  const newestMajor = newest ? parseVersion(newest.introducedInVersion).major : 0;
  const current = newestMajor === 0 ? issues : issues.filter((issue) => parseVersion(issue.introducedInVersion).major === newestMajor);

  const fresh = current.filter((issue) => !issue.stale);
  return fresh.length > 0 ? fresh : current.slice(0, 1);
}

/**
 * @param referenceDependencies The actual currently-installed dependencies, used only to
 *   anchor staleness when `dependencies` simulates a future/target state (see
 *   `detectBreakingChanges`'s `staleAsOfVersion`). Defaults to `dependencies` itself, which
 *   makes staleness a no-op adjustment for plain "check what I have now" callers.
 * @param isTransition Set true only by a caller genuinely evaluating a hypothetical
 *   version transition (currently just `upgrade.ts`) — this is what makes each issue's
 *   `relevance` field meaningful (see its docstring on `BreakingChangeIssue`). Deliberately an
 *   explicit parameter rather than inferred from `referenceDependencies !== dependencies`, so
 *   a future caller passing a *copy* of the same array (e.g. `[...dependencies]`) for
 *   unrelated reasons can't silently flip this on.
 */
export function analyzeBreakingChanges(
  dependencies: DependencyInfo[],
  referenceDependencies: DependencyInfo[] = dependencies,
  isTransition = false
): BreakingChangeCheckResult[] {
  const referenceByName = new Map(referenceDependencies.map(dep => [dep.name, dep]));
  return dependencies.flatMap(dep => {
    const reference = referenceByName.get(dep.name);
    const staleAsOfVersion = reference ? (reference.resolvedVersion || reference.requestedVersion) : undefined;
    const primary = detectBreakingChanges(dep, staleAsOfVersion, isTransition);
    if (!primary.detected) return [primary];
    const version = dep.resolvedVersion || dep.requestedVersion;
    const entries = breakingChangeDatabase.filter((change) => change.package === dep.name);
    return collectBreakingChanges(dep, entries, version, staleAsOfVersion, isTransition).map(
      (issue): BreakingChangeCheckResult => ({ package: dep.name, version, detected: true, hasData: true, issue })
    );
  });
}
