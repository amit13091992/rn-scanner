# rn-dep-scanner

A React Native project health scanner: dependency compatibility, breaking changes, native
toolchain/environment checks, transitive security scanning, and supply-chain reporting — all
from one CLI.

## Contents

- [What's new](#whats-new)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands at a glance](#commands-at-a-glance)
- [Core analysis](#core-analysis)
- [Dependency graph](#dependency-graph)
- [Security & supply chain](#security--supply-chain)
- [Upgrade planning](#upgrade-planning)
- [Code-level analysis](#code-level-analysis)
- [Reporting & CI](#reporting--ci)
- [Global options, network behaviour & exit codes](#global-options-network-behaviour--exit-codes)
- [Config file (`.rn-dep-scanner.json`)](#config-file-rn-dep-scannerjson)
- [Output formats (`--json` / `--html`)](#output-formats---json----html)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)
- [Development](#development)

## What's new

### 1.4.0

- **MCP server** (`rn-dep-scanner mcp`): lets a coding agent check things as it works, over stdio
  with no extra dependency. Six read-only tools: `check_package` (is this package safe to add:
  does it exist, is it a lookalike of a popular name, how new is it, install scripts, known
  incidents, OSV advisories), `security_scan`, `check_dependencies`, `why`, `upgrade_readiness`
  and `doctor`. See [`mcp`](#mcp).
  Try it: `claude mcp add rn-preflight -- npx -y rn-dep-scanner mcp`
- **Supply-chain signals in `security`**: packages with install-time scripts, versions published
  in the last N days (`--min-release-age`), a version published **without provenance** when the
  previous one had it, and a version published by a **different npm account**. A
  `knownMalwareFeed` config field lets a team add its own known-malware list. See
  [`security`](#security).
  Try it: `npx rn-dep-scanner security --min-release-age 14`
- **`sbom` is now CycloneDX 1.6**, validated against the official schema in CI, with package
  URLs, dependency edges, license shapes, `--vex` (OSV findings as `in_triage`) and integrity
  hashes for npm, yarn classic, pnpm and bun lockfiles. **Behaviour change:** scoped packages are
  now a `group` plus `name` with a percent-encoded purl (`pkg:npm/%40scope/name`), and a license
  that isn't a real SPDX id is emitted as a `name`, not an `id`. See [`sbom`](#sbom).
  Try it: `npx rn-dep-scanner sbom --vex > sbom.json`
- **`doctor`** now counts down to Google Play's 16KB page-size deadline (2027-02-01), checks the
  AGP and NDK versions that 16KB support needs, and for RN 0.87+ reports which native
  dependencies ship a `Package.swift` for Swift Package Manager (CocoaPods trunk goes read-only on
  2026-12-02). Adds an estimated React Native 0.89 baseline.
  Try it: `npx rn-dep-scanner doctor` (the 16KB part alone: `npx rn-dep-scanner 16kb`)
- **`size measure` / `size diff`**: bundle-size snapshots, budgets and per-module diffs, and a
  GitHub Action mode that posts the result as a PR comment and can fetch the base snapshot from a
  workflow artifact. See [`size measure` / `size diff`](#size-measure--size-diff).
  Try it: `npx rn-dep-scanner size diff base.json head.json`
- **Upkeep**: a weekly workflow opens an issue when React Native or Expo ships a version the
  built-in registries don't know about yet.

### 1.5.0

- **Supply-chain checks reach transitive packages.** Registry lookups are spent on install-script
  packages first, then direct dependencies, then the transitive packages nearest your app, under
  a cap you can raise with `--max-registry-lookups` / `maxRegistryLookups`. A maintainer moving to
  npm trusted publishing is no longer reported as a publisher change.
  Try it: `npx rn-dep-scanner security --max-registry-lookups 300`
- **`check` shows the same supply-chain section** (and a `supplyChain` key in `--json`) unless
  `--no-security` is passed. It never affects the health score or exit code.
  Try it: `npx rn-dep-scanner check`

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

After a global install, `rn-dep-scanner <command>` also works directly (no `npx` needed). Every example below uses `npx rn-dep-scanner <command>`, which works with or without a global install. If it
doesn't (an old install predating a fix, or your global bin directory isn't on `PATH`), run
`npm config get prefix` and confirm that prefix's `bin/` is on your `PATH`; `npx rn-dep-scanner`
always works as a fallback regardless, since it resolves and runs the package without relying
on `PATH`.

## Quick start

```bash
cd your-react-native-project
npx rn-dep-scanner              # same as `npx rn-dep-scanner check` — the default command
npx rn-dep-scanner doctor       # is your native toolchain (JDK/AGP/Xcode/...) ready to build?
npx rn-dep-scanner upgrade --to 0.88.0   # what would upgrading to RN 0.88 break?
npx rn-dep-scanner upgrade --latest      # ...or just assess against whatever RN's latest is right now
```

Run `npx rn-dep-scanner --help` for the live command list, or `rn-dep-scanner <command> --help` for
any command's exact flags — this README is kept in sync with that output, but the CLI itself is
always the source of truth.

## Commands at a glance

| Command | What it answers |
|---|---|
| [`check`](#check-default-command) | "Is my project's dependency set healthy overall?" — the default command |
| [`mcp`](#mcp) | "Can my coding agent check a package is safe before it installs it?" — runs as an MCP server |
| [`doctor`](#doctor) | "Is my Android/iOS build toolchain actually set up correctly?" |
| [`outdated`](#outdated) | "Which packages have newer versions available?" |
| [`upgrade --to <version>` / `--latest`](#upgrade) | "What happens if I upgrade React Native to X, or to whatever's latest?" |
| [`compare-rn <from> <to>`](#compare-rn-from-to) | "What changes between two RN versions' native requirements?" (no project needed) |
| [`why <package>`](#why-package) | "Why is this package installed, and through what path?" |
| [`tree [package]`](#tree-package) | "What does my dependency tree look like?" |
| [`graph`](#graph) | "Give me the raw dependency graph as data (JSON/DOT)" |
| [`ai-exposure`](#ai-exposure) | "Am I calling an AI provider directly from the client, or leaking its key?" |
| [`security`](#security) | "Do any of my dependencies have known vulnerabilities?" (direct + transitive) |
| [`licenses`](#licenses) | "What license is each dependency under?" |
| [`sbom`](#sbom) | "Give me a CycloneDX SBOM" |
| [`renovate-config`](#renovate-config) | "Give me a starter Renovate config that understands React Native" |
| [`diff --from <dir> --to <dir>`](#diff---from-dir---to-dir) | "What changed (and did we add a vulnerability) between two project states?" |
| [`policy`](#policy) | "Does this project violate our org's dependency rules?" |
| [`baseline`](#baseline) | "What's *new* since we adopted this tool?" |
| [`why-not <package> <version>`](#why-not-package-version) | "Why can't I install this exact version?" |
| [`impact <package> <version>`](#impact-package-version) | "What would upgrading this one package break?" |
| [`unused`](#unused) | "Which declared dependencies look unreferenced?" |
| [`legacy-apis`](#legacy-apis) | "Am I using any removed React Native core APIs?" |
| [`bundle`](#bundle) | "Which dependency is the heaviest on disk?" |
| [`size measure` / `size diff`](#size-measure--size-diff) | "Did this change make my JS bundle bigger, and is it over budget?" |
| [`architecture`](#architecture) | "New Architecture compatibility, on its own" |
| [`native`](#native) | "Native toolchain checks, on their own" |
| [`16kb`](#16kb) | "Android 16KB page-size alignment, on its own" |
| [`report`](#report) | "Give me a shareable Markdown/HTML summary" |
| [`a11y`](#a11y) | "Which buttons/images have no accessibility label?" |
| [`watch`](#watch) | "Keep re-running check in the background" |

Every command supports `--cwd <path>` (defaults to the current directory) unless noted
otherwise, and every command with `--json` also supports `--html [path]` — see
[Output formats](#output-formats---json----html). `check`/`doctor`/`why`/`tree`/`security`/
`licenses`/`policy`/`upgrade` additionally support `--all-workspaces`, aggregating the same
scan across every workspace package in the monorepo instead of just `--cwd` (a no-op outside a
workspace).

---

## Core analysis

### `check` (default command)

```bash
rn-dep-scanner [check] [--json] [--html [path]] [--strict] [--cwd <path>] [--no-security] [--verbose] [--profile] [--all-workspaces]
```

The main scan. Reads `package.json` + your lockfile and reports, against the detected
React/React Native versions:

- version mismatches, duplicate dependencies, peer-dependency conflicts
- per-package React Native compatibility: curated rules first (`data/compatibility.ts`, including
  per-minor Reanimated/Worklets windows), then — for a package with no curated rule — the
  `react-native` peer range the package itself declares in its installed manifest. A violated
  peer range is a warning (peer ranges often lag), a bare `*` stays "not checked"
- deprecated packages and breaking changes — every currently-applicable entry per package (e.g.
  both the RN 0.87 and 0.88 notes on 0.88), with a `stale` flag for changes far enough in the
  past they're very unlikely to still be a pending action item; an older major line's entry is
  superseded by the newest applicable major
- New Architecture (Fabric/TurboModules) compatibility per installed package
- Expo SDK ↔ RN version pinning (through SDK 58 / RN 0.88), SDK 58 breaking changes and release-build advisories, and per-package Expo Go support (Expo projects only)
- whether each installed package's own sub-dependencies are actually present and satisfied
- known vulnerabilities (OSV.dev) across your **full transitive dependency tree**, not just
  `package.json`'s direct entries — on by default, pass `--no-security` to skip (no network call)
- informational supply-chain signals (install scripts, very new versions, missing provenance, a
  changed publisher) — the same section [`security`](#security) prints; also skipped by
  `--no-security`, and never part of the health score

Reports a 0–100 health score — or "insufficient data" (`healthScore: null` in `--json`) when fewer than half the dependencies have compatibility data, rather than a misleading number. `--verbose` lists every security advisory instead of one grouped block per package. `--strict` exits 1 on any error-level finding (including a
critical/high vulnerability, or an unsupported New Architecture package once React Native's
legacy bridge is removed). `--profile` prints a per-step timing breakdown of the scan itself.
`--all-workspaces` checks every workspace package in the monorepo and aggregates the results.

### `doctor`

```bash
npx rn-dep-scanner doctor [--json] [--html [path]] [--cwd <path>] [--ipa <path>] [--profile] [--all-workspaces]
```

Checks whether your machine/project is actually ready to *build*, separately from whether your
JS dependencies are compatible: React Native/React version, Hermes status, and native toolchain
gaps —

- **Android**: JDK, Kotlin, AGP, Gradle, compileSdk/targetSdk/minSdk, NDK, Build Tools — read
  from `build.gradle(.kts)`, `settings.gradle(.kts)`, and a Gradle version catalog
  (`gradle/libs.versions.toml`) if present, compared against the detected RN version's baseline
- **iOS**: Xcode, deployment target, CocoaPods, Ruby, Swift — and, for RN 0.88+, whether the
  UIScene lifecycle (`UIApplicationSceneManifest` in `Info.plist`) is set up, which Apple requires
  for apps built with the iOS 27 SDK / Xcode 27
- **Swift Package Manager readiness** (RN 0.87+ CocoaPods projects, or any project already using
  SwiftPM; informational, never affects the verdict): which installed native dependencies ship a
  `Package.swift` and which only a podspec. It reads the files each package ships, so a manifest's
  presence is a necessary signal, not proof that React Native's SwiftPM mode can use the module
- **Node.js**: the running Node against the RN version's baseline; for RN 0.88+ also warns on
  odd-numbered majors and Node 24.0–24.2, which fall outside RN's supported `engines` range
- **Android 16KB page-size alignment**: every installed dependency's prebuilt `.so` libraries
  (both loose `jniLibs/<abi>/` files and ones packaged inside an `.aar`/`.jar`), checked against
  the alignment Android 15+ devices require

Produces an overall `READY` / `WARN` / `BLOCKED` verdict. `--ipa <path>` opts into an
informational dSYM-presence check for a built `.ipa`/`.xcarchive` (doesn't affect the verdict).
`--all-workspaces` checks every workspace package in the monorepo and aggregates the results.

### `outdated`

```bash
npx rn-dep-scanner outdated [--major-only] [--recommend] [--json] [--html [path]] [--cwd <path>]
```

Lists available updates for your direct dependencies, grouped by major/minor/patch severity.
`--major-only` shows just the major-version bumps. `--recommend` resolves a React-Native-compatible
recommended version per package (via `data/compatibility.ts`) instead of always pointing at npm's
absolute latest — useful when the newest major of a package requires a React Native version your
project hasn't reached yet (it never suggests a version lower than the one installed). In an Expo
project, packages the SDK pins (`react`, `react-native`, `expo-*`, Reanimated, Screens, …) are
marked "managed by Expo SDK N": don't bump them by hand — use `npx expo install --fix`, or move to
a newer SDK.

### `upgrade`

```bash
npx rn-dep-scanner upgrade --to <version> [--json] [--html [path]] [--cwd <path>] [--all-workspaces]
npx rn-dep-scanner upgrade --latest [--json] [--html [path]] [--cwd <path>] [--all-workspaces]
```

Give `--to <version>` or `--latest` (with neither, `--latest` is assumed). `--latest` resolves the target version from
npm's `react-native` `latest` dist-tag instead of you having to look it up yourself. Assesses
readiness to upgrade React Native to the target version by combining:

- breaking changes, each classified as `historical` (already true before your *current* RN
  version — not caused by this specific upgrade, doesn't affect risk), `relevant`, or
  `action_required` (the critical/high subset of `relevant`) — so a change from three years ago
  doesn't wrongly block an unrelated upgrade
- New Architecture requirements at the target version
- Android/iOS/Node toolchain deltas at the target version
- the Expo SDK's React Native pin: in an Expo project, a target outside what the installed SDK
  pins is rated `high` risk and names the SDK that does pin it (e.g. SDK 57 pins 0.86 → use SDK 58
  for 0.88)
- deprecated packages and duplicate dependencies

Produces a `low`/`medium`/`high` `risk` score and a `READY`/`WARN`/`BLOCKED` `verdict`, plus a
separate `envVerdict` covering just the native-toolchain checks (useful when you only care
whether the machine itself can build, independent of JS migration work). If you're already on the target version it says so and
reports a health check of the current version. `--all-workspaces`
assesses every workspace package in the monorepo and aggregates the results.

When the current and target versions are more than one RN minor apart, the result also includes
an `upgradePath` — the same readiness assessment run once per known intermediate minor version
(e.g. jumping from 0.70 straight to 0.75 is assessed, but so is 0.70→0.71→0.72→0.73→0.74→0.75),
since skipping versions compounds breaking-change risk non-linearly and an incremental path is
often lower-risk overall even though it's more commits. Omitted entirely when the two versions
are adjacent (nothing known sits between them) — see "Suggested Incremental Path" in human
output, or the `upgradePath` array in `--json`.

### `compare-rn <from> <to>`

```bash
npx rn-dep-scanner compare-rn <from> <to> [--json] [--html [path]]
```

Pure lookup against the built-in RN-version → native-toolchain-requirement registry — diffs two
RN versions' Node/Android/iOS baselines with no project scan needed. No `--cwd`.

---

## Dependency graph

### `why <package>`

```bash
npx rn-dep-scanner why <package> [--json] [--html [path]] [--cwd <path>] [--all-workspaces]
```

Explains why a package is installed. For each resolved version it shows whether it is a **direct**
dependency (with the range and `package.json` field that declares it) or **transitive**, whether
it is development-only/production/optional when the lockfile says so, which packages **require**
it, and every install path (rooted at your real project name; the first 10 per version, the rest
counted). It warns when several versions are installed (pointing at `tree --duplicates`) and
suggests `why-not`/`impact` as next steps. A name that matches nothing gets "did you mean …"
suggestions, plus a note if the package is declared in `package.json` but missing from the
lockfile. `--json` adds `project`, `summary` and per-version `direct`/`scope`/`requested`/
`dependents`/`pathCount` next to the existing `paths`. `--all-workspaces` traces it across every
workspace package in the monorepo.

### `tree [package]`

```bash
npx rn-dep-scanner tree [package] [--duplicates] [--json] [--html [path]] [--cwd <path>] [--all-workspaces]
```

Prints the full dependency tree, or the subtree rooted at `package` if given. `--duplicates`
shows only branches where a package resolves to more than one version. `--all-workspaces`
prints the tree for every workspace package in the monorepo.

Full transitive hierarchy (`why`/`tree`/`graph`/`security`/`licenses`/`policy`) is supported for
npm, yarn, pnpm, and bun alike, including sibling workspace packages cross-linked into the same
graph.

### `graph`

```bash
npx rn-dep-scanner graph [--json] [--html [path]] [--dot] [--cwd <path>]
```

Exposes the dependency graph as raw data instead of a rendered tree — `--json` gives every
node's id/name/version/parents/children; `--dot` gives Graphviz output:

```bash
npx rn-dep-scanner graph --dot | dot -Tpng -o graph.png
```

---

## Security & supply chain

### `ai-exposure`

```bash
npx rn-dep-scanner ai-exposure [--json] [--html [path]] [--cwd <path>]
```

Flags client-side AI exposure — a 2026 mobile-app risk category of its own: direct dependencies
on an AI provider SDK (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@ai-sdk/*`,
`react-native-openai`, and more — see `src/data/aiSdkPackages.ts`) called straight from the
client rather than proxied through a backend, which ships that provider's key inside the app
bundle; and source literals shaped like a real AI provider key (OpenAI/Anthropic/Google/Groq/
Cohere — see `src/data/aiKeyPatterns.ts`), reported by file/line/provider only — the matched
text itself is never included in any output. Also runs as part of `check`'s default scan (its
own "AI SDK Exposure" section / `aiSdkExposure` JSON key); `check --strict` exits 1 if a key
literal is found.

### `security`

```bash
npx rn-dep-scanner security [--json] [--html [path]] [--cwd <path>] [--all-workspaces] [--verbose] [--summary] [--fail-on <severity>] [--min-release-age <days>] [--max-registry-lookups <n>]
```

Standalone OSV.dev scan across direct **and transitive** dependencies (the same data `check`
reports by default), with the full dependency path to each vulnerable package. Advisories are
grouped per package with one "upgrade to" version; `--verbose` lists every advisory, `--summary`
prints counts plus one line per package. Exits 1 on a finding at or above `--fail-on
<critical|high|moderate|low|none>` (default `high`) — useful in CI without running the full
`check`. The OSV client batches large graphs (500 packages per request, OSV rejects >1000),
follows result paging, retries transient failures, and keeps a finding (id + link, unknown
severity) if its detail lookup still fails rather than silently dropping it; if OSV can't be
reached at all it reports `scanned: false` instead of "no vulnerabilities". Respects
`ignoreVulnerabilities` in `.rn-dep-scanner.json`. `--all-workspaces` scans every workspace
package in the monorepo containing `--cwd` and aggregates the results into one report (`--json`
gives a `workspaces[]` array plus a combined `summary`), instead of just the one package
`--cwd` points at; a no-op outside a workspace.

The "Supply-chain signals" section (informational, never affects the exit code) lists installed
packages with install-time scripts and versions published fewer than N days ago. N is 7 by
default; set it with `--min-release-age <days>` or `minReleaseAgeDays` in the config file (the
flag wins), and `0` turns the registry lookups off.

The same lookup also reports two traces of a stolen publish token, comparing each version with the
previous stable one: a version published **without provenance** (a Sigstore attestation) when the
previous version had it, and a version published by a **different npm account**. Both have
innocent causes too (a maintainer changing their release process or handing a package over), so
they are signals to look at, not verdicts; only account names are shown, never emails. A move to
npm trusted publishing (publisher "GitHub Actions" with provenance) is not reported, since it is a
hardening; the reverse is.

Each lookup is a full registry fetch, so they are capped (150 by default; `--max-registry-lookups`
or `maxRegistryLookups` in the config file) and spent in priority order: install-script
packages, direct dependencies, then transitive ones nearest the app first. Anything beyond the
cap is reported as not checked. `check` shows the same section (and a `supplyChain` key in
`--json`) unless `--no-security` is passed; it is informational there too and never affects the
health score or exit code.

Set `knownMalwareFeed` in the config file to a path or an `https://` URL of a JSON array of
`{ packageName, versions, incident, summary, reference }` entries (`versions` is a list of exact
versions or `"*"`) to have every scan flag an incident immediately, before the built-in list
ships or an advisory reaches OSV. Hits are critical findings; a feed that cannot be read is
reported and the built-in list still applies.

### `mcp`

```bash
npx rn-dep-scanner mcp
```

Runs an [MCP](https://modelcontextprotocol.io) server over stdio so a coding agent can call this
CLI itself. Add it to your agent's MCP config, e.g. for Claude Code:

```bash
claude mcp add rn-preflight -- npx -y rn-dep-scanner mcp
```

Six read-only tools (nothing is installed, written or executed):

| Tool | What it does |
|---|---|
| `check_package` | Before adding a dependency: does the name exist on npm (a missing name is a likely hallucinated or typo'd package), does the name closely resemble a popular package (a typosquat), is the package or version brand new, is usage implausibly low, does it run install-time scripts, is it deprecated or in a known supply-chain incident, does OSV.dev list advisories for the version. Returns `ok` / `review` / `avoid` / `unknown` plus the signals — `ok` only when every check ran. |
| `security_scan` | Same JSON as `security --json`. Optional arguments: `cwd`, `failOn`, `minReleaseAgeDays`, `maxRegistryLookups`. |
| `check_dependencies` | Same JSON as `check --json`. |
| `why` | Same JSON as `why <package> --json`: every path and version a package is installed through. |
| `upgrade_readiness` | Same JSON as `upgrade --json`; omit `to` to target the latest published React Native. |
| `doctor` | Same JSON as `doctor --json`. |

`cwd` arguments must be an existing directory. Offline, `check_package` returns `unknown` with the
lookups it could not run listed in `notChecked`, never a clean result.

### `licenses`

```bash
npx rn-dep-scanner licenses [--json] [--html [path]] [--cwd <path>] [--all-workspaces] [--verbose]
```

Reports each package's declared license across the full transitive tree (counts per license, with copyleft and unknown licenses called out; `--verbose` lists every package), optionally flagging a
`licenseDenylist` from `.rn-dep-scanner.json` (exits 1 on a match). Reads only each package's
*hoisted* `node_modules/<name>/package.json` — a version that lost the hoist to a conflicting
sibling won't have its license read; see [Known limitations](#known-limitations).
`--all-workspaces` reports against every workspace package in the monorepo, same aggregation
behavior as `security` above.

### `sbom`

```bash
npx rn-dep-scanner sbom [--vex] [--html [path]] [--cwd <path>]
```

Exports a CycloneDX **1.6** Software Bill of Materials to stdout as JSON (no `--json` flag needed —
JSON is simply the default output; pass `--html` for an HTML rendering instead). One component
per installed package with a purl `bom-ref`, license (SPDX id, expression, or free-text name),
dev-only marker, and the registry integrity hash (npm, yarn classic, pnpm and bun lockfiles); plus a `dependencies`
section with the real edges. Scoped packages use `group` + `name` and a percent-encoded purl
(`pkg:npm/%40scope/name@1.0.0`).

`--vex` also embeds a CycloneDX `vulnerabilities` section from an OSV.dev scan, so one file
carries both the inventory and the known findings. Every entry is `in_triage`: reachability is
never assessed, so nothing is claimed exploitable or not-affected. If the scan can't run (offline,
OSV unreachable) the command fails rather than print a VEX with an empty list that would read as
"no known vulnerabilities". Advisories you list in `ignoreVulnerabilities` are left out.

Validated against the official CycloneDX 1.6 JSON schema (this repo's own SBOM with and without
`--vex`, plus a fixture with scoped packages and awkward licenses). A license is emitted as an
SPDX `id` only if it is a real SPDX identifier (bundled list, matched case-insensitively);
`BSD`, `UNLICENSED` and prose become a free-text `name`, which is what keeps the document valid.
Limits: yarn berry components have no hash (its `checksum` covers Yarn's own repacked archive, not the registry tarball), and
identifiers inside a compound license expression are not individually checked.

### `renovate-config`

```bash
npx rn-dep-scanner renovate-config [--out <path>] [--cwd <path>]
```

Generates a starter Renovate config aware of React Native's specific update risks — not a
generic `config:recommended` copy-paste. Groups `react-native`/`react`/`react-dom`/`expo` into
one PR (they must stay version-locked), groups every `react-native-*`/
`@react-native-community/*`/`@react-navigation/*` native module into its own more-cautious
group (a native-module update can break at runtime without a type error), and gives any
installed package `data/newArchitecture.ts` already flags as unsupported a dedicated
high-priority group labeled `new-architecture-review` — an update to one of those might *be*
the fix. Respects `.rn-dep-scanner.json`'s `ignorePackages` via Renovate's `ignoreDeps`. Prints
to stdout by default; `--out <path>` writes the file (e.g. `--out renovate.json`) instead.

### `diff --from <dir> --to <dir>`

```bash
npx rn-dep-scanner diff --from <dir> --to <dir> [--json] [--html [path]]
```

`--from`/`--to` are required project directories (not lockfile paths). Compares their dependency
graphs for added/removed/changed packages, then runs a security scan against just what
changed — catches a PR that quietly introduces a vulnerable package. A `knownMalwareFeed` in the `--to` project's config file is applied to that scan. Exits 1 if either directory has no project/lockfile. No `--cwd` (the two
directories you pass are the inputs).

### `policy`

```bash
npx rn-dep-scanner policy [--init] [--json] [--html [path]] [--cwd <path>] [--all-workspaces]
```

`policy --init` writes a starter `.rn-dep-scanner.json` (never overwrites an existing one). Otherwise evaluates `.rn-dep-scanner.json`'s `bannedPackages`, `licenseDenylist`, and
`maxVulnerabilitySeverity` fields (see [Config](#config-file-rn-dep-scannerjson)) by reusing the
same analyzers `licenses`/`security` use. Exits 1 on any violation. `--all-workspaces` evaluates
every workspace package in the monorepo, same aggregation behavior as `security` above — each
workspace package reads its own `.rn-dep-scanner.json`, so a monorepo-wide policy currently
means placing (or symlinking) the same config into each workspace package.

### `baseline`

```bash
npx rn-dep-scanner baseline --create [--cwd <path>]           # snapshot current security findings
npx rn-dep-scanner baseline [--json] [--html [path]] [--cwd <path>]   # report only what's new since the snapshot
```

Useful for adopting the tool on a large existing project without a wall of pre-existing issues
blocking CI on day one. The check run reports how many baselined findings are still present, how
many have been resolved since (so you know when to re-run `--create` to prune), and each new
finding grouped by package with its severity, fix version and dependency path. It fails closed:
if the security scan can't run (e.g. offline), `--create` writes nothing and a check exits 1
rather than reporting "no new vulnerabilities". An unreadable baseline file (truncated, merge-conflict markers) is reported clearly on a check, and `--create` replaces it with a warning; the file is written atomically. Scoped to security vulnerabilities only (not every `check` issue
category — see [Known limitations](#known-limitations)).

`baseline --create` writes `.rn-dep-scanner-baseline.json` to the project root — a **generated
snapshot file**, distinct from the `.rn-dep-scanner.json` config file: you don't hand-write or
edit it, and there's no policy to configure inside it. Re-running `--create` overwrites it with
current findings (and reports how many were added/dropped versus the previous snapshot). Decide per-project whether to commit it: commit it if "new findings since this
snapshot" should be consistent for every contributor/CI run; leave it gitignored if each
machine/branch should track its own baseline independently.

---

## Upgrade planning

### `why-not <package> <version>`

```bash
npx rn-dep-scanner why-not <package> <version> [--json] [--html [path]] [--cwd <path>]
```

Explains which installed package's declared peer/dependency range is blocking a specific
version from being installed. A range that isn't resolvable semver (a `workspace:`/`npm:`/git
protocol reference) is reported as unknown, never guessed true or false.

### `impact <package> <version>`

```bash
npx rn-dep-scanner impact <package> <version> [--json] [--html [path]] [--cwd <path>]
```

Goes further than `why-not`: breaking changes that apply between your installed version and the
target — every applicable note, newest first (ones already in effect on your current version are shown as informational only; `--json` has them all under `breakingChanges`) — the same peer/version
conflicts, and which other installed packages depend on this one (worth re-testing after
upgrading), plus plain-language recommended actions.

### `unused`

```bash
npx rn-dep-scanner unused [--json] [--html [path]] [--cwd <path>]
```

Heuristic (regex-based `require`/`import` scan of project source) flagging declared dependencies
with no detected reference — a starting point for manual review, **not** a "safe to delete"
guarantee. Known tooling-only packages (ESLint/Babel/TypeScript/Jest/Metro plugins, etc.) are
excluded automatically.

---

## Code-level analysis

### `legacy-apis`

```bash
npx rn-dep-scanner legacy-apis [--json] [--html [path]] [--cwd <path>]
```

Detects source imports of core React Native APIs that were removed and split into community
packages (`WebView`, `AsyncStorage`, `Clipboard`, `NetInfo`, `ListView`, and more — see
`src/data/legacyApis.ts`), reporting each affected file with its suggested replacement package.
Also flags React Native 0.87/0.88 removals and deprecations: `InteractionManager`, `Touchable`,
`react-native/Libraries/*` deep imports, the `InitializeCore` import, `experimental_background*`
style keys, and the removed `Modal` `animated` prop (a heuristic JSX match). Beyond those pattern
entries, detection is import-based — a deprecated prop/method on an API that otherwise still
exists isn't covered.

### `a11y`

```bash
npx rn-dep-scanner a11y [--json] [--html [path]] [--strict] [--cwd <path>]
```

Flags interactive elements — `Pressable`, `Touchable*`, `Image`, `Switch`, `TextInput`, `Button`,
and any custom component given an `onPress` — that a screen reader can't describe: no
`accessibilityLabel` / `aria-label` / `alt`, and no visible `<Text>` child to derive one from.
Each finding has `file:line`, the component, and its **declared traits** (`accessibilityRole`,
`accessibilityHint`, `accessibilityState`, `accessible`) as written in source. Labeled
touchables with no `accessibilityRole` are listed separately as informational. `--strict`
exits 1 on a high-confidence missing label.

**Static only, and it says so.** Real native accessibility traits and on-screen frames exist only
in a running app (iOS `UIAccessibility` / Android `AccessibilityNodeInfo`) — reading them needs an
in-app native module or a simulator/device session, which a source scanner doesn't have. This
command reports what the source declares instead (`runtimeInspection.available: false` in
`--json`). A label supplied via a prop spread or wrapper component is invisible to it, so
custom-component findings are marked low confidence.

### `bundle`

```bash
npx rn-dep-scanner bundle [--json] [--html [path]] [--cwd <path>]
```

Reports each direct dependency's on-disk install size, largest first — a quick "what's heavy"
signal, **not** a real Metro bundle analysis (source maps and platform-specific files are
included here but might not end up in an actual bundle).

### `size measure` / `size diff`

```bash
npx rn-dep-scanner size measure --bundle <js> --source-map <map> [--hbc <file>] [--platform ios|android] [--commit <sha>] --out base.json
npx rn-dep-scanner size diff base.json head.json [--budget <file>] [--json] [--html [path]]
```

`measure` attributes the bytes of a JS bundle to the source files in its source map (plain v3 or
Metro's index map) and writes a versioned snapshot; `diff` compares two snapshots and checks them
against a budget (`sizeBudget` in the config file, or `--budget <file>`). It exits 1 when over
budget or when the snapshots aren't comparable (different platform, schema, or known
Metro/Hermes version). It **never runs `expo export`, Metro or `hermesc`** — build in your CI job
first. Export the JS bundle with `npx expo export --dump-sourcemap --no-bytecode`: Expo's default
Hermes output is a `.hbc` whose map points at bytecode offsets, which can't be attributed to
modules. Pass the `.hbc` separately with `--hbc` to record its size; the file's header is validated, and the Hermes version is read from the installed `hermes-compiler` package (falling back to the bytecode format version, e.g. `bytecode-v99`). The Metro version is read from the installed `metro` package. `--metro-version`/`--hermes-version` override both. Per-module sizes are
generated bytes attributed through the source map — an estimate, not exact minified size. In the
GitHub Action, set `size-head` (and `size-base`, `size-budget`) to post the diff as its own PR
comment.

To avoid wiring the base snapshot yourself, upload it as an artifact from a push to the base
branch and let the Action fetch it with `size-baseline-artifact` (needs `actions: read`):

```yaml
# on push to main
- run: npx rn-dep-scanner size measure --bundle main.jsbundle --source-map main.map --out size.json
- uses: actions/upload-artifact@v4
  with: { name: size-base, path: size.json }

# on pull_request
- uses: <owner>/rn-dep-scanner@v1
  with: { size-head: size-head.json, size-baseline-artifact: size-base }
```

Only the newest unexpired artifact from a run of the same repository on the base branch is used
(a fork's artifact is ignored). When none exists or GitHub can't be reached, the Action posts a
"not checked" comment instead of a diff and does not fail the job.

### `architecture`

```bash
npx rn-dep-scanner architecture [--json] [--html [path]] [--cwd <path>]
```

Just the New Architecture (Fabric/TurboModules) compatibility check `check` already runs, on its
own. A package with no compatibility data reports `support: "data_unavailable"` with a `reason`
— that's "we don't know," not "this is broken."

### `native`

```bash
npx rn-dep-scanner native [--json] [--html [path]] [--cwd <path>]
```

Just the Android/iOS native toolchain check `doctor` already runs, on its own (no Hermes/Node/
16KB sections). Note: the JSON key for the Android section is `android` here, vs. `doctor`'s
`androidEnvironment` — same data, different top-level key name in each command's output.

### `16kb`

```bash
npx rn-dep-scanner 16kb [--json] [--html [path]] [--cwd <path>]
```

Just the Android 16KB page-size alignment check `doctor` already runs, on its own. A
`not-checked` result carries a `notCheckedReason`: `no_native_libraries` (nothing to inspect —
JS-only, or compiles from source during the Android build) or `unreadable_library` (a `.so` was
found but couldn't be parsed).

---

## Reporting & CI

### `report`

```bash
npx rn-dep-scanner report [--format md|html] [--out <path>] [--cwd <path>]
```

Renders a condensed health-score/compatibility/deprecated-packages/New-Architecture/security
report — to stdout by default, or a file with `--out`. `--format` defaults to `md`. This is a
deliberately smaller, decision-focused view, not a full mirror of `check --json`.

### `watch`

```bash
npx rn-dep-scanner watch [--interval <seconds>] [--once] [--iterations <n>] [--json] [--html [path]] [--cwd <path>]
```

Runs `check` on a repeating interval (default 300s) — for a long-running terminal/CI job. It
runs **until you press Ctrl+C by design**; use `--once` (single scan) or `--iterations <n>` to
stop on its own. Between scans it prints a live countdown (a plain "Next scan in Ns" line when
output isn't a terminal) so a 5-minute wait doesn't look like a hang. Each cycle runs non-strict,
and a cycle that fails (e.g. a network error during the security scan) is reported and retried
on the next cycle instead of ending the watch.

---

## Global options, network behaviour & exit codes

```bash
npx rn-dep-scanner [--offline] [--timeout <ms>] <command> ...
npx rn-dep-scanner --version | --help
```

- **`--offline`** — no OSV.dev or npm-registry calls (also `RN_DEP_SCANNER_OFFLINE=1`);
  network-backed sections report as skipped. **`--timeout <ms>`** — per-request timeout, default
  8000 (also `RN_DEP_SCANNER_TIMEOUT_MS`). `outdated` warns when registry lookups failed instead of
  silently reporting fewer updates; OSV requests retry transient failures before giving up.
- **Exit codes.** Every command exits 1 on a fatal error (unreadable project, bad arguments).
  Beyond that:

| Command | Exits 1 when |
|---|---|
| `check` | `--strict` and there is an error-level finding (critical/high vulnerability, unsupported New Architecture package, leaked AI key, compatibility error) |
| `security` | a finding at or above `--fail-on` (default `high`), or the scan couldn't run (OSV unreachable/timed out — not when you passed `--offline`) |
| `licenses` | a package matches `licenseDenylist` |
| `policy` | any `bannedPackages` / `licenseDenylist` / `maxVulnerabilitySeverity` violation |
| `baseline` | a new finding since the snapshot, no/unreadable baseline file, or the security scan couldn't run |
| `a11y` | `--strict` and a high-confidence missing label |
| `diff`, `why`, `tree`, `graph` | the project/lockfile can't be found |
| `doctor`, `upgrade` | only on a fatal error — a `BLOCKED` verdict is reported in the output/`--json` (`verdict`, `envVerdict`), not via the exit code |

With `--all-workspaces`, a non-zero exit in any workspace package makes the aggregated run exit 1.

Other behaviour worth knowing:

- **`unused`:** packages used via `package.json` `main`, Expo config plugins, `package.json` scripts, config files, or as a peer of another dependency are listed as implicitly used instead of unused.
- **`upgrade`:** risk accounts for how many React Native minors the jump spans and for installed packages whose rules fail at the target version, lists the reasons, and reports an Android/iOS toolchain as "not verified" when there is no `android/` or `ios/` directory.

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
  "maxVulnerabilitySeverity": "high",
  "minReleaseAgeDays": 7,
  "sizeBudget": { "totalJsKb": 6000, "perModuleGrowthKb": 50, "ignore": ["node_modules/"] },
  "customCompatibilityRules": [
    { "package": "my-internal-fork", "version": "1.x", "reactNative": ">=0.75.0" }
  ]
}
```

| Field | Used by | Meaning |
|---|---|---|
| `ignorePackages` | `check` | Package names to exclude entirely from compatibility analysis. |
| `ignoreVulnerabilities` | `check`, `security`, `policy` | OSV/GHSA/CVE advisory IDs to suppress (e.g. one you've assessed as a false positive or already mitigated). |
| `licenseDenylist` | `licenses`, `policy` | [SPDX license identifiers](https://spdx.org/licenses/) to flag if found on any installed package. There is no built-in denylist — you decide which licenses your org disallows. License strings are matched as read from each package's own `package.json` (not normalized against the SPDX list), so use the identifier as your ecosystem's packages actually declare it. |
| `bannedPackages` | `policy` | Package names to fail on regardless of license or vulnerabilities (e.g. an internally-disallowed vendor SDK). |
| `maxVulnerabilitySeverity` | `policy` | One of `"critical" \| "high" \| "moderate" \| "low"` — `policy` fails if any found vulnerability meets or exceeds this severity. |
| `minReleaseAgeDays` | `security` | Non-negative integer (default 7): versions published fewer than this many days ago are flagged under "Supply-chain signals"; `0` disables the lookups. `--min-release-age` overrides it. |
| `maxRegistryLookups` | `security`, `check` | Positive integer (default 150): cap on npm registry lookups for the supply-chain signals. `--max-registry-lookups` overrides it. |
| `knownMalwareFeed` | `security`, `check`, `policy`, `sbom --vex`, `baseline`, `report` | Path (relative to the project) or `https://` URL of a JSON array of known-malware entries, checked alongside the built-in list. |
| `sizeBudget` | `size diff` | Optional limits: `totalJsKb`, `totalHbcKb`, `perModuleGrowthKb` (KiB, non-negative) and `ignore` (module-id prefixes exempt from the per-module growth check). A `totalHbcKb` limit is reported "not checked" when no Hermes bytecode size was measured. |
| `customCompatibilityRules` | `check` | Project-specific compatibility rules, same shape as the curated entries in `data/compatibility.ts` (`package`, `version` line, optional `reactNative`/`react`/`node` ranges). Checked in addition to the curated rules — for an internal fork or an unreleased dependency the curated data can't know about. |

## Output formats (`--json` / `--html`)

Every command that has `--json` also accepts `--html [path]` — `watch` and `report` included;
`sbom` too, despite JSON being its unflagged default. `--html` renders the same result as a
minimal, dependency-free HTML page: printed to stdout if no path is given, or written to that
file:

```bash
npx rn-dep-scanner check --html report.html
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
  complete for npm, yarn, pnpm, and bun alike — each lockfile's own per-package dependency
  data is parsed and walked from the root's direct dependencies.
- Monorepo support (npm/yarn/pnpm/bun workspaces) resolves the correct lockfile/`node_modules`
  root when run from a workspace package, and a workspace package that depends on a sibling
  workspace package (`"@acme/shared": "workspace:^1.0.0"`) has that sibling cross-linked into
  the same dependency graph for yarn/pnpm/bun too — so a vulnerable package reachable only
  through a local workspace dependency is no longer invisible to `why`/`security`/etc.
  `check`/`doctor`/`why`/`tree`/`security`/`licenses`/`policy`/`upgrade` all support
  `--all-workspaces` to run against every workspace package in one aggregated run instead of
  just `--cwd` (a no-op outside a workspace), and the GitHub Action's `all-workspaces: 'true'`
  input wires the same flag through to `doctor`/`upgrade` and posts one combined PR comment.
  `--all-workspaces` combined with `--html <path>` isn't supported for
  `check`/`doctor`/`why`/`tree`/`upgrade` — each per-package sub-scan is captured as plain JSON
  internally regardless of the outer `--html`, so only the final combined result respects it.
  A single run still only scans the workspace packages at the monorepo it's invoked from, not
  multiple independent monorepos.
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
- A compatibility rule can mark an upper React Native bound as *tested range* rather than a hard requirement (`reactNativeTested` in `data/compatibility.ts` / `customCompatibilityRules`): a project newer than that range gets a **warning** ("not known to be broken — verify on your build"), not an error. Only a violated *minimum* is an error.
- `a11y` is a source scan (JSX tag scanner, no AST): it can't see a label passed through a prop spread or wrapper component, and can't report native traits/frames, which only exist in a running app.
- `security`'s known-malware check (`data/knownMalwarePackages.ts`) is a small hand-curated list
  of confirmed incidents (Mini Shai-Hulud, ChainDrop, MALFEX), checked alongside — not instead
  of — OSV.dev, specifically to close the gap where a live worm-strain incident hasn't been
  given a GHSA ID yet. It is not a general malware scanner and won't catch an incident not
  already added to the list.
- The supply-chain signals are heuristics, not verdicts: a missing provenance attestation or a
  new publishing account has innocent causes (a changed release process, a maintainer handover).
  Each registry lookup is a full packument fetch, so they are capped (150 by default) and anything
  beyond the cap is reported as not checked. `knownMalwareFeed` is a mechanism for your own list,
  not a bundled feed.
- The Swift Package Manager check in `doctor` only sees whether a package ships a `Package.swift`;
  it can't tell whether React Native's SwiftPM mode can actually use the module.
- `sbom` has no hash for yarn berry components: berry's `checksum` covers Yarn's own repacked
  archive, not the registry tarball.
- `ai-exposure`'s API-key detection is shape-based (a regex matching what a real key looks
  like), not a real secrets scanner — it can miss a key in an unexpected format and, rarely,
  flag a random string that happens to match the shape. The AI-SDK-package list
  (`data/aiSdkPackages.ts`) is curated and not exhaustive.

## Development

```bash
npm install
npm run dev check     # run in dev mode (tsx, hot reload)
npm run build          # compile TypeScript to dist/
npm run test            # run the test suite
```

## License

MIT
