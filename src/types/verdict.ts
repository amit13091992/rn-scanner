/**
 * Overall preflight verdict for an environment/upgrade check: READY (no blocking issues),
 * WARN (non-blocking issues worth reviewing), or BLOCKED (at least one hard incompatibility).
 */
export type Verdict = 'READY' | 'WARN' | 'BLOCKED';
