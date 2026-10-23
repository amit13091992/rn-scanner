# Project Status

Tracks which components are in progress vs. completed, per `.claude/rules/documentation.md`.
Full command-by-command detail lives in `.claude/rules/architecture.md` and `.claude/rules/roadmap.md`;
this is the short status summary those files don't have to keep updating.

Last reviewed: 2026-10-08 (2026-10 trends pass: AI/security exposure detection, full
yarn/pnpm/bun transitive graph + workspace cross-linking, `--all-workspaces` everywhere,
`renovate-config`, lint + workflow-validation CI tooling — see `.claude/rules/roadmap.md`'s
"Phase 11" for the full list).

## Completed

- Core `check` pipeline: compatibility, breaking changes, New Architecture (with a `--strict`
  gate on any unsupported package), Expo/Expo-Go, dependency completeness, AI SDK client-call
  + key-literal exposure, transitive OSV.dev security scan (npm, yarn, pnpm, and bun all build
  a real transitive dependency graph, including sibling monorepo workspace packages
  cross-linked in — no manager is direct-dependency-only anymore) plus a known-malware-incident
  check (`data/knownMalwarePackages.ts`) that runs independent of network access.
- `doctor`: RN/React + Hermes + Node/Android/iOS toolchain + 16KB page-size + overall verdict.
- `upgrade --to`, `compare-rn`, `why`/`tree`/`graph` — same full transitive hierarchy as above
  for all four package managers.
- `outdated --recommend` — recommends the latest React-Native-compatible version per package,
  not just npm's absolute latest.
- `ai-exposure` and `renovate-config` commands (standalone views of the AI-exposure check and a
  new RN-aware starter Renovate config generator, respectively).
- Supply-chain/CI commands: `security`, `licenses`, `sbom`, `diff`, `policy`, `baseline`, `report`, `watch`.
- Code-level analysis: `legacy-apis`, `unused`, `bundle`.
- Standalone wrappers: `architecture`, `native`, `16kb`.
- `--all-workspaces` on `check`/`doctor`/`why`/`tree`/`security`/`licenses`/`policy`/`upgrade` —
  aggregates the same scan across every workspace package in the monorepo into one report,
  instead of just `--cwd`'s single package.
- GitHub Action + PR comment integration (`action.yml`, `scripts/post-pr-comment.mjs`), including
  an `all-workspaces: 'true'` input that posts one combined PR comment across every workspace
  package; dogfooded by `.github/workflows/preflight-dogfood.yml` (single-package path posts a
  real comment; `--all-workspaces` path is smoke-tested against a throwaway fixture, not posted,
  to avoid colliding with the single-package comment).
- CI: `.github/workflows/ci.yml` — `build-and-test` job (build+test+lint+`npm audit`, Node
  18.x/20.x) plus a `validate-workflows` job (`npm run validate:workflows`, schema-validates
  `action.yml` and both workflow files via `@action-validator/cli`).
- Monorepo *root-detection* (`utils/projectRoot.ts`) and full *workspace-hierarchy* resolution
  (`utils/workspacePackages.ts`) — a scan started inside a workspace package resolves against
  the monorepo root, and a sibling workspace package it depends on is a real graph node.
- `--profile` opt-in step timing on `check`/`doctor` (`utils/profiler.ts`).
- `.rn-dep-scanner.json` config with validation: `ignorePackages`, `ignoreVulnerabilities`,
  `licenseDenylist`, `bannedPackages`, `maxVulnerabilitySeverity`, `customCompatibilityRules`.
- Universal `--html [path]` output (`utils/htmlOutput.ts`) on every command that has `--json`, plus `sbom` — renders the same result data as a minimal HTML page instead of/alongside JSON.
- ESLint (`eslint.config.js` — JS-syntax only, covers `scripts/**/*.mjs`; `src`/`test`
  TypeScript linting is blocked upstream, see `known-limitations.md`).

## In progress / not started

