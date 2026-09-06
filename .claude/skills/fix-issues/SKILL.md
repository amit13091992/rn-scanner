---
name: fix-issues
description: Diagnose and fix issues across the rn-dep-scanner workspace (TypeScript CLI tool) — build errors, type errors, failing tests, lint issues, and runtime bugs in the check/analyze pipeline. Use when the user asks to "fix issues", "fix bugs", "fix the build", "fix failing tests", or reports something broken in this repo.
---

# Fix Issues — rn-dep-scanner

Workflow for diagnosing and fixing problems in this repo. Follow project conventions in `CLAUDE.md` and any local overrides in `CLAUDE.local.md`.

## 1. Reproduce first

Never fix blind. Run the relevant command and capture the actual error:

```bash
npm run build        # TypeScript compilation (strict mode)
npm run test         # Node.js test runner (test/**/*.test.ts)
npm run dev check    # Run the CLI against a real/sample project
```

If the user reports a runtime bug, reproduce it with `npm run dev check` (optionally against a scratch RN project) before touching code.

## 2. Localize using the architecture

Map the symptom to a layer (see `CLAUDE.md` for full data flow):

- Wrong/missing dependency versions → `utils/packageJson.ts`, `utils/lockfile.ts`, `parsers/npmLockParser.ts` (and yarn/pnpm parsers)
- Wrong compatibility status → `analyzers/compatibility.ts`, `data/compatibility.ts`
- Wrong breaking-change output → `analyzers/breakingChanges.ts`
- Security scan issues → `services/osvClient.ts`, `analyzers/securityVulnerabilities.ts`, `data/vulnerabilityFallback.ts`, `cache/vulnerabilityCache.ts`
- CLI/formatting issues → `commands/check.ts`, `utils/terminal.ts`, `index.ts`
- Version comparison bugs → `utils/versionComparison.ts` (must use `semver`, never string comparison — this was a past bug, see CLAUDE.md)

Use `Grep`/`Explore` to find the exact function before editing.

## 3. Fix with the project's design decisions in mind

- Preserve the `requestedVersion` vs `resolvedVersion` distinction — security/compatibility logic must use `resolvedVersion`.
- Status fields must stay `'compatible' | 'warning' | 'error' | 'not-checked'` — never collapse to a binary compatible/incompatible.
- All version comparisons go through `semver` (`satisfies`, `lt`, `gt`), never `localeCompare` or manual string parsing.
- OSV calls must keep the offline/cache fallback path working (`~/.rn-scanner-cache/`, 24h TTL) — don't make network calls a hard dependency.
- Don't add abstractions, config options, or error handling for cases that can't occur — match the "no speculative generality" rule from the global CLAUDE.md.

## 4. Verify the fix

After editing:

```bash
npm run build   # must compile clean under strict mode
npm run test    # all tests must pass
npm run dev check   # sanity-check CLI output looks correct
```

If you touched a parser (`npmLockParser.ts`, yarn/pnpm equivalents) or `versionComparison.ts`, run the full test suite — these have historically had regressions (see "Recent Changes" in CLAUDE.md).

## 5. Report

Summarize: root cause, file(s) changed, and which verification commands passed. Do not create summary/report markdown files unless asked.
