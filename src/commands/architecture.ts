import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzeNewArchitecture } from '../analyzers/newArchitecture.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface ArchitectureOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

/**
 * Standalone New Architecture (Fabric/TurboModules) compatibility report — the same
 * `analyzeNewArchitecture` data `check` already surfaces, exposed on its own for a user who
 * only wants this slice (e.g. before starting a New Architecture migration) without running
 * the full dependency-compatibility scan.
 */
export async function architectureCommand(options: ArchitectureOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const rnInfo = await detectReactNativeVersions(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const result = analyzeNewArchitecture(dependencies, rnInfo.version);

    if (jsonMode) {
      emitStructuredOutput(result, 'New Architecture Report', options);
      return;
    }

    printHeader('New Architecture (Fabric/TurboModules)');

    if (!rnInfo.version) {
      printWarning('React Native version not detected — cannot determine New Architecture status');
      return;
    }

    if (result.status.isBridgeRemoved) {
      printInfo(`React Native ${rnInfo.version} has removed the legacy bridge — New Architecture is mandatory`);
    } else if (result.status.isNewArchDefault) {
      printInfo(`React Native ${rnInfo.version} defaults to the New Architecture`);
    } else {
      printInfo(`React Native ${rnInfo.version} does not default to the New Architecture`);
    }

    const issues = result.results.filter((r) => r.support === 'unsupported' || r.support === 'partial');
    const dataUnavailable = result.results.filter((r) => r.support === 'data_unavailable');

    if (issues.length === 0) {
      printSuccess('No known New Architecture incompatibilities in checked dependencies');
    } else {
      issues.forEach((issue) => {
        if (issue.support === 'unsupported') {
          printError(`${issue.package}@${issue.version} does not support the New Architecture`);
        } else {
          printWarning(`${issue.package}@${issue.version} has partial New Architecture support`);
        }
        if (issue.notes) console.log(`  └─ ${issue.notes}`);
      });
    }

    if (dataUnavailable.length > 0) {
      printInfo(`${dataUnavailable.length} package(s) have no New Architecture compatibility data available — not a compatibility issue, just unverified (verify manually before upgrading)`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'New Architecture Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
