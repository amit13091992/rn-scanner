# ADR-0009: Embed the AI agent's model via `node-llama-cpp` instead of an external Ollama daemon

## Context

Phase 14 (ADR-0008) built the opt-in local AI agent against Ollama: a separate application
the user installs and runs as a background daemon, which `services/ollamaClient.ts` talked to
over HTTP (`localhost:11434`).

That design has a real adoption cost this project's actual use case can't accept: this CLI is
run against **client projects**, often on machines the maintainer doesn't control. Asking a
client to separately install and keep running a whole other application (Ollama) just so an
*optional* feature works is a much heavier ask than "run `npm install`" — and it's the kind of
dependency this project explicitly set out to avoid when the AI feature was scoped as "free
and local" in the first place. A feature that needs a manual, out-of-band install step for a
third-party app isn't really free of friction even though it costs no money.

## Decision

- Replace `services/ollamaClient.ts` (HTTP client to an external Ollama daemon) with
  `services/localModelClient.ts`, which runs the model **in-process** via `node-llama-cpp` —
  a normal npm dependency with pre-built native bindings for common platforms, resolved by
  `npm install rn-dep-scanner` itself like any other native dependency (e.g. `sharp`,
  `sqlite3`). No separate application, no background daemon, no PATH setup.
- The model file itself (a quantized GGUF, default `qwen2.5-1.5b-instruct-q4_k_m.gguf` — the
  initial 0.5B pick was too small to reliably follow the "respond with only JSON" instruction
  in practice, confirmed against a real end-to-end run; 1.5B was chosen as the next step up
  rather than jumping straight to a much larger model, since this is still meant to be a
  quick, lightweight local convenience) is **not** bundled into the npm package — it's resolved and
  cached lazily via `node-llama-cpp`'s `resolveModelFile`, on first actual `--ai` use (or
  pre-fetched via the new `ai-setup --download`). This keeps `npm install rn-dep-scanner`
  itself small for every user, since only users who opt into `--ai` ever trigger that download.
- `AiAgentConfig` drops `endpoint` (no HTTP server to point at) and keeps `model`, now an
  `hf:<org>/<repo>/<file>.gguf`-style URI rather than an Ollama model tag.
- `ai-setup` (Phase 17) is revised to match: it checks whether `node-llama-cpp`'s native
  backend loads on this machine and whether the model file is downloaded, instead of checking
  for an Ollama binary/daemon. `--pull` is renamed `--download` to match ("pull" was Ollama's
  own vocabulary).
- `agent/triage.ts`'s tool-calling loop now drives `node-llama-cpp`'s own in-process function
  calling (`LlamaChatSession.prompt(..., { functions })`) instead of Ollama's HTTP tool-calling
  protocol; the `MAX_STEPS` cap is enforced by having a tool handler throw once exceeded,
  aborting the session's internal loop, rather than by controlling an outer HTTP request loop.
  `source: 'ai-inferred'` and the `aiTrace` contract (ADR-0008) are unchanged.
- `agent/triage.ts`'s final-verdict step is **grammar-constrained**, not prompt-instructed:
  `services/localModelClient.ts`'s `runLocalChatWithTools()` runs a second prompt in the same
  session (after any tool-calling pass) using a grammar built from `llama.createGrammarForJsonSchema()`
  instead of `functions`, which structurally forces the model to only emit tokens matching the
  verdict schema. Confirmed necessary in practice: asking the model to "respond with ONLY
  JSON" in the system prompt was unreliable even on the 1.5B model (it kept responding in
  prose) — the same "enforce in code, not the prompt" principle this project already applies
  to the `MAX_STEPS` tool-call cap, now applied to output format too.
- `getLlama()` is called with `{ logLevel: 'error' }`. Without it, `node-llama-cpp` prints
  native-load diagnostics (e.g. a GGUF metadata warning) directly to stdout — which silently
  corrupted `check --ai --json`'s output the moment a model loaded, since stdout was no longer
  valid JSON. Found by actually piping `--json` output through `JSON.parse` end-to-end, not
  just inspecting it visually.
- `node-llama-cpp`'s own dependency tree pulled in a critical-severity transitive advisory
  (`@simple-git/argv-parser` < 2.0.1, via `simple-git`, used only by `node-llama-cpp`'s
  git-based model-source feature — unused by this project, which only resolves `hf:` URIs).
  Fixed via an npm `overrides` entry pinning `simple-git` to `^4.0.2` under `node-llama-cpp`,
  confirmed clean via `npm audit` (0 vulnerabilities) rather than downgrading `node-llama-cpp`
  itself (npm's suggested `audit fix --force` path, which would have been a breaking downgrade
  to `node-llama-cpp@2.0.0` for no reason — the vulnerable code path isn't one this project
  exercises at all).

## Alternatives considered

- **Keep Ollama, document it as a one-time setup cost.** Rejected per the Context above — the
  whole point of "free and local" was zero extra friction for a client machine; an external
  daemon reintroduces exactly the friction this was meant to avoid.
- **A free-tier cloud API (no local install at all).** Rejected: reintroduces a network
  dependency, third-party terms of service, rate limits, and data leaving the client's
  machine — closer to "paid AI stuff" in spirit even on a free tier, and the user explicitly
  ruled this out.
- **Bundle the raw model weights inside the npm tarball.** Rejected: even the smallest usable
  instruct model is several hundred MB, which would make `npm install rn-dep-scanner` itself
  slow and large for every single user, including the overwhelming majority who will never
  touch `--ai`. Lazy, cached, opt-in-only download (the chosen approach) gets the same "no
  manual install step" outcome without that cost.
- **`npm audit fix --force` to resolve the critical advisory.** Rejected: would downgrade
  `node-llama-cpp` to `2.0.0`, a breaking change, to fix a vulnerability in a code path
  (git-based model sources) this project never calls. The `overrides` pin is a more targeted
  fix with no functional downside here.

## Consequences

- `.rn-dep-scanner.json`'s `ai.endpoint` field is removed — a config file written against
  ADR-0008's shape with `ai.endpoint` set now gets an "unknown option" warning (not a hard
  failure, per `utils/config.ts`'s existing degrade-and-warn contract) and that field is
  silently dropped rather than acted on.
- `ai-setup --pull` is renamed `--download`; any script/CI step using the old flag name needs
  updating.
- `check --ai`'s `aiInsights.error` message changed from an Ollama-reachability message to a
  native-runtime-availability message; any consumer pattern-matching on the old wording breaks.
- Every test previously mocking `fetch` for Ollama's HTTP endpoints now mocks
  `localModelClient.ts`'s `__setModuleLoaderForTests` seam instead (test-only export, never
  called from production code) — a real model/native-binary load isn't feasible in unit tests.
- First actual `--ai` use (or `ai-setup --download`) now costs a real, one-time, several-
  hundred-MB download — this is an unavoidable trade-off of "free and local with no bundled
  weights," not a regression from the Ollama design, which had the same download cost via
  `ollama pull` instead.

## Status

Accepted and implemented (2026-10-08). Supersedes the Ollama-daemon-specific parts of
ADR-0008; ADR-0008's `source: 'ai-inferred'` discriminant and `aiInsights` additivity
decisions are unchanged.
