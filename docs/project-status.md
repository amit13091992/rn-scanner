# Project Status

Tracks which components are in progress vs. completed, per `.claude/rules/documentation.md`.
Full command-by-command detail lives in `.claude/rules/architecture.md` and `.claude/rules/roadmap.md`;
this is the short status summary those files don't have to keep updating.

Last reviewed: 2026-09-22 (bug-report fix pass: upgrade breaking-change relevance, New Architecture
`data_unavailable` rename, 16KB `not-checked` reason, `bin` exec bit, baseline/policy docs).

## Completed

- Core `check` pipeline: compatibility, breaking changes, New Architecture, Expo/Expo-Go, dependency completeness, transitive OSV.dev security scan (npm full-graph; yarn/pnpm/bun direct-only).
- `doctor`: RN/React + Hermes + Node/Android/iOS toolchain + 16KB page-size + overall verdict.
- `upgrade --to`, `compare-rn`, `why`/`tree`/`graph` (npm full hierarchy; yarn/pnpm/bun direct-from-root only).
- Supply-chain/CI commands: `security`, `licenses`, `sbom`, `diff`, `policy`, `baseline`, `report`, `watch`.
- Code-level analysis: `legacy-apis`, `unused`, `bundle`.
- Standalone wrappers: `architecture`, `native`, `16kb`.
- GitHub Action + PR comment integration (`action.yml`, `scripts/post-pr-comment.mjs`), dogfooded by `.github/workflows/preflight-dogfood.yml`.
- CI: `.github/workflows/ci.yml` (build+test+`npm audit`, Node 18.x/20.x).
- Monorepo *root-detection* (`utils/projectRoot.ts`) — a scan started inside a workspace package resolves against the monorepo root.
- `--profile` opt-in step timing on `check`/`doctor` (`utils/profiler.ts`).
- `.rn-dep-scanner.json` config with validation: `ignorePackages`, `ignoreVulnerabilities`, `licenseDenylist`, `bannedPackages`, `maxVulnerabilitySeverity`.
- Universal `--html [path]` output (`utils/htmlOutput.ts`) on every command that has `--json`, plus `sbom` — renders the same result data as a minimal HTML page instead of/alongside JSON.

## In progress / not started

- Full yarn/pnpm/bun workspace **hierarchy** parsing (root-detection exists; transitive graph resolution for these managers does not — npm only).
- Version-update recommendations (latest compatible versions).
- Custom per-project compatibility rules.
- Codemod support for migrations.
- Lint tooling (no ESLint config exists; `tsc --strict` is the only static check).
- `actionlint`/dry-run validation of `action.yml` and the two workflows.

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
