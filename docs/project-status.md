# Project Status

Tracks which components are in progress vs. completed, per `.claude/rules/documentation.md`.
Full command-by-command detail lives in `.claude/rules/architecture.md` and `.claude/rules/roadmap.md`;
this is the short status summary those files don't have to keep updating.

Last reviewed: 2026-09-21 (docs-accuracy pass against `package.json` v1.3.13 / commit `e7e0be5`).

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

- No ADRs exist yet under `docs/decisions/` despite `.claude/rules/documentation.md` requiring one for
  contract-changing decisions (e.g. the `--profile` flag's `profile` key added to `check --json`/`doctor --json`
  predates this requirement being enforced).
