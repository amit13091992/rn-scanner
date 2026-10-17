# ADR-0008: `source: 'ai-inferred'` tag on AI-agent-derived verdicts

## Context

Phase 14/15 added an opt-in local AI agent (`services/ollamaClient.ts`, `agent/tools.ts`,
`agent/triage.ts`) that can investigate findings a deterministic analyzer left ambiguous
(`not-checked`/`unknown` New Architecture status, an unresolved compatibility rule, etc.) by
calling a small allowlisted set of read-only tools, then returning a structured verdict
(`AiTriageVerdict` in `src/types/aiAgent.ts`).

Phase 16 is about to wire this into actual command output (`check`/`doctor`/`upgrade`'s
`--ai` flag, a new `aiInsights` key in `--json`, and an optional section in
`utils/prComment.ts`'s PR-comment formatter). Before any consumer starts reading that output,
this project needs a durable, explicit contract for distinguishing an AI-derived guess from
every other field in the same JSON payload — all of which come from curated data
(`data/newArchitecture.ts`, `data/compatibility.ts`), the registry, or a live network lookup
with a verifiable source (OSV.dev, npm). An AI verdict is categorically different: it can be
wrong in ways none of those sources can, and a consumer (a CI gate, a PR comment reader, a
dashboard) must never be able to mistake one for the other, silently or otherwise.

This is also the project's stated competitive differentiator (see the `ai-agent-integration`
memory/roadmap discussion): transparency about what is AI-inferred vs. deterministic is the
whole point, not an afterthought.

## Decision

- Every AI-agent-derived verdict object carries a literal, non-optional field
  `source: 'ai-inferred'` (already defined on `AiTriageVerdict` in `src/types/aiAgent.ts`).
  This is a discriminant, not a description — nothing else in this codebase's output may ever
  set `source` to that exact string.
- `aiInsights` (the Phase 16 output key) is strictly additive: it is a new top-level key in
  `check`/`doctor`/`upgrade --json`, never a replacement for or mutation of any existing field
  (`newArchitecture`, `compatibility`, etc.). A consumer that ignores `aiInsights` entirely gets
  byte-identical output to today.
- `utils/prComment.ts`'s formatters render `aiInsights` findings in their own clearly labeled,
  visually separated (collapsible `<details>`) section — never merged into the deterministic
  verdict section, never contributing to the overall READY/WARN/BLOCKED verdict computation in
  `utils/verdict.ts`.
- The full `aiTrace` (every tool call the agent made) travels alongside each verdict in
  `aiInsights`, so `source: 'ai-inferred'` is always auditable, not just labeled.
- `--ai` is opt-in on every command that gains it; without the flag, `aiInsights` is omitted
  from `--json` entirely (not present-but-empty), mirroring how `security`'s `scanned: false`
  path still always shows the key — here, no key at all means "AI was not consulted," which is
  a meaningfully different statement from "AI was consulted and found nothing."

## Alternatives considered

- A `confidence`-only signal with no explicit `source` tag — rejected: confidence describes
  how sure the model is, not where the data came from. A consumer still needs an unambiguous
  way to filter AI-derived content out entirely (e.g. a CI policy that wants deterministic
  output only), which a confidence score alone can't provide.
- Prefixing AI-derived fields with `ai`-namespaced keys inline within existing sections (e.g.
  `newArchitecture.aiVerdict`) instead of a separate top-level `aiInsights` block — rejected:
  this would make every existing section's shape AI-agent-aware, forcing every future analyzer
  to think about AI integration. A single additive top-level key keeps the blast radius to one
  place.
- Reusing the existing `data_unavailable` status (ADR-0007) and just attaching an AI opinion to
  it — rejected: conflates "no curated data exists" (a fact about this project's dataset) with
  "here's what an LLM guessed" (a different kind of claim entirely); keeping them as separate
  fields lets a consumer render both without either overwriting the other's meaning.

## Consequences

- `utils/prComment.ts` and any future consumer of `check`/`doctor`/`upgrade --json` must treat
  `source: 'ai-inferred'` as a hard filter point — e.g. a `policy`/`baseline`-style gate must
  never silently fold an AI-inferred verdict into a pass/fail decision meant for deterministic
  findings only.
- Adding this field to `AiTriageVerdict`'s type is not itself a breaking change (Phase 15 code
  isn't wired into any command's output yet), but Phase 16's `aiInsights` key is a new,
  permanent part of the `--json` contract from here on — removing or renaming it later would
  need its own ADR, same as ADR-0007's `data_unavailable` rename did for `newArchitecture`.
- Documentation (`README`, `.claude/rules/architecture.md`) must describe `aiInsights` as
  opt-in and clearly mark it as not affecting the overall verdict, so it isn't mistaken for a
  gating signal by a new contributor or a CI integrator skimming the output shape.

## Status

Accepted (2026-10-08). Implementation lands in Phase 16 (`--ai` flag, `aiInsights` key,
PR-comment section).
