# ADR-0007: Rename New Architecture `support: "unknown"` to `"data_unavailable"`

## Context

`architecture --json` (and `check`'s `newArchitecture` section) reported `support: "unknown"`
for a package with no curated New Architecture compatibility entry that still looked like a
native module (matches `LIKELY_NATIVE_MODULE_PATTERN` in `src/analyzers/newArchitecture.ts`).

User feedback (2026-09-22) flagged this as misleading: `unknown` reads as "compatibility is in
doubt" alongside `unsupported`/`partial`, when the actual meaning is narrower — this project
simply has no data for the package, not evidence of a problem. A project with, say, 44 of 50
packages reported as `unknown` could easily be misread as "44 packages might be broken" when
the correct read is "we haven't curated data for 44 of them."

## Decision

- Rename the `NewArchSupport` union value `'unknown'` to `'data_unavailable'`
  (`src/types/newArchitecture.ts`).
- Add an optional `reason` field to `NewArchCheckResult`, populated whenever
  `support === 'data_unavailable'`, explaining why (mirrors the existing `notes` text for this
  case, but as a dedicated field rather than overloading `notes`, which is also used for
  curated `partial`-support explanations).
- Rename `check --json`'s `newArchitecture.untested` key to `newArchitecture.dataUnavailable`
  to match.
- Update terminal/human output in `check`, `doctor`, and `architecture` to describe this state
  as "no compatibility data available — not a compatibility issue, just unverified" rather than
  a bare count.

This is a breaking change to `check --json` and `architecture --json`'s output contract: any
consumer matching on the literal string `"unknown"` or reading the `untested` key will need to
update to `"data_unavailable"` / `dataUnavailable`.

## Alternatives considered

- `"not_verified"` — considered, but reads slightly more like "we checked and couldn't decide"
  than "we have no data to check against," which is the actual case here. `data_unavailable` is
  more precise about *why* no verdict exists.
- Leaving `notes` as the only explanation and not adding `reason` — rejected because `notes` is
  also populated for curated `partial` entries with a different kind of message; a caller
  wanting to render "why is this unverified" specifically needs a field that's only ever set
  for this one case.

## Consequences

- Any dashboard, CI script, or PR-comment formatter reading the old `"unknown"`/`untested`
  contract must be updated before upgrading past this version.
- Summary counts (e.g. "44 unknown") should be re-labeled by consumers as "44 no data" or
  similar, so the ambiguity this ADR fixes doesn't just move downstream.
- No other command's contract changes — `expoGoSupport`'s own `support: 'unknown'` is a
  separate, unrelated type (`ExpoGoSupport`) and is out of scope for this decision.

## Status

Accepted and implemented (2026-09-22).
