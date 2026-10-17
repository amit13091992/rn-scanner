/**
 * Config for the opt-in embedded local AI agent (Phase 14, revised Phase 18). Disabled unless
 * explicitly turned on — this feature must never be a silent dependency of any existing
 * command's output. `model` is an `hf:<org>/<repo>/<file>.gguf`-style URI that
 * `node-llama-cpp`'s `resolveModelFile` resolves and caches locally — there is no external
 * daemon/app to install (ADR-0009 supersedes ADR-0008's Ollama-daemon assumption on this
 * point; `source: 'ai-inferred'` itself is unchanged).
 */
export interface AiAgentConfig {
  enabled: boolean;
  model: string;
}

export const DEFAULT_AI_AGENT_CONFIG: AiAgentConfig = {
  enabled: false,
  model: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF/qwen2.5-1.5b-instruct-q4_k_m.gguf',
};

/** A tool/function definition shared between `agent/tools.ts`'s allowlist and
 *  `services/localModelClient.ts`'s translation into `node-llama-cpp`'s
 *  `defineChatSessionFunction` shape. */
export interface AgentToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}

/**
 * One ambiguous, already-deterministic-analysis-exhausted finding handed to the Phase 15
 * triage loop — never a raw file or arbitrary text. `kind` identifies which analyzer couldn't
 * resolve it, so the agent (and anyone reading `aiTrace` later) knows exactly what's being
 * investigated and why the deterministic path stopped short.
 */
export interface AiTriageFinding {
  kind: 'new-architecture-unknown' | 'compatibility-unknown' | 'peer-conflict-unknown';
  packageName: string;
  /** Plain-language context the deterministic analyzer already has (declared version range,
   *  the project's RN version, etc.) — exactly what would otherwise be shown as "not-checked". */
  context: string;
}

export type AiTriageConfidence = 'low' | 'medium' | 'high';

/** The agent's answer for one finding. Always tagged `source: 'ai-inferred'` so a consumer
 *  (e.g. `utils/prComment.ts`) can never mistake this for a curated/registry-sourced verdict —
 *  see ADR-0008. */
export interface AiTriageVerdict {
  packageName: string;
  verdict: string;
  confidence: AiTriageConfidence;
  reasoning: string;
  source: 'ai-inferred';
}

/** One step of the triage loop's tool-calling trace — kept so every AI-derived verdict ships
 *  with a full, inspectable record of what the agent actually looked up before answering,
 *  rather than being a black box (the differentiator over opaque cloud AI scanners). */
export type AiTraceEntry =
  | { step: number; type: 'tool_call'; tool: string; arguments: Record<string, unknown> }
  | { step: number; type: 'tool_result'; tool: string; result: unknown }
  | { step: number; type: 'final'; content: string };

/** Outcome of running the bounded triage loop for one finding. `verdict` is present only on
 *  success — every other case (model unavailable, model never produced a valid verdict within
 *  the step cap, malformed JSON) reports `error` instead, never a guessed verdict. */
export type AiTriageResult =
  | { finding: AiTriageFinding; verdict: AiTriageVerdict; aiTrace: AiTraceEntry[] }
  | { finding: AiTriageFinding; error: string; aiTrace: AiTraceEntry[] };

/**
 * Phase 16's `check --json` output shape (`aiInsights` key, ADR-0008) — strictly additive,
 * and omitted from `--json` entirely when AI was never consulted (see `commands/check.ts`),
 * never present-but-empty, so "not consulted" and "consulted, found nothing" stay distinguishable.
 */
export interface AiInsightsResult {
  scanned: boolean;
  /** Present only when `scanned` is false — model unavailable, download failed, etc. */
  error?: string;
  findings: AiTriageResult[];
}

/**
 * Phase 17's `ai-setup` command (revised Phase 18): a read-only readiness check by default —
 * is `node-llama-cpp`'s native runtime loadable on this machine, and is the configured model
 * file already downloaded — plus an explicit opt-in `--download` to fetch the model now
 * instead of lazily on first `--ai` use. No external daemon/binary to install (ADR-0009).
 */
export interface AiSetupResult {
  model: string;
  /** Whether `node-llama-cpp` could load its native backend on this machine (its own
   *  platform-specific binary, fetched automatically as part of `npm install` — not a
   *  separate app). False usually means an unsupported platform/architecture. */
  runtimeAvailable: boolean;
  modelDownloaded: boolean;
  modelPath?: string;
  /** Set when `--download` was passed and a download was actually attempted. */
  downloadAttempted?: boolean;
  downloadSucceeded?: boolean;
  ready: boolean;
  /** Plain-language next step(s) for whatever isn't ready yet — empty when `ready` is true. */
  nextSteps: string[];
}
