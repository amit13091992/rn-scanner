import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { loadConfig } from '../utils/config.js';
import { evaluatePolicy, type PolicyResult } from '../analyzers/policy.js';
import { listWorkspaceTargets } from '../utils/workspaceRun.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface PolicyOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Evaluate the policy against every workspace package in the monorepo, not just `cwd`. */
  allWorkspaces?: boolean;
  /** Write a starter `.rn-preflight.json` (refuses to overwrite an existing one) and exit. */
  init?: boolean;
}

const STARTER_POLICY = {
  bannedPackages: [],
  licenseDenylist: ['GPL-3.0', 'AGPL-3.0'],
  maxVulnerabilitySeverity: 'high',
};

function initPolicy(cwd: string, jsonMode: boolean, options: PolicyOptions): void {
  const target = join(cwd, '.rn-preflight.json');
  const legacy = join(cwd, '.rn-dep-scanner.json');
  if (existsSync(target) || existsSync(legacy)) {
    const existing = existsSync(target) ? target : legacy;
    const message = `${existing} already exists — add "bannedPackages", "licenseDenylist" or "maxVulnerabilitySeverity" to it by hand; not overwriting.`;
    if (jsonMode) emitStructuredOutput({ created: false, path: existing, error: message }, 'Policy Init', options);
    else printWarning(message);
    return;
  }
  writeFileSync(target, `${JSON.stringify(STARTER_POLICY, null, 2)}\n`, 'utf-8');
  if (jsonMode) {
    emitStructuredOutput({ created: true, path: target, policy: STARTER_POLICY }, 'Policy Init', options);
  } else {
    printSuccess(`Created ${target}`);
    printInfo('Starter rules: block GPL-3.0/AGPL-3.0 licenses and any vulnerability at "high" or above. Add package names to "bannedPackages" to forbid them, then run `npx rn-preflight policy`.');
  }
}

async function evaluateOneProject(cwd: string): Promise<{ result: PolicyResult; warnings: string[] }> {
  const { config, warnings } = loadConfig(cwd);
  const packageJson = await readPackageJson(cwd);
  const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
  const graph = await buildDependencyGraph(cwd);
  const result = await evaluatePolicy(cwd, dependencies, config, graph);
  return { result, warnings };
}

function printPolicyResult(result: PolicyResult, warnings: string[]): void {
  warnings.forEach((w) => printWarning(w));
  if (result.rulesConfigured === 0) {
    printInfo('No policy rules configured. Run `npx rn-preflight policy --init` to create a starter .rn-preflight.json, or add "bannedPackages", "licenseDenylist" or "maxVulnerabilitySeverity" by hand.');
  } else if (result.passed) {
    printSuccess(`No policy violations (${result.rulesConfigured} rule(s) checked)`);
  } else {
    result.violations.forEach((v) => printError(`[${v.rule}] ${v.message}`));
  }
}

export async function policyCommand(options: PolicyOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let violationCount = 0;

  if (options.init) {
    initPolicy(cwd, jsonMode, options);
    return;
  }

  try {
    if (options.allWorkspaces) {
      const targets = listWorkspaceTargets(cwd);

      if (targets.length === 0) {
        const { result, warnings } = await evaluateOneProject(cwd);
        violationCount = result.violations.length;
        if (jsonMode) {
          emitStructuredOutput({ ...result, configWarnings: warnings }, 'Policy Report', options);
        } else {
          printHeader('Policy');
          printPolicyResult(result, warnings);
        }
      } else {
        const perPackage = await Promise.all(
          targets.map(async (target) => {
            const { result, warnings } = await evaluateOneProject(target.dir);
            return { package: target.name, dir: target.dir, ...result, configWarnings: warnings };
          })
        );
        violationCount = perPackage.reduce((sum, pkg) => sum + pkg.violations.length, 0);

        if (jsonMode) {
          emitStructuredOutput({ workspaces: perPackage, violationCount }, 'Policy Report (all workspaces)', options);
        } else {
          printHeader('Policy (all workspaces)');
          perPackage.forEach((pkg) => {
            printSection(`Workspace package: ${pkg.package}`);
            printPolicyResult(pkg, pkg.configWarnings);
          });
        }
      }
    } else {
      const { result, warnings } = await evaluateOneProject(cwd);
      violationCount = result.violations.length;

      if (jsonMode) {
        emitStructuredOutput({ ...result, configWarnings: warnings }, 'Policy Report', options);
      } else {
        printHeader('Policy');
        printPolicyResult(result, warnings);
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