- Automated dependency graph export (beyond the existing `graph --json`/`--dot`).
- Codemod support for migrations.
- `--all-workspaces` aggregates one monorepo's workspace packages; it does not aggregate across
  multiple independent repos/monorepos in one invocation (not asked for yet, noting the boundary).

## Known documentation gaps

- Prior versions of `.claude/rules/documentation.md`'s ADR requirement predate the first ADR
  (`docs/decisions/ADR-0007-new-arch-data-unavailable-rename.md`, 2026-09-22) — earlier
  contract-changing decisions (e.g. the `--profile` flag's `profile` key added to `check --json`/`doctor --json`)
  were not retroactively documented.

## 2026-09-22 fix pass (user bug report)

- `upgrade --to`'s breaking-change detection now classifies each match as `historical` (already
  true before the current install — doesn't affect risk), `relevant`, or `action_required`
  (`src/analyzers/breakingChanges.ts`'s `classifyRelevance`), so a change introduced long before
  the project's current RN version no longer inflates `risk`/`verdict` for an unrelated upgrade.
- New Architecture `support: "unknown"` renamed to `"data_unavailable"` with an explicit `reason`
  field (`ADR-0007`); `check --json`'s `newArchitecture.untested` key renamed to `dataUnavailable`.
  Breaking JSON-contract change — see the ADR.
- 16KB page-size `status: "not-checked"` now carries `notCheckedReason`
  (`'no_native_libraries' | 'unreadable_library'`) so "no native code to check" and "found a
  library but couldn't parse it" are distinguishable (`src/types/pageSize.ts`).
- Fixed `dist/index.js` missing its executable bit, which made `rn-dep-scanner <command>` fail
  after a global install while `npx rn-dep-scanner` (which invokes via `node` directly) still
  worked — `npm run build` now chmods the entry point (`package.json`'s `build:chmod` step).
- README clarified: `.rn-dep-scanner.json` (user-authored config) vs. `.rn-dep-scanner-baseline.json`
  (tool-generated snapshot) are two distinct files; every config field documented with its actual
  meaning (`licenseDenylist`'s `"GPL-3.0"` was previously ambiguous — an example, not a default).

## 2026-09-22 architecture review (16KB / native scanning)

An `architecture-reviewer` agent pass on the 16KB page-size and `native`/`doctor` toolchain
checks (prompted by user-reported "output isn't what I expected") found two real gaps, both
fixed:

- `detectors/android/agp.ts`/`kotlin.ts` previously only read literal version strings from
  `android/build.gradle(.kts)` — a project using a Gradle version catalog
  (`android/gradle/libs.versions.toml`, resolved via `pluginManagement`/`alias(libs.plugins...)`
  in `android/settings.gradle`, a pattern current RN templates increasingly use) reported AGP
  and Kotlin as `unknown` even though both are well-defined. Fixed via a new
  `detectors/android/versionCatalog.ts` fallback plus reading `android/settings.gradle(.kts)`
  as an additional candidate file. This was very likely the actual cause of "the check looks
  broken" — it silently degraded to useless on any project using this now-common pattern.
- `detectors/pageSize.ts` only found `.so` files loose under a `jniLibs/<abi>/` filesystem
  path — a native module that ships its binaries packaged inside an `.aar` (a zip archive, the
  other common AAR packaging convention) was invisible to the check, landing at `not-checked`
  even when it does ship native code. Fixed by extending `utils/zip.ts` with `readZipEntry`
  (stored + DEFLATE decompression via node's built-in `zlib`, no new dependency) and scanning
  `.aar`/`.jar` archives for `jni/<abi>/*.so` entries the same way the iOS `.ipa` dSYM check
  already reads zip content.
- New fixtures/tests: `test-fixtures/aar/` (`scripts/generate-aar-fixtures.mjs`),
  `test/pageSizeAar.test.ts`, `test/versionCatalog.test.ts`, plus `readZipEntry` coverage in
  `test/zip.test.ts`.
