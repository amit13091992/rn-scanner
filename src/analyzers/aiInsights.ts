import { isRuntimeAvailable } from '../services/localModelClient.js';
import { triageFinding } from '../agent/triage.js';
import type { AiAgentConfig, AiInsightsResult, AiTriageFinding } from '../types/aiAgent.js';
import type { NewArchCheckResult } from '../types/newArchitecture.js';

/**
 * Caps how many `data_unavailable` New Architecture findings get handed to the local model
 * per `check` run. A project can easily have dozens of such packages; triaging all of them
 * sequentially against a tiny embedded model would make `--ai` impractically slow for a
 * feature that's meant to be a quick-turnaround local convenience, not a long batch job.
 * Phase 15's 5-step cap bounds one finding; this bounds how many findings get that treatment.
 */
const MAX_FINDINGS = 5;

/**
 * Runs the Phase 15 triage loop over a project's New-Architecture `data_unavailable` results
 * — the only finding kind `check` currently feeds the agent (ADR-0008 scopes `aiInsights` to
 * this one case for now). Phase 18: the model runs embedded via `node-llama-cpp`, downloading
 * itself on first use — there is no external daemon to be unreachable, only a native runtime
 * that may be unavailable on this platform or a model that hasn't been downloaded yet.
 *
 * Never throws. `enabled: false` upstream means this isn't even called; once called, an
 * unavailable runtime degrades to `{ scanned: false, error, findings: [] }` so `check --ai`
 * still completes with its deterministic output fully intact.
 */
export async function analyzeAiInsights(
  aiConfig: AiAgentConfig,
  dataUnavailable: NewArchCheckResult[],
  reactNativeVersion?: string
): Promise<AiInsightsResult> {
  const runtimeReady = await isRuntimeAvailable();
  if (!runtimeReady) {
    return {
      scanned: false,
      error:
        'The local AI runtime (node-llama-cpp) could not be loaded on this machine — see "rn-dep-scanner ai-setup" for details.',
      findings: [],
    };
  }

  const findings: AiTriageFinding[] = dataUnavailable.slice(0, MAX_FINDINGS).map((entry) => ({
    kind: 'new-architecture-unknown',
    packageName: entry.package,
    context: `No curated New Architecture (Fabric/TurboModules) compatibility entry for ${entry.package}@${entry.version}.${
      reactNativeVersion ? ` Project React Native version: ${reactNativeVersion}.` : ''
    }`,
  }));

  const results = [];
  for (const finding of findings) {
    results.push(await triageFinding(aiConfig, finding));
  }

  return { scanned: true, findings: results };
}
