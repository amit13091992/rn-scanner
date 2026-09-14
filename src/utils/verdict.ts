import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import type { Verdict } from '../types/verdict.js';

/**
 * Rolls up a set of EnvironmentRequirement statuses into a single READY/WARN/BLOCKED verdict:
 * any 'error' blocks, any 'warning' (with no errors) warns, otherwise it's ready.
 */
export function verdictFromRequirements(requirements: EnvironmentRequirement[]): Verdict {
  if (requirements.some((r) => r.status === 'error')) return 'BLOCKED';
  if (requirements.some((r) => r.status === 'warning')) return 'WARN';
  return 'READY';
}

/** Combines multiple verdicts into one, taking the most severe (BLOCKED > WARN > READY). */
export function combineVerdicts(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('BLOCKED')) return 'BLOCKED';
  if (verdicts.includes('WARN')) return 'WARN';
  return 'READY';
}
