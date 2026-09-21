# rn-dep-scanner

A React Native project health scanner: dependency compatibility, breaking changes, New Architecture (Fabric/TurboModules) support, Expo compatibility, Hermes status, native Android/iOS toolchain checks (including Android 16KB page-size alignment and iOS dSYM presence), dependency completeness, and upgrade-readiness reports.

## Install

`rn-dep-scanner` is a dev-only CLI tool — it's never imported by your app's runtime code, so it
should never end up in your production dependency tree. A global install (or `npx`) sidesteps
the question entirely; if you do install it locally into a project, use `--save-dev`/`-D` so it
lands in `devDependencies`, not `dependencies` (npm has no way for a package to force this
itself — it's determined entirely by the flag you pass to `npm install`).

```bash
npm install -g rn-dep-scanner
# or
npx rn-dep-scanner
# or, to pin a version per-project instead of installing globally:
npm install --save-dev rn-dep-scanner
```

## Commands

### `check` — dependency compatibility (default command)

```bash
rn-dep-scanner check [--json] [--strict] [--cwd <path>] [--no-security] [--profile]
```

Analyzes `package.json` + lockfile against React/React Native, flags version mismatches, duplicate/peer-dependency conflicts, deprecated packages, breaking changes, and New Architecture incompatibilities. Also checks (Expo projects only) whether the Expo SDK matches the installed React Native version and whether each installed package works in Expo Go, plus (all projects) whether each installed package's own sub-dependencies are actually present and version-satisfied. Reports a 0–100 health score. `--strict` exits 1 on errors (or on a critical/high vulnerability). Checks resolved versions — direct **and transitive** — against known vulnerabilities via OSV.dev by default (requires network; pass `--no-security` to skip). `--profile` prints a per-step timing breakdown of the scan itself.

Per-project rule overrides live in an optional `.rn-dep-scanner.json` at the project root:

```json
{
  "ignorePackages": ["some-noisy-package"],
  "ignoreVulnerabilities": ["GHSA-xxxx-xxxx-xxxx"],
  "licenseDenylist": ["GPL-3.0"]
}
```

### `doctor` — environment health

```bash
rn-dep-scanner doctor [--json] [--cwd <path>] [--ipa <path>] [--profile]
```

Reports React Native/React version, Hermes status, and native toolchain gaps: Android (JDK, Kotlin, AGP, Gradle, SDK levels, NDK, buildTools) and iOS (Xcode, deployment target, CocoaPods, Ruby, Swift) compared against the detected RN version's requirements. Also checks installed native dependencies' prebuilt `.so` libraries for Android 16KB page-size alignment. `--ipa <path>` opts into an informational check of a built `.ipa`/`.xcarchive` for dSYM presence (doesn't affect the READY/WARN/BLOCKED verdict). `--profile` prints a per-step timing breakdown of the scan itself.

### `compare-rn` — native requirement diff between two RN versions

```bash
rn-dep-scanner compare-rn <from> <to> [--json]
```

No project needed — pure lookup against the built-in RN version registry.

### `upgrade` — upgrade readiness report

```bash
rn-dep-scanner upgrade --to <version> [--json] [--cwd <path>]
```

Combines breaking changes, New Architecture requirements, and Android/iOS toolchain deltas for upgrading to a target RN version into one low/medium/high risk report.

### `why` / `tree` — dependency graph

```bash
rn-dep-scanner why <package> [--json]
rn-dep-scanner tree [package] [--duplicates] [--json]
```

`why` traces every install path and version a package resolves to; `tree` prints the full (or subtree) dependency tree. Full transitive hierarchy is supported for npm; yarn/pnpm/bun show direct dependencies only today (a warning is printed when this applies).

### `security` — vulnerability scan

```bash
rn-dep-scanner security [--json]
```

Standalone OSV.dev scan across direct **and transitive** dependencies (same data `check` reports by default), with the dependency path to each vulnerable package. Exits 1 on any critical/high finding — useful for CI without running the full `check`.

### `why-not` / `impact` — upgrade planning

```bash
rn-dep-scanner why-not <package> <version> [--json]
rn-dep-scanner impact <package> <version> [--json]
```

`why-not` explains which installed package's declared peer/dependency range blocks a specific version from being installed. `impact` goes further: breaking changes at that version, the same peer/version conflicts, and which other packages depend on this one (worth re-testing after upgrading), plus plain-language recommended actions.

### `unused` — dependencies with no detected import

```bash
rn-dep-scanner unused [--json]
```

Heuristic (regex-based `require`/`import` scan of project source) flagging declared dependencies never referenced — a starting point for manual review, not a "safe to delete" guarantee. Known tooling-only packages (ESLint/Babel/TypeScript/Jest/Metro plugins, etc.) are excluded automatically.

### `licenses` / `sbom` — license & supply-chain reporting

```bash
rn-dep-scanner licenses [--json]
rn-dep-scanner sbom
```

`licenses` reports each package's declared license across the full transitive tree, optionally flagging a `licenseDenylist` from `.rn-dep-scanner.json` (exits 1 on a match). `sbom` exports a CycloneDX 1.5 JSON Software Bill of Materials to stdout.

### `diff` — dependency changes between two project states

```bash
rn-dep-scanner diff --from <dir> --to <dir> [--json]
```

Compares two project directories' dependency graphs (added/removed/changed packages), then runs a security scan against just what changed — catches a PR that quietly introduces a vulnerable package.

### `legacy-apis` — removed React Native API usage

```bash
rn-dep-scanner legacy-apis [--json]
```

Detects source imports of core React Native APIs that were removed and split into community packages (`WebView`, `AsyncStorage`, `Clipboard`, `NetInfo`, `ListView`, and more — see `data/legacyApis.ts`), reporting each affected file with the suggested replacement package.

### `bundle` — dependency install size

```bash
rn-dep-scanner bundle [--json]
```

Reports each direct dependency's on-disk install size, largest first — a quick "what's heavy" signal, not a real Metro bundle analysis.

### `outdated` — available updates

```bash
rn-dep-scanner outdated [--major-only] [--json]
```

Lists updates grouped by major/minor/patch severity.

## Example

```
✗ react-native-reanimated@4.0.0
  ├─ Issues:
  │  • Incompatible with React Native 0.72.0 (requires >=0.78)
  ├─ Impact: This dependency has critical incompatibilities
  └─ Recommendation: Update to a compatible version or find an alternative

Health Score: 0/100
  ├─ ✓ Compatible:    0
  ├─ ✗ Errors:        1
  └─ ? Not Checked:   2
```

Every command accepts `--json` for CI/CD integration.

## Resolved vs Requested Versions

`requestedVersion` is what's declared in `package.json` (e.g. `^1.2.3`); `resolvedVersion` is what the lockfile actually installed (e.g. `1.2.5`). Compatibility and breaking-change checks operate on the resolved version.

## Known Limitations

- `doctor`/`upgrade` native-toolchain checks are static-file-based (parsed config), not live SDK/toolchain installation checks.
- Monorepo support (npm/yarn/pnpm/bun workspaces) resolves the correct lockfile and `node_modules` root when run from a workspace package, but does not yet aggregate or cross-check multiple workspace packages in one run.
- Bun lockfile parsing is less battle-tested than npm/yarn/pnpm.
- The Android 16KB page-size check only inspects prebuilt `.so` files already present in `node_modules` — a package that compiles native code during the Android build has nothing to check until that build runs.
- The iOS `--ipa` check covers dSYM presence for the main app binary only, not embedded frameworks or bitcode.
- Expo Go per-package support data is a small hand-curated list; most uncurated native modules report "unknown," not a wrong verdict.

## Development

```bash
npm install
npm run dev check     # run in dev mode
npm run build          # compile TypeScript
npm run test            # run tests
```

## License

MIT
