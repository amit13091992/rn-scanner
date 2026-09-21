import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { analyzeLicenses } from '../analyzers/licenses.js';
import { loadConfig } from '../utils/config.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

export interface LicensesOptions {
  json?: boolean;
  cwd?: string;
}

export async function licensesCommand(options: LicensesOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;
  // Read after the try/catch (see securityCommand for the same pattern and rationale) so a
  // stubbed `process.exit` in tests isn't caught by this function's own `catch` and
  // misreported as a fatal error after the real result has already been printed.
  let deniedFound = false;

  try {
    const { config } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);
    const result = analyzeLicenses(cwd, dependencies, config.licenseDenylist ?? [], graph);
    deniedFound = result.denied.length > 0;

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHeader('Licenses');
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
      } else if ((config.licenseDenylist ?? []).length > 0) {
        printSuccess('No dependencies match the configured license denylist');
      }

      if (result.unknown.length > 0) {
        printInfo(`${result.unknown.length} package(s) had no readable license: ${result.unknown.map((u) => u.name).join(', ')}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
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
