import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { analyzeLicenses, type LicenseAnalysisResult } from '../analyzers/licenses.js';
import { loadConfig } from '../utils/config.js';
import { listWorkspaceTargets } from '../utils/workspaceRun.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface LicensesOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Run the license report against every workspace package in the monorepo, not just `cwd`. */
  allWorkspaces?: boolean;
}

async function analyzeOneProject(cwd: string): Promise<{ result: LicenseAnalysisResult; denylist: string[] }> {
  const { config } = loadConfig(cwd);
  const packageJson = await readPackageJson(cwd);
  const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
  const graph = await buildDependencyGraph(cwd);
  const denylist = config.licenseDenylist ?? [];
  const result = analyzeLicenses(cwd, dependencies, denylist, graph);
  return { result, denylist };
}

function printLicenseResult(result: LicenseAnalysisResult, denylist: string[]): void {
  printSection('By License');
  Object.entries(result.byLicense)
    .sort(([, a], [, b]) => b.length - a.length)
    .forEach(([license, packages]) => {
      console.log(`\n${license} (${packages.length})`);
      console.log(`  ${packages.join(', ')}`);
    });

  if (result.denied.length > 0) {
    printSection('Denied Licenses');
    result.denied.forEach((d) => printWarning(`${d.name}@${d.version}: ${d.license}`));
  } else if (denylist.length > 0) {
    printSuccess('No dependencies match the configured license denylist');
  }

  if (result.unknown.length > 0) {
    printInfo(`${result.unknown.length} package(s) had no readable license: ${result.unknown.map((u) => u.name).join(', ')}`);
  }
}

export async function licensesCommand(options: LicensesOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  // Read after the try/catch (see securityCommand for the same pattern and rationale) so a
  // stubbed `process.exit` in tests isn't caught by this function's own `catch` and
  // misreported as a fatal error after the real result has already been printed.
  let deniedFound = false;

  try {
    if (options.allWorkspaces) {
      const targets = listWorkspaceTargets(cwd);

      if (targets.length === 0) {
        const { result, denylist } = await analyzeOneProject(cwd);
        deniedFound = result.denied.length > 0;
        if (jsonMode) {
          emitStructuredOutput(result, 'License Report', options);
        } else {
          printHeader('Licenses');
          printLicenseResult(result, denylist);
        }
      } else {
        const perPackage = await Promise.all(
          targets.map(async (target) => {
            const { result, denylist } = await analyzeOneProject(target.dir);
            return { package: target.name, dir: target.dir, ...result, denylist };
          })
        );
        deniedFound = perPackage.some((pkg) => pkg.denied.length > 0);

        if (jsonMode) {
          emitStructuredOutput({ workspaces: perPackage }, 'License Report (all workspaces)', options);
        } else {
          printHeader('Licenses (all workspaces)');
          perPackage.forEach((pkg) => {
            printSection(`Workspace package: ${pkg.package}`);
            printLicenseResult(pkg, pkg.denylist);
          });
        }
      }
    } else {
      const { result, denylist } = await analyzeOneProject(cwd);
      deniedFound = result.denied.length > 0;

      if (jsonMode) {
        emitStructuredOutput(result, 'License Report', options);
      } else {
        printHeader('Licenses');
        printLicenseResult(result, denylist);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'License Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (deniedFound) {
    process.exit(1);
  }
}
