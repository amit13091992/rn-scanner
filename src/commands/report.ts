import { writeFileSync } from 'node:fs';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeAllDependencies } from '../analyzers/compatibility.js';
import { analyzeNewArchitecture } from '../analyzers/newArchitecture.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { checkDeprecatedPackages } from '../data/deprecatedPackages.js';
import { computeHealthScore } from '../utils/healthScore.js';
import { loadConfig } from '../utils/config.js';
import { formatReportMarkdown, formatReportHtml, type ReportData } from '../utils/reportFormat.js';
import { printSuccess, printError } from '../utils/terminal.js';

export interface ReportOptions {
  cwd?: string;
  format?: 'md' | 'html';
  out?: string;
}

/**
 * Renders a condensed dependency-health report (health score, compatibility issues,
 * deprecated packages, New Architecture issues, security findings) as Markdown or HTML.
 * Reuses the same analyzers `check`/`security` already call directly (same convention as the
 * other standalone commands, e.g. `commands/security.ts`) rather than wrapping `checkCommand`
 * itself, since `checkCommand` prints as it goes rather than returning a reusable result.
 */
export async function reportCommand(options: ReportOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const format = options.format ?? 'md';

  try {
    const { config } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const rnInfo = detectReactNativeVersions(cwd);
    const compatibilityIssues = analyzeAllDependencies(dependencies, rnInfo.version, rnInfo.react);
    const deprecatedPackages = checkDeprecatedPackages(dependencies.map((d) => d.name));
    const newArch = analyzeNewArchitecture(dependencies, rnInfo.version);
    const graph = await buildDependencyGraph(cwd);
    const security = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);

    const compatible = compatibilityIssues.filter((i) => i.status === 'compatible').length;
    const warnings = compatibilityIssues.filter((i) => i.status === 'warning').length;
    const errors = compatibilityIssues.filter((i) => i.status === 'error').length;
    const notChecked = compatibilityIssues.filter((i) => i.status === 'not-checked').length;
    const healthScore = computeHealthScore({ compatible, warnings, errors, notChecked, total: compatibilityIssues.length });

    const data: ReportData = {
      projectName: packageJson.name,
      reactNativeVersion: rnInfo.version ?? undefined,
      reactVersion: rnInfo.react ?? undefined,
      healthScore,
      compatibilityIssues,
      deprecatedPackages,
      newArchitectureIssues: newArch.results.filter((r) => r.support === 'unsupported' || r.support === 'partial'),
      security,
    };

    const content = format === 'html' ? formatReportHtml(data) : formatReportMarkdown(data);

    if (options.out) {
      writeFileSync(options.out, content);
      printSuccess(`Report written to ${options.out}`);
    } else {
      console.log(content);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    printError(`Fatal error: ${message}`);
    process.exit(1);
  }
}
