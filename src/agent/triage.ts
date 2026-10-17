import { runLocalChatWithTools, type LocalAgentTool, type ResponseJsonSchema } from '../services/localModelClient.js';
import { AGENT_TOOL_DEFINITIONS, runAgentTool } from './tools.js';
import type {
  AiAgentConfig,
  AiTraceEntry,
  AiTriageConfidence,
  AiTriageFinding,
  AiTriageResult,
  AiTriageVerdict,
} from '../types/aiAgent.js';

/** Hard cap on tool-calling round-trips. Enforced here in code (a handler throws once the
 *  cap is exceeded, aborting `node-llama-cpp`'s own internal function-calling loop), not in
 *  the system prompt — the one mistake the research into autonomous dependency-update agents
 *  flagged repeatedly: a model asked nicely to "stop after a few tool calls" will not
 *  reliably stop on its own. */
const MAX_STEPS = 5;

const VALID_CONFIDENCE = new Set<AiTriageConfidence>(['low', 'medium', 'high']);

/** Grammar-constrains the final answer to this exact shape (structural enforcement in
 *  `services/localModelClient.ts`, not a prompt instruction the model might ignore —
 *  see that module's doc comment for why this was necessary). `parseVerdictJson` below
 *  still validates the result rather than trusting the grammar blindly, since a grammar
 *  guarantees well-formed JSON matching the schema's types, not domain-sensible content. */
const RESPONSE_SCHEMA: ResponseJsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string' },
  },
  required: ['verdict', 'confidence', 'reasoning'],
};

function buildSystemPrompt(finding: AiTriageFinding): string {
  return [
    'You are a triage assistant for rn-dep-scanner, a React Native dependency scanner.',
    'A deterministic analyzer could not resolve the following finding and needs your help:',
    `- kind: ${finding.kind}`,
    `- package: ${finding.packageName}`,
    `- context: ${finding.context}`,
    '',
    'Use the available tools if they would help you answer more accurately. Once you have',
    'enough information, stop calling tools — you will then be asked to give your final',
    'verdict, confidence (low/medium/high), and reasoning in a structured format.',
  ].join('\n');
}

function parseVerdictJson(content: string): Omit<AiTriageVerdict, 'packageName' | 'source'> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.verdict !== 'string' || record.verdict.length === 0) return undefined;
  if (typeof record.confidence !== 'string' || !VALID_CONFIDENCE.has(record.confidence as AiTriageConfidence)) {
    return undefined;
  }
  if (typeof record.reasoning !== 'string' || record.reasoning.length === 0) return undefined;
  return { verdict: record.verdict, confidence: record.confidence as AiTriageConfidence, reasoning: record.reasoning };
}

/**
 * Runs the bounded tool-calling loop for exactly one ambiguous finding, via the embedded
 * local model (`services/localModelClient.ts` — no HTTP daemon, Phase 18). Never throws: a
 * model/download failure, or a model that never settles on valid JSON, or a step-cap
 * overrun all resolve to `{ error }` with whatever trace was collected so far — the
 * deterministic result the finding came from is always left untouched either way.
 */
export async function triageFinding(config: AiAgentConfig, finding: AiTriageFinding): Promise<AiTriageResult> {
  const aiTrace: AiTraceEntry[] = [];
  let stepCount = 0;

  const tools: LocalAgentTool[] = AGENT_TOOL_DEFINITIONS.map((definition) => ({
    definition,
    handler: async (args: Record<string, unknown>) => {
      stepCount++;
      if (stepCount > MAX_STEPS) {
        throw new Error(`exceeded the ${MAX_STEPS}-step limit without a final verdict`);
      }
      aiTrace.push({ step: stepCount, type: 'tool_call', tool: definition.function.name, arguments: args });
      const result = await runAgentTool(definition.function.name, args);
      aiTrace.push({ step: stepCount, type: 'tool_result', tool: definition.function.name, result });
      return result;
    },
  }));

  const result = await runLocalChatWithTools(
    config.model,
    buildSystemPrompt(finding),
    `Investigate "${finding.packageName}" and give your verdict.`,
    tools,
    RESPONSE_SCHEMA
  );

  if (!result.ok) {
    return { finding, error: result.error, aiTrace };
  }

  aiTrace.push({ step: stepCount + 1, type: 'final', content: result.content });
  const parsed = parseVerdictJson(result.content);
  if (!parsed) {
    return { finding, error: 'model did not return a valid verdict JSON object', aiTrace };
  }
  return { finding, verdict: { packageName: finding.packageName, source: 'ai-inferred', ...parsed }, aiTrace };
}
