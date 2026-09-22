# rn-dep-scanner

A React Native project health scanner: dependency compatibility, breaking changes, native
toolchain/environment checks, transitive security scanning, and supply-chain reporting — all
from one CLI.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Commands at a glance](#commands-at-a-glance)
- [Core analysis](#core-analysis)
- [Dependency graph](#dependency-graph)
- [Security & supply chain](#security--supply-chain)
- [Upgrade planning](#upgrade-planning)
- [Code-level analysis](#code-level-analysis)
- [Reporting & CI](#reporting--ci)
- [Config file (`.rn-dep-scanner.json`)](#config-file-rn-dep-scannerjson)
- [Output formats (`--json` / `--html`)](#output-formats---json----html)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)
- [Development](#development)

## Install

`rn-dep-scanner` is a dev-only CLI tool — it's never imported by your app's runtime code, so it
should never end up in your production dependency tree. A global install (or `npx`) sidesteps
the question entirely; if you install it locally into a project, use `--save-dev`/`-D` so it
lands in `devDependencies`, not `dependencies` (npm/pnpm/yarn have no way for a package to force
this itself — it's entirely determined by the flag you pass to your install command).

```bash
npm install -g rn-dep-scanner
# or
npx rn-dep-scanner
# or, to pin a version per-project instead of installing globally:
npm install --save-dev rn-dep-scanner
pnpm add -D rn-dep-scanner
yarn add -D rn-dep-scanner
```

After a global install, `rn-dep-scanner <command>` works directly — no `npx` needed. If it
doesn't (an old install predating a fix, or your global bin directory isn't on `PATH`), run
`npm config get prefix` and confirm that prefix's `bin/` is on your `PATH`; `npx rn-dep-scanner`
always works as a fallback regardless, since it resolves and runs the package without relying
on `PATH`.

## Quick start

```bash
cd your-react-native-project
rn-dep-scanner              # same as `rn-dep-scanner check` — the default command
rn-dep-scanner doctor       # is your native toolchain (JDK/AGP/Xcode/...) ready to build?
rn-dep-scanner upgrade --to 0.81.0   # what would upgrading to RN 0.81 break?
```

Run `rn-dep-scanner --help` for the live command list, or `rn-dep-scanner <command> --help` for
any command's exact flags — this README is kept in sync with that output, but the CLI itself is
always the source of truth.

## Commands at a glance

| Command | What it answers |
|---|---|
| [`check`](#check-default-command) | "Is my project's dependency set healthy overall?" — the default command |
| [`doctor`](#doctor) | "Is my Android/iOS build toolchain actually set up correctly?" |
| [`outdated`](#outdated) | "Which packages have newer versions available?" |
| [`upgrade --to <version>`](#upgrade---to-version) | "What happens if I upgrade React Native to X?" |
| [`compare-rn <from> <to>`](#compare-rn-from-to) | "What changes between two RN versions' native requirements?" (no project needed) |
| [`why <package>`](#why-package) | "Why is this package installed, and through what path?" |
| [`tree [package]`](#tree-package) | "What does my dependency tree look like?" |
| [`graph`](#graph) | "Give me the raw dependency graph as data (JSON/DOT)" |
| [`security`](#security) | "Do any of my dependencies have known vulnerabilities?" (direct + transitive) |
| [`licenses`](#licenses) | "What license is each dependency under?" |
| [`sbom`](#sbom) | "Give me a CycloneDX SBOM" |
| [`diff --from <dir> --to <dir>`](#diff---from-dir---to-dir) | "What changed (and did we add a vulnerability) between two project states?" |
| [`policy`](#policy) | "Does this project violate our org's dependency rules?" |
| [`baseline`](#baseline) | "What's *new* since we adopted this tool?" |
| [`why-not <package> <version>`](#why-not-package-version) | "Why can't I install this exact version?" |
| [`impact <package> <version>`](#impact-package-version) | "What would upgrading this one package break?" |
| [`unused`](#unused) | "Which declared dependencies look unreferenced?" |
| [`legacy-apis`](#legacy-apis) | "Am I using any removed React Native core APIs?" |
| [`bundle`](#bundle) | "Which dependency is the heaviest on disk?" |
| [`architecture`](#architecture) | "New Architecture compatibility, on its own" |
| [`native`](#native) | "Native toolchain checks, on their own" |
| [`16kb`](#16kb) | "Android 16KB page-size alignment, on its own" |
| [`report`](#report) | "Give me a shareable Markdown/HTML summary" |
| [`watch`](#watch) | "Keep re-running check in the background" |

Every command supports `--cwd <path>` (defaults to the current directory) unless noted
otherwise, and every command with `--json` also supports `--html [path]` — see
[Output formats](#output-formats---json----html).

---

## Core analysis

### `check` (default command)

```bash
rn-dep-scanner [check] [--json] [--html [path]] [--strict] [--cwd <path>] [--no-security] [--profile]
```

The main scan. Reads `package.json` + your lockfile and reports, against the detected
React/React Native versions:

- version mismatches, duplicate dependencies, peer-dependency conflicts
- deprecated packages and breaking changes (with a `stale` flag for changes far enough in the
  past they're very unlikely to still be a pending action item)
- New Architecture (Fabric/TurboModules) compatibility per installed package
- Expo SDK ↔ RN version pinning and per-package Expo Go support (Expo projects only)
- whether each installed package's own sub-dependencies are actually present and satisfied
- known vulnerabilities (OSV.dev) across your **full transitive dependency tree**, not just
  `package.json`'s direct entries — on by default, pass `--no-security` to skip (no network call)

Reports a 0–100 health score. `--strict` exits 1 on any error-level finding (including a
critical/high vulnerability). `--profile` prints a per-step timing breakdown of the scan itself.

### `doctor`

```bash
rn-dep-scanner doctor [--json] [--html [path]] [--cwd <path>] [--ipa <path>] [--profile]
```

Checks whether your machine/project is actually ready to *build*, separately from whether your
JS dependencies are compatible: React Native/React version, Hermes status, and native toolchain
gaps —

- **Android**: JDK, Kotlin, AGP, Gradle, compileSdk/targetSdk/minSdk, NDK, Build Tools — read
  from `build.gradle(.kts)`, `settings.gradle(.kts)`, and a Gradle version catalog
  (`gradle/libs.versions.toml`) if present, compared against the detected RN version's baseline
- **iOS**: Xcode, deployment target, CocoaPods, Ruby, Swift
- **Android 16KB page-size alignment**: every installed dependency's prebuilt `.so` libraries
  (both loose `jniLibs/<abi>/` files and ones packaged inside an `.aar`/`.jar`), checked against
  the alignment Android 15+ devices require

Produces an overall `READY` / `WARN` / `BLOCKED` verdict. `--ipa <path>` opts into an
informational dSYM-presence check for a built `.ipa`/`.xcarchive` (doesn't affect the verdict).

### `outdated`

```bash
rn-dep-scanner outdated [--major-only] [--json] [--html [path]] [--cwd <path>]
```

Lists available updates for your direct dependencies, grouped by major/minor/patch severity.
`--major-only` shows just the major-version bumps.

### `upgrade --to <version>`

```bash
rn-dep-scanner upgrade --to <version> [--json] [--html [path]] [--cwd <path>]
```

`--to` is required. Assesses readiness to upgrade React Native to a target version by combining:

- breaking changes, each classified as `historical` (already true before your *current* RN
  version — not caused by this specific upgrade, doesn't affect risk), `relevant`, or
  `action_required` (the critical/high subset of `relevant`) — so a change from three years ago
  doesn't wrongly block an unrelated upgrade
- New Architecture requirements at the target version
- Android/iOS/Node toolchain deltas at the target version
- deprecated packages and duplicate dependencies

Produces a `low`/`medium`/`high` `risk` score and a `READY`/`WARN`/`BLOCKED` `verdict`, plus a
separate `envVerdict` covering just the native-toolchain checks (useful when you only care
whether the machine itself can build, independent of JS migration work).

### `compare-rn <from> <to>`

```bash
rn-dep-scanner compare-rn <from> <to> [--json] [--html [path]]
```

Pure lookup against the built-in RN-version → native-toolchain-requirement registry — diffs two
RN versions' Node/Android/iOS baselines with no project scan needed. No `--cwd`.

---

## Dependency graph

### `why <package>`

```bash
rn-dep-scanner why <package> [--json] [--html [path]] [--cwd <path>]
```

Traces every install path and resolved version a package appears at in your dependency tree.

### `tree [package]`

```bash
rn-dep-scanner tree [package] [--duplicates] [--json] [--html [path]] [--cwd <path>]
```

Prints the full dependency tree, or the subtree rooted at `package` if given. `--duplicates`
shows only branches where a package resolves to more than one version.

> Full transitive hierarchy (`why`/`tree`/`graph`/`security`/`licenses`/`policy`) is supported
> for **npm** lockfiles today. Yarn/pnpm/bun show direct dependencies only, with a warning
> printed when this applies — see [Known limitations](#known-limitations).

### `graph`

```bash
rn-dep-scanner graph [--json] [--html [path]] [--dot] [--cwd <path>]
```

Exposes the dependency graph as raw data instead of a rendered tree — `--json` gives every
node's id/name/version/parents/children; `--dot` gives Graphviz output:

```bash
rn-dep-scanner graph --dot | dot -Tpng -o graph.png
```

---

## Security & supply chain

### `security`

```bash
rn-dep-scanner security [--json] [--html [path]] [--cwd <path>]
```

Standalone OSV.dev scan across direct **and transitive** dependencies (the same data `check`
reports by default), with the full dependency path to each vulnerable package. Exits 1 on any
critical/high finding — useful in CI without running the full `check`. Respects
`ignoreVulnerabilities` in `.rn-dep-scanner.json`.

### `licenses`

```bash
rn-dep-scanner licenses [--json] [--html [path]] [--cwd <path>]
```

Reports each package's declared license across the full transitive tree, optionally flagging a
`licenseDenylist` from `.rn-dep-scanner.json` (exits 1 on a match). Reads only each package's
*hoisted* `node_modules/<name>/package.json` — a version that lost the hoist to a conflicting
sibling won't have its license read; see [Known limitations](#known-limitations).

### `sbom`

```bash
rn-dep-scanner sbom [--html [path]] [--cwd <path>]
```

Exports a CycloneDX 1.5 Software Bill of Materials to stdout as JSON (no `--json` flag needed —
JSON is simply the default output; pass `--html` for an HTML rendering instead).

### `diff --from <dir> --to <dir>`

```bash
rn-dep-scanner diff --from <dir> --to <dir> [--json] [--html [path]]
```

`--from`/`--to` are required project directories (not lockfile paths). Compares their dependency
graphs for added/removed/changed packages, then runs a security scan against just what
changed — catches a PR that quietly introduces a vulnerable package. No `--cwd` (the two
directories you pass are the inputs).

### `policy`

```bash
rn-dep-scanner policy [--json] [--html [path]] [--cwd <path>]
```

Evaluates `.rn-dep-scanner.json`'s `bannedPackages`, `licenseDenylist`, and
`maxVulnerabilitySeverity` fields (see [Config](#config-file-rn-dep-scannerjson)) by reusing the
same analyzers `licenses`/`security` use. Exits 1 on any violation.

### `baseline`

```bash
rn-dep-scanner baseline --create [--cwd <path>]           # snapshot current security findings
rn-dep-scanner baseline [--json] [--html [path]] [--cwd <path>]   # report only what's new since the snapshot
```

Useful for adopting the tool on a large existing project without a wall of pre-existing issues
blocking CI on day one. Scoped to security vulnerabilities only (not every `check` issue
category — see [Known limitations](#known-limitations)).

`baseline --create` writes `.rn-dep-scanner-baseline.json` to the project root — a **generated
snapshot file**, distinct from the `.rn-dep-scanner.json` config file: you don't hand-write or
edit it, and there's no policy to configure inside it. Re-running `--create` overwrites it with
current findings. Decide per-project whether to commit it: commit it if "new findings since this
snapshot" should be consistent for every contributor/CI run; leave it gitignored if each
machine/branch should track its own baseline independently.

---

## Upgrade planning

### `why-not <package> <version>`

```bash
rn-dep-scanner why-not <package> <version> [--json] [--html [path]] [--cwd <path>]
```

Explains which installed package's declared peer/dependency range is blocking a specific
version from being installed. A range that isn't resolvable semver (a `workspace:`/`npm:`/git
protocol reference) is reported as unknown, never guessed true or false.

### `impact <package> <version>`

```bash
rn-dep-scanner impact <package> <version> [--json] [--html [path]] [--cwd <path>]
```

Goes further than `why-not`: breaking changes at that target version, the same peer/version
conflicts, and which other installed packages depend on this one (worth re-testing after
upgrading), plus plain-language recommended actions.

### `unused`

```bash
rn-dep-scanner unused [--json] [--html [path]] [--cwd <path>]
```

Heuristic (regex-based `require`/`import` scan of project source) flagging declared dependencies
with no detected reference — a starting point for manual review, **not** a "safe to delete"
guarantee. Known tooling-only packages (ESLint/Babel/TypeScript/Jest/Metro plugins, etc.) are
excluded automatically.

---

## Code-level analysis

### `legacy-apis`

```bash
rn-dep-scanner legacy-apis [--json] [--html [path]] [--cwd <path>]
```

Detects source imports of core React Native APIs that were removed and split into community
packages (`WebView`, `AsyncStorage`, `Clipboard`, `NetInfo`, `ListView`, and more — see
`src/data/legacyApis.ts`), reporting each affected file with its suggested replacement package.
Import-based detection only — a deprecated prop/method on an API that otherwise still exists
isn't covered.

### `bundle`

```bash
rn-dep-scanner bundle [--json] [--html [path]] [--cwd <path>]
```

Reports each direct dependency's on-disk install size, largest first — a quick "what's heavy"
signal, **not** a real Metro bundle analysis (source maps and platform-specific files are
included here but might not end up in an actual bundle).

### `architecture`

```bash
rn-dep-scanner architecture [--json] [--html [path]] [--cwd <path>]
```

Just the New Architecture (Fabric/TurboModules) compatibility check `check` already runs, on its
own. A package with no compatibility data reports `support: "data_unavailable"` with a `reason`
— that's "we don't know," not "this is broken."

### `native`

```bash
rn-dep-scanner native [--json] [--html [path]] [--cwd <path>]
```

Just the Android/iOS native toolchain check `doctor` already runs, on its own (no Hermes/Node/
16KB sections). Note: the JSON key for the Android section is `android` here, vs. `doctor`'s
`androidEnvironment` — same data, different top-level key name in each command's output.

### `16kb`

```bash
rn-dep-scanner 16kb [--json] [--html [path]] [--cwd <path>]
```

Just the Android 16KB page-size alignment check `doctor` already runs, on its own. A
`not-checked` result carries a `notCheckedReason`: `no_native_libraries` (nothing to inspect —
JS-only, or compiles from source during the Android build) or `unreadable_library` (a `.so` was
found but couldn't be parsed).

---

## Reporting & CI

### `report`

```bash
rn-dep-scanner report [--format md|html] [--out <path>] [--cwd <path>]
```

Renders a condensed health-score/compatibility/deprecated-packages/New-Architecture/security
report — to stdout by default, or a file with `--out`. `--format` defaults to `md`. This is a
deliberately smaller, decision-focused view, not a full mirror of `check --json`.

### `watch`

```bash
rn-dep-scanner watch [--interval <seconds>] [--json] [--html [path]] [--cwd <path>]
```

Runs `check` on a repeating interval (default 300s) until interrupted (Ctrl+C) — for a
long-running terminal/CI job. Each cycle runs non-strict so one bad cycle doesn't kill the loop.

---

## Config file (`.rn-dep-scanner.json`)

An optional config file **you author** at the project root — you write and commit this; it is
not generated by the tool (contrast with `.rn-dep-scanner-baseline.json`, above, which the tool
generates and you don't hand-edit). Every field is optional; nothing below is a recommended
default, each is only an example of the shape:

```json
{
  "ignorePackages": ["some-noisy-package"],
  "ignoreVulnerabilities": ["GHSA-xxxx-xxxx-xxxx"],
  "licenseDenylist": ["GPL-3.0-only"],
  "bannedPackages": ["some-vendor-package"],
  "maxVulnerabilitySeverity": "high"
}
```

| Field | Used by | Meaning |
|---|---|---|
| `ignorePackages` | `check` | Package names to exclude entirely from compatibility analysis. |
| `ignoreVulnerabilities` | `check`, `security`, `policy` | OSV/GHSA/CVE advisory IDs to suppress (e.g. one you've assessed as a false positive or already mitigated). |
| `licenseDenylist` | `licenses`, `policy` | [SPDX license identifiers](https://spdx.org/licenses/) to flag if found on any installed package. There is no built-in denylist — you decide which licenses your org disallows. License strings are matched as read from each package's own `package.json` (not normalized against the SPDX list), so use the identifier as your ecosystem's packages actually declare it. |
| `bannedPackages` | `policy` | Package names to fail on regardless of license or vulnerabilities (e.g. an internally-disallowed vendor SDK). |
| `maxVulnerabilitySeverity` | `policy` | One of `"critical" \| "high" \| "moderate" \| "low"` — `policy` fails if any found vulnerability meets or exceeds this severity. |

## Output formats (`--json` / `--html`)

Every command that has `--json` also accepts `--html [path]` — `watch` and `report` included;
`sbom` too, despite JSON being its unflagged default. `--html` renders the same result as a
minimal, dependency-free HTML page: printed to stdout if no path is given, or written to that
file:

```bash
rn-dep-scanner check --html report.html
```

If both `--json` and `--html` are passed, `--html` wins.

## Resolved vs. requested versions

`requestedVersion` is what's declared in `package.json` (e.g. `^1.2.3`); `resolvedVersion` is
what your lockfile actually installed (e.g. `1.2.5`). Compatibility and breaking-change checks
operate on the resolved version.

## Security notes

This tool necessarily reads your filesystem, shells out to detect installed JDK/Xcode versions,
and calls OSV.dev over the network — see [SECURITY.md](SECURITY.md) for why each of these is
safe and intentional (useful context if a supply-chain scanner like Socket.dev flags this
package).

## Known limitations

- `doctor`/`upgrade`/`native` toolchain checks are static-file-based (parsed project config),
  not a live SDK/toolchain installation check — they can't see a toolchain declared some other
  way (e.g. a custom `buildSrc` convention plugin).
- Full transitive dependency resolution (`why`/`tree`/`graph`/`security`/`licenses`/`policy`) is
  complete for npm lockfiles; yarn/pnpm/bun show direct dependencies only today.
- Monorepo support (npm/yarn/pnpm/bun workspaces) resolves the correct lockfile/`node_modules`
  root when run from a workspace package, but doesn't yet aggregate or cross-check multiple
  workspace packages in one run.
- Bun lockfile parsing is less battle-tested than npm/yarn/pnpm.
- The Android 16KB page-size check only inspects prebuilt `.so` files already present in
  `node_modules` (loose or `.aar`/`.jar`-packaged) — a package that compiles native code during
  the Android build has nothing to check until that build runs.
- The iOS `--ipa` check covers dSYM presence for the main app binary only, not embedded
  frameworks or bitcode.
- Expo Go per-package support data is a small hand-curated list; most uncurated native modules
  report `unknown`, not a wrong verdict.
- `unused`/`legacy-apis` are regex-based source scans, not an AST parse — a computed `require`,
  a re-exported barrel, or a renamed import can produce a false negative.
- `licenses`/`sbom` read only a package's *hoisted* `node_modules/<name>/package.json` — a
  version that lost the hoist to a conflicting sibling has its license reported as unreadable.
- `baseline` tracks security-vulnerability findings only; a compatibility warning or deprecated
  package isn't baselined.
- `watch` has no CLI-exposed way to bound its iteration count — it runs until interrupted.

## Development

```bash
npm install
npm run dev check     # run in dev mode (tsx, hot reload)
npm run build          # compile TypeScript to dist/
npm run test            # run the test suite
```

## License

MIT
