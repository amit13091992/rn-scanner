import type { HealthScoreResult } from './healthScore.js';
import type { CompatibilityCheckResult } from '../types/dependency.js';
import type { DeprecatedPackage } from '../data/deprecatedPackages.js';
import type { SecurityAnalysisResult } from '../analyzers/securityVulnerabilities.js';
import type { NewArchCheckResult } from '../types/newArchitecture.js';

export interface ReportData {
  projectName?: string;
  reactNativeVersion?: string;
  reactVersion?: string;
  healthScore: HealthScoreResult;
  compatibilityIssues: CompatibilityCheckResult[];
  deprecatedPackages: Array<{ name: string; info: DeprecatedPackage }>;
  newArchitectureIssues: NewArchCheckResult[];
  security: SecurityAnalysisResult;
}

const SEVERITY_ICON: Record<string, string> = { critical: '🔴', high: '🟠', moderate: '🟡', low: 'ℹ️', unknown: 'ℹ️' };

/**
 * Renders a scan result as a Markdown report — a condensed, decision-focused view (health
 * score, compatibility errors/warnings, deprecated packages, New Architecture issues, security
 * findings) rather than a 1:1 mirror of `check --json`'s full shape, matching what a human
 * reader of a PR/status report actually needs. Shared by both Markdown and HTML output (HTML
 * wraps this same content, so the two formats never drift out of sync with each other).
 */
export function formatReportMarkdown(data: ReportData): string {
  const lines: string[] = [];
  lines.push(`# Dependency Report${data.projectName ? `: ${data.projectName}` : ''}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (data.reactNativeVersion) lines.push(`React Native: ${data.reactNativeVersion}`);
  if (data.reactVersion) lines.push(`React: ${data.reactVersion}`);
  lines.push('');

  lines.push(`## Health Score: ${data.healthScore.score}/100`);
  if (data.healthScore.lowCoverage) {
    lines.push(`_Low coverage: only ${data.healthScore.analyzed} dependency/dependencies had compatibility data to analyze._`);
  }
  lines.push('');

  const errors = data.compatibilityIssues.filter((i) => i.status === 'error');
  const warnings = data.compatibilityIssues.filter((i) => i.status === 'warning');

  lines.push('## Compatibility');
  if (errors.length === 0 && warnings.length === 0) {
    lines.push('✅ No compatibility errors or warnings.');
  } else {
    if (errors.length > 0) {
      lines.push(`### 🔴 Errors (${errors.length})`);
      errors.forEach((i) => lines.push(`- **${i.package}@${i.version}**: ${i.messages.join('; ')}`));
    }
    if (warnings.length > 0) {
      lines.push(`### 🟠 Warnings (${warnings.length})`);
      warnings.forEach((i) => lines.push(`- **${i.package}@${i.version}**: ${i.messages.join('; ')}`));
    }
  }
  lines.push('');

  lines.push(`## Deprecated Packages (${data.deprecatedPackages.length})`);
  if (data.deprecatedPackages.length === 0) {
    lines.push('✅ None detected.');
  } else {
    data.deprecatedPackages.forEach((d) => {
      lines.push(`- **${d.name}**: ${d.info.reason}${d.info.replacement ? ` — use \`${d.info.replacement}\` instead` : ''}`);
    });
  }
  lines.push('');

  lines.push(`## New Architecture Issues (${data.newArchitectureIssues.length})`);
  if (data.newArchitectureIssues.length === 0) {
    lines.push('✅ None detected.');
  } else {
    data.newArchitectureIssues.forEach((i) => {
      lines.push(`- **${i.package}@${i.version}** (${i.support}): ${i.notes ?? 'no additional detail'}`);
    });
  }
  lines.push('');

  lines.push('## Security');
  if (!data.security.scanned) {
    lines.push(`⚠️ Could not run security scan: ${data.security.error ?? 'unknown error'}`);
  } else if (data.security.results.length === 0) {
    lines.push('✅ No known vulnerabilities found (via OSV.dev, including transitive dependencies).');
  } else {
    data.security.results.forEach((r) => {
      r.vulnerabilities.forEach((v) => {
        lines.push(`- ${SEVERITY_ICON[v.severity] ?? ''} **${r.package}@${r.version}**${r.direct ? '' : ' (transitive)'}: ${v.id} (${v.severity}) — ${v.summary}`);
      });
    });
  }

  return lines.join('\n');
}

/** Wraps the same Markdown content in a minimal, dependency-free HTML shell — no CSS
 *  framework, no build step, just enough structure to render legibly in a browser. */
export function formatReportHtml(data: ReportData): string {
  const markdown = formatReportMarkdown(data);
  const escaped = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Dependency Report${data.projectName ? `: ${data.projectName}` : ''}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>
</body>
</html>
`;
}
