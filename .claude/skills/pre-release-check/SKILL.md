---
name: pre-release-check
description: Full pre-push/pre-publish verification for rn-dep-scanner — builds, runs the test suite, and smoke-tests the actual CLI binary against real fixture projects (npm/yarn/pnpm, RN and non-RN) to catch runtime breakage that unit tests miss. Use when the user asks to "test everything", "verify before push", "make sure it works", "pre-publish check", or before running `npm publish`.
---

# Pre-Release Check — rn-dep-scanner

This repo has broken after pushing multiple times even though `npm run build` and `npm run test` passed. Unit tests don't exercise the actual compiled CLI binary end-to-end, so this skill closes that gap. Run every step below — do not stop at the first passing step and declare done.

## 1. Clean build

```bash
rm -rf dist
npm run build
```

Must compile clean under strict mode with zero errors. A stale `dist/` can hide a broken build from earlier.

## 2. Unit / integration test suite

```bash
npm run test
```

All tests in `test/**/*.test.ts` must pass (parsers, version detection, deprecated packages, integration). If anything fails, stop and fix before continuing — don't run the CLI smoke tests against known-broken code.

## 3. CLI smoke tests against real fixtures

This is the step that has historically been skipped and is why regressions reached users. Run the **actual built binary** (`node dist/index.js`, not `tsx src/index.ts`) against real sample projects, covering every package manager and both JSON and human output:

```bash
# Use existing fixtures under test/fixtures if present, otherwise scratch dirs
ls test/fixtures

for fixture in test/fixtures/*/; do
  echo "=== $fixture ==="
  node dist/index.js check --cwd "$fixture" || echo "EXIT CODE: $?"
  node dist/index.js check --cwd "$fixture" --json > /tmp/out.json || echo "JSON MODE FAILED"
  node dist/index.js outdated --cwd "$fixture" || echo "OUTDATED FAILED"
done
```

For each fixture, verify manually (don't just check exit code):
- Human-readable output has no garbled formatting (dash bugs, misaligned sections — this repo has had exactly this bug before).
- `--json` output is valid JSON (`node -e "JSON.parse(require('fs').readFileSync('/tmp/out.json'))"`) and has the expected shape (`dependencies`, `summary`, health score fields).
- Compatibility `status` values are only `'compatible' | 'warning' | 'error' | 'not-checked'` — never a stray value.
- No unhandled promise rejections or stack traces printed to stderr.

If `test/fixtures` doesn't cover a package manager (npm/yarn/pnpm) or a no-RN-detected case, create a temporary scratch project under `/tmp` with a minimal `package.json` + lockfile for that manager and run the same checks — then delete the scratch dir.

## 4. Edge cases that have broken before

Explicitly test these (grep `CLAUDE.md` "Recent Changes" for the full history of past bugs):

- **No RN detected**: `package.json` with no `react-native` dependency — must not crash, should report gracefully (not silently claim compatibility).
- **Missing lockfile**: project with `package.json` but no lockfile — `requestedVersion` used, should not crash trying to read a resolved version.
- **Version comparison edge cases**: a dependency at e.g. `11.9.0` vs a rule requiring `<11.26.0` — confirms `semver` is used, not string comparison (this exact bug shipped before).
- **`--strict` flag**: run against a fixture with known errors and confirm exit code is `1`; run against a clean fixture and confirm exit code is `0`.
- **`--cwd` pointing outside the current directory**: confirms path handling doesn't assume `process.cwd()`.

## 5. Live real-world project run (not synthetic fixtures)

Steps 3-4 use minimal hand-built fixtures, which catch I/O-shape bugs but not architecture drift (e.g. a change in `commands/check.ts` that stops calling `analyzeBreakingChanges()`, or a detector that silently no-ops on real-world file layouts). Before trusting the release, run the CLI against at least one **real, non-trivial React Native app** on disk:

```bash
# Prefer a real checked-out RN app if one is available locally (ask the user for a path,
# or use `npx react-native init` / a fresh Expo app in a scratch dir if none exists).
node dist/index.js check --cwd <real-app-path>
node dist/index.js check --cwd <real-app-path> --json | node -e "JSON.parse(require('fs').readFileSync(0))" && echo "valid json"
node dist/index.js outdated --cwd <real-app-path>
```

While reviewing this run, trace the **actual data flow**, not just the output — confirm each stage in `CLAUDE.md`'s pipeline diagram actually fired and produced non-trivial results for a real project's dependency set:

- `readPackageJson()` picked up the real dependency list (spot-check count against the app's `package.json`).
- `detectReactNativeVersions()` found the real RN/React versions (not `undefined`/fallback values).
- `getAllDependenciesWithResolution()` resolved real versions from the app's actual lockfile — pick 2-3 packages and manually confirm `resolvedVersion` matches what's in the lockfile/`node_modules`.
- `analyzeAllDependencies()`, `analyzeBreakingChanges()` produced results consistent with the packages actually present (e.g. if the app has `react-native-reanimated`, a rule should fire for it — check `data/compatibility.ts` / `data/breakingChanges` coverage against the app's real dependency list).
- If the app has monorepo structure (workspaces) or a New Architecture config (`newArchitectureEnabled` in `gradle.properties`/`Podfile.properties.json`), confirm the scanner doesn't silently skip or crash on it — flag it as a known gap if unsupported rather than treating a silent wrong answer as a pass.

This step exists because unit tests and synthetic fixtures can all pass while a change quietly breaks the tool on the shape of a real app's dependency tree — that's the class of bug that has reached users before. If no real RN app is available on this machine, say so explicitly in the report rather than skipping this step silently.

## 6. Report honestly — no dummy or fabricated results

Every result reported in step 7 must come from a command actually executed in this run, with its real output inspected — never a value carried over from memory, a previous run, or assumed because "it passed last time." Concretely:

- Don't say "24/24 tests pass" without having just run `npm run test` in this session and read the output.
- Don't claim a fixture's JSON is valid without having actually run `node -e "JSON.parse(...)"` against the file produced in this run.
- Don't reuse resolved-version numbers, health scores, or exit codes from an earlier report — re-derive them every time, since the whole point of this skill is that a passing report can go stale the moment code changes.
- If step 5 (live real-world project) is skipped because no real app is available, say exactly that — never substitute a synthetic fixture's numbers and present them as if they came from a real app.
- If a step can't be completed (missing tool, no network, no real RN app on disk), report it as "not run: <reason>", not as a pass.

## 7. Package contents sanity check (only before `npm publish`)

```bash
npm pack --dry-run
```

Confirm the file list matches `files` in `package.json` (`dist`, `package.json`, `README.md`, `LICENSE` only) and that `dist/index.js` is present and executable as the CLI entry (`bin` field). A broken `files`/`bin` config ships a package that installs but doesn't run — this class of bug won't show up in `npm run test` at all.

## 8. Report

Summarize pass/fail per step (build, unit tests, each fixture's smoke test, each edge case, the live real-project run) using only results actually produced in this run (see step 6). If something fails, do not mark the release check "done" — go fix it (use the `fix-issues` skill) and re-run from step 1. Do not create a report markdown file unless asked; report inline.
