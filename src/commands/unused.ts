import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzeUnusedDependencies } from '../analyzers/unusedDependencies.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface UnusedOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

export async function unusedCommand(options: UnusedOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    if (!jsonMode) {
      printHeader('Unused Dependencies');
    }

    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const result = analyzeUnusedDependencies(cwd, dependencies);

    if (jsonMode) {
      emitStructuredOutput(result, 'Unused Dependencies', options);
      return;
    }

    printInfo(`Scanned ${result.filesScanned} source file(s)`);

    if (result.unused.length === 0) {
      printSuccess('No unused dependencies detected');
    } else {
      printSection('No import found');
      printWarning('This is a heuristic (regex-based require/import scan) — verify before removing anything, especially packages used only from a config file.');
      result.unused.forEach((dep) => {
        console.log(`  • ${dep.name} (${dep.type})`);
      });
    }

    if (result.excludedAsTooling.length > 0) {
      printInfo(`${result.excludedAsTooling.length} package(s) skipped as known tooling-only (not flagged): ${result.excludedAsTooling.join(', ')}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Unused Dependencies', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
