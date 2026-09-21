import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { loadConfig } from '../utils/config.js';
import { evaluatePolicy } from '../analyzers/policy.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface PolicyOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

export async function policyCommand(options: PolicyOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let violationCount = 0;

  try {
    const { config, warnings } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);
    const result = await evaluatePolicy(cwd, dependencies, config, graph);
    violationCount = result.violations.length;

    if (jsonMode) {
      emitStructuredOutput({ ...result, configWarnings: warnings }, 'Policy Report', options);
    } else {
      printHeader('Policy');
      warnings.forEach((w) => printWarning(w));

      if (result.rulesConfigured === 0) {
        printInfo('No policy rules configured — add "bannedPackages", "licenseDenylist", or "maxVulnerabilitySeverity" to .rn-dep-scanner.json to enable checks.');
      } else if (result.passed) {
        printSuccess(`No policy violations (${result.rulesConfigured} rule(s) checked)`);
      } else {
        result.violations.forEach((v) => printError(`[${v.rule}] ${v.message}`));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Policy Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (violationCount > 0) {
    process.exit(1);
  }
}
