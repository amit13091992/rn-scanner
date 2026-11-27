import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import type { Verdict } from '../types/verdict.js';
import type { BundleDiffResult, ModuleDelta } from '../types/bundleSize.js';

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

const VERDICT_SEVERITY: Record<Verdict, number> = { READY: 0, WARN: 1, BLOCKED: 2 };

/** The worst (most severe) of a set of verdicts — READY < WARN < BLOCKED. Used to roll up a
 *  `--all-workspaces` run's per-package verdicts into a single overall one for the PR comment. */
export function worstVerdict(verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>(
    (worst, v) => (VERDICT_SEVERITY[v] > VERDICT_SEVERITY[worst] ? v : worst),
    'READY'
  );
}

export interface WorkspacePackageVerdict {
  package: string;
  verdict: Verdict;
  reactNativeVersion?: string;
  nodeEnvironment: EnvironmentRequirement[];
  androidEnvironment: EnvironmentRequirement[];
  iosEnvironment: EnvironmentRequirement[];
}

export interface AggregatedVerdictCommentInput {
  kind: 'doctor' | 'upgrade';
  /** Upgrade target version, for the heading — ignored for kind: 'doctor'. */
  to?: string;
  packages: WorkspacePackageVerdict[];
}

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

/**
 * Same contract as `formatVerdictComment`, for a `--all-workspaces` run: one PR comment
 * (same `PR_COMMENT_MARKER`, so it still updates in place) covering every workspace package,
 * with an overall verdict rolled up via `worstVerdict` plus a collapsible section per package
 * (left expanded when that package isn't READY, so the thing that needs attention is visible
 * without an extra click).
 */
export function formatAggregatedVerdictComment(input: AggregatedVerdictCommentInput): string {
  const overall = worstVerdict(input.packages.map((p) => p.verdict));
  const heading =
    input.kind === 'doctor'
      ? 'React Native Environment Preflight (all workspaces)'
      : `Upgrade Readiness (all workspaces) → ${input.to ?? 'unknown'}`;

  const packageSections = input.packages.map((p) => {
    const sections = [
      renderSection('Node.js', p.nodeEnvironment),
      renderSection('Android', p.androidEnvironment),
      renderSection('iOS', p.iosEnvironment),
    ].filter((section): section is string => section !== undefined);
    const body = sections.length > 0 ? sections.join('\n\n') : 'No environment requirements were checked.';

    return [
      `<details${p.verdict !== 'READY' ? ' open' : ''}>`,
      `<summary>${VERDICT_BADGE[p.verdict]} <strong>${p.package}</strong>${p.reactNativeVersion ? ` (RN ${p.reactNativeVersion})` : ''}</summary>`,
      '',
      body,
      '',
      '</details>',
    ].join('\n');
  });

  return [
    PR_COMMENT_MARKER,
    `### ${heading}`,
    '',
    `**Overall verdict:** ${VERDICT_BADGE[overall]} (worst of ${input.packages.length} workspace package(s))`,
    '',
    ...packageSections,
    '',
    '<sub>Posted by [rn-dep-scanner](https://www.npmjs.com/package/rn-dep-scanner) — re-run to refresh this comment.</sub>',
  ].join('\n');
}

/** Distinct from `PR_COMMENT_MARKER` so the size comment and the verdict comment never overwrite each other. */
export const SIZE_COMMENT_MARKER = '<!-- rn-dep-scanner:size -->';

const SIZE_TABLE_ROWS = 10;

function kib(bytes: number): string {
  return `${(Math.abs(bytes) / 1024).toFixed(1)} KiB`;
}

function signedKib(bytes: number): string {
  return `${bytes >= 0 ? '+' : '-'}${kib(bytes)}`;
}

function moduleRows(label: string, modules: readonly ModuleDelta[]): string[] {
  return modules.slice(0, SIZE_TABLE_ROWS).map((m) => `| ${label} | \`${m.id}\` | ${signedKib(m.delta)} |`);
}

/** Renders a `size diff --json` result as the PR comment body. */
export function formatSizeComment(result: BundleDiffResult): string {
  const lines = [SIZE_COMMENT_MARKER, '## Bundle size', ''];

  if (result.status === 'not-comparable') {
    lines.push(`⚪ **Not comparable** — ${result.reason ?? 'unknown reason'}.`, '', 'The base was built with a different toolchain or schema, so no size comparison was made. Re-measure the base on the current toolchain.');
    return lines.join('\n');
  }

  lines.push(result.status === 'over-budget' ? '🔴 **Over budget**' : '✅ **Within budget**', '');

  if (result.totals) {
    const { js, hbc } = result.totals;
    lines.push('| | Base | Head | Change |', '|---|---|---|---|');
    lines.push(`| JS bundle | ${kib(js.base)} | ${kib(js.head)} | ${signedKib(js.delta)} |`);
    lines.push(hbc ? `| Hermes bytecode | ${kib(hbc.base)} | ${kib(hbc.head)} | ${signedKib(hbc.delta)} |` : '| Hermes bytecode | — | — | not measured on both sides |');
    lines.push('');
  }

  if (result.violations.length > 0) {
    lines.push('**Budget violations**');
    for (const v of result.violations) {
      lines.push(`- 🔴 ${v.kind}${v.module ? ` \`${v.module}\`` : ''}: ${v.actualKb.toFixed(1)} KiB (limit ${v.limitKb} KiB)`);
    }
    lines.push('');
  }

  const rows = [...moduleRows('added', result.added), ...moduleRows('grown', result.grown), ...moduleRows('removed', result.removed), ...moduleRows('shrunk', result.shrunk)];
  if (rows.length > 0) {
    lines.push('| Change | Module | Size |', '|---|---|---|', ...rows, '');
  }

  for (const w of result.warnings) lines.push(`- ⚠️ ${w}`);
  for (const n of result.notChecked) lines.push(`- ⚪ Not checked: ${n}`);

  return lines.join('\n');
}
