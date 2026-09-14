import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import type { Verdict } from '../types/verdict.js';

/** Marker embedded in every posted comment so a re-run updates it instead of duplicating it. */
export const PR_COMMENT_MARKER = '<!-- rn-dep-scanner:verdict -->';

const VERDICT_BADGE: Record<Verdict, string> = {
  READY: '✅ READY',
  WARN: '🟠 WARN',
  BLOCKED: '🔴 BLOCKED',
};

export interface DoctorCommentInput {
  kind: 'doctor';
  reactNativeVersion?: string;
  verdict: Verdict;
  nodeEnvironment: EnvironmentRequirement[];
  androidEnvironment: EnvironmentRequirement[];
  iosEnvironment: EnvironmentRequirement[];
}

export interface UpgradeCommentInput {
  kind: 'upgrade';
  from?: string;
  to: string;
  verdict: Verdict;
  nodeEnvironment: EnvironmentRequirement[];
  androidEnvironment: EnvironmentRequirement[];
  iosEnvironment: EnvironmentRequirement[];
}

export type VerdictCommentInput = DoctorCommentInput | UpgradeCommentInput;

function renderSection(title: string, requirements: EnvironmentRequirement[]): string | undefined {
  if (requirements.length === 0) return undefined;

  const issues = requirements.filter((r) => r.status === 'error' || r.status === 'warning');
  if (issues.length === 0) {
    return `**${title}**: ✅ all checks passed`;
  }

  const lines = issues.map((r) => {
    const icon = r.status === 'error' ? '🔴' : '🟠';
    const current = r.current ?? 'not detected';
    const target = r.required ?? r.recommended;
    const targetLabel = target ? ` (required: ${target})` : '';
    const reason = r.reason ? `\n  ${r.reason}` : '';
    return `- ${icon} **${r.name}**: ${current}${targetLabel}${reason}`;
  });

  return `**${title}**:\n${lines.join('\n')}`;
}

/**
 * Renders a normalized doctor/upgrade result into a markdown PR comment body, prefixed with
 * PR_COMMENT_MARKER so the posting script can find and update a prior comment instead of
 * leaving a new one on every run.
 */
export function formatVerdictComment(input: VerdictCommentInput): string {
  const heading =
    input.kind === 'doctor'
      ? `React Native Environment Preflight${input.reactNativeVersion ? ` (RN ${input.reactNativeVersion})` : ''}`
      : `Upgrade Readiness: ${input.from ?? 'unknown'} → ${input.to}`;

  const sections = [
    renderSection('Node.js', input.nodeEnvironment),
    renderSection('Android', input.androidEnvironment),
    renderSection('iOS', input.iosEnvironment),
  ].filter((section): section is string => section !== undefined);

  const body = sections.length > 0 ? sections.join('\n\n') : 'No environment requirements were checked.';

  return [
    PR_COMMENT_MARKER,
    `### ${heading}`,
    '',
    `**Verdict:** ${VERDICT_BADGE[input.verdict]}`,
    '',
    body,
    '',
    '<sub>Posted by [rn-dep-scanner](https://www.npmjs.com/package/rn-dep-scanner) — re-run to refresh this comment.</sub>',
  ].join('\n');
}
