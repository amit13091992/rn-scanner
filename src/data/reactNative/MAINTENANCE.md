# Maintaining `registry.ts`

This registry is the single source of truth `doctor`, `upgrade --to`, and `compare-rn` use to
decide READY/WARN/BLOCKED. It is hand-maintained data, not derived from any API — it goes
stale the moment React Native ships a new minor version, and nothing in CI currently detects
that automatically. This file exists so updating it is a checklist, not a guess.

## When to update

Whenever a new React Native minor version ships (check https://github.com/facebook/react-native/releases
or the version history at https://react-native-community.github.io/upgrade-helper/).

## How to update

1. Diff the new version's template against the previous one using the
   [Upgrade Helper](https://react-native-community.github.io/upgrade-helper/) — it shows the
   exact `android/` and `ios/` template changes between two RN versions.
2. From that diff, pull: JDK, Kotlin, AGP, Gradle, compileSdk, targetSdk, minSdk, NDK,
   buildToolsVersion (Android) and Xcode, iOS deployment target, CocoaPods, Ruby, Swift (iOS).
3. Pull the minimum Node.js version from the release's `package.json` `engines.node` field in
   the `react-native` package itself, not the app template.
4. Append one entry to `REACT_NATIVE_REQUIREMENTS_REGISTRY` in `registry.ts` — do not edit
   past entries unless correcting a confirmed error (see Confirmed vs. estimated below).
5. Update the source table below with the new row.
6. Run `npm run test` — `test/reactNativeRegistry.test.ts` checks structural discipline
   (no version gaps, every field present, Node baseline non-decreasing) but cannot validate
   that the *values* are correct. That step is manual (step 1-3 above).

## Confirmed vs. estimated

| Version | Status | Source |
|---|---|---|
| 0.70 - 0.79 | Confirmed | Upgrade Helper template diffs at authoring time |
| 0.80 - 0.83 | Estimated | Not yet shipped at authoring time; extrapolated from the 0.76-0.79 trend |
| 0.84 | Estimated | Extrapolated; Node 22.13 baseline carried forward from 0.84 assumption below |
| 0.85 - 0.86 | Estimated | Extrapolated from 0.83/0.84/0.87 trend |
| 0.87 | Partially confirmed | compileSdk/buildTools 37, minCompileSdk 34, AGP 9.0 floor, and Node 22+ from public 0.87 release notes; JDK/Kotlin/Gradle/NDK and all iOS values are still estimated |

Any entry marked "Estimated" should be replaced with a "Confirmed" value (and this table
updated) as soon as that RN version actually ships and its template can be diffed directly.
