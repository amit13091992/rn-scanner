---
name: roadmap-ideas
description: Propose new features, improvements, and refactors for rn-dep-scanner, informed by current React Native / npm ecosystem trends. Use when the user asks "what should we build next", "what can be improved", "any feature ideas", "what are competitors doing", or wants a roadmap/trends review.
---

# Roadmap & Trends — rn-dep-scanner

Generate grounded feature/improvement ideas for this CLI, not generic "add more tests" filler. Every suggestion must tie back to either a gap in the current architecture or an observed trend in the RN/npm ecosystem.

## 1. Establish current state first

Before proposing anything, check what already exists so suggestions aren't duplicates:

- Read `CLAUDE.md` — "Recent Changes" and "Next Steps (Phase 3 / Phase 4+)" sections already list known gaps (New Architecture/Fabric/TurboModules support, Hermes detection, transitive dependency graph, monorepo support, OSV reinstatement, update recommendations, CI/CD integration, custom config).
- Check `git log --oneline -20` for what's actually landed recently vs. what's still aspirational in the docs.
- Skim `analyzers/`, `data/compatibility.ts`, `data/vulnerabilityFallback.ts` to see current coverage (which packages/versions are handled).
- Check package memory (`/Users/abc/.claude/projects/-Users-abc--amit1392-rn-dep-scanner/memory/product-roadmap.md` and `phase1-implementation-complete.md`) if present, for the existing 40-point plan and what's done.

## 2. Research current industry trends

Use `WebSearch`/`WebFetch` for time-sensitive facts — don't rely on training-data knowledge for version numbers or "latest" claims. Look at:

- **React Native releases**: current stable version, New Architecture (Fabric/TurboModules) default-on status, Hermes-by-default status.
- **Expo SDK**: current SDK version and its RN version pairing (expo compatibility is a common pain point).
- **Competing/adjacent tools**: `npm-check-updates`, `depcheck`, `npx react-native-doctor`, `expo-doctor`, Renovate/Dependabot RN-specific configs, Snyk/Socket.dev supply-chain scanning — what do they do that this tool doesn't?
- **Security landscape**: recent notable npm supply-chain incidents (typosquatting, compromised maintainer accounts) — informs whether deeper OSV/Socket-style scanning is worth prioritizing.
- **Package manager trends**: pnpm adoption growth, Bun adoption in RN projects, monorepo tooling (Nx, Turborepo) usage in RN codebases.

Cite what you find with source and date; flag anything from before ~6 months ago as possibly stale and worth re-verifying.

## 3. Structure the output

For each idea:

- **What**: one-line feature/improvement description.
- **Why now**: the specific gap or trend driving it (cite the doc section, code gap, or trend research from step 1/2).
- **Effort**: rough size (S/M/L) relative to existing code — name the files/layers it touches (e.g., "new `detectors/hermes.ts` + wire into `commands/check.ts`").
- **Priority signal**: does it match a P0/P1 already listed in CLAUDE.md's Phase 3/4, or is it a new idea outside that list?

Group into:
1. **Already planned** (Phase 3/4 items) — note if trends research changes their priority.
2. **New ideas from trends research** — things not yet in CLAUDE.md.
3. **Nice-to-have / long tail** — lower priority polish.

## 4. Don't implement unprompted

This skill is for ideation and prioritization, not execution. Present the list and let the user pick what to build — then hand off to normal implementation (or the `fix-issues` skill if it's bug-shaped rather than net-new).

Don't write the output to a markdown file unless the user asks for a persisted roadmap doc — respond inline.
