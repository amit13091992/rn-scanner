# rn-dep-scanner

A React Native project health scanner: dependency compatibility, breaking changes, New Architecture (Fabric/TurboModules) support, Hermes status, native Android/iOS toolchain checks, and upgrade-readiness reports.

## Install

```bash
npm install -g rn-dep-scanner
# or
npx rn-dep-scanner
```

## Commands

### `check` — dependency compatibility (default command)

```bash
rn-dep-scanner check [--json] [--strict] [--cwd <path>]
```

Analyzes `package.json` + lockfile against React/React Native, flags version mismatches, duplicate/peer-dependency conflicts, deprecated packages, breaking changes, and New Architecture incompatibilities. Reports a 0–100 health score. `--strict` exits 1 on errors.

### `doctor` — environment health

```bash
rn-dep-scanner doctor [--json] [--cwd <path>]
```

Reports React Native/React version, Hermes status, and native toolchain gaps: Android (JDK, Kotlin, AGP, Gradle, SDK levels, NDK, buildTools) and iOS (Xcode, deployment target, CocoaPods, Ruby, Swift) compared against the detected RN version's requirements.

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

`why` traces every install path and version a package resolves to; `tree` prints the full (or subtree) dependency tree. Full transitive hierarchy is supported for npm, yarn, pnpm, and bun.

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

- Security vulnerability scanning (OSV.dev) was removed as unmaintained dead code — no CVE/GHSA data in output today; reinstating it is future work.
- `doctor`/`upgrade` native-toolchain checks are static-file-based (parsed config), not live SDK/toolchain installation checks.
- No monorepo (pnpm-workspace/yarn workspaces) support yet.
- Bun lockfile parsing is less battle-tested than npm/yarn/pnpm.

## Development

```bash
npm install
npm run dev check     # run in dev mode
npm run build          # compile TypeScript
npm run test            # run tests
```

## License

MIT
