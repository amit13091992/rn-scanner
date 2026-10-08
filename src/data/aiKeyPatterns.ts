export interface AiKeyPattern {
  provider: string;
  label: string;
  pattern: RegExp;
}

/**
 * Shape-based matches for AI-provider API key literals — the same class of check a secrets
 * scanner does, scoped to AI providers specifically since that's this project's domain. These
 * match the *shape* a real key has (prefix + length), not a real key value, so a match is
 * reported by provider/label/location only — the matched substring itself is never surfaced,
 * logged, or included in any output (see `detectors/aiSdkUsage.ts`).
 */
// Order matters: `sk-ant-...` also satisfies the generic OpenAI `sk-...` shape, so the
// Anthropic-specific pattern must be tested first (detector stops at the first match per line).
export const AI_KEY_PATTERNS: AiKeyPattern[] = [
  { provider: 'Anthropic', label: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { provider: 'OpenAI', label: 'OpenAI API key', pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { provider: 'Google', label: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { provider: 'Groq', label: 'Groq API key', pattern: /gsk_[A-Za-z0-9]{20,}/ },
  { provider: 'Cohere', label: 'Cohere API key', pattern: /co-[A-Za-z0-9]{32,}/ },
];
