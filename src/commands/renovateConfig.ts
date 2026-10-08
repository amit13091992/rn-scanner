import { writeFileSync } from 'node:fs';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { loadConfig } from '../utils/config.js';
import { buildRenovateConfig } from '../analyzers/renovateConfig.js';
import { printHeader, printSuccess, printInfo, printError } from '../utils/terminal.js';

export interface RenovateConfigOptions {
  cwd?: string;
  /** File path to write the generated config to (e.g. "renovate.json"). Prints to stdout
   *  instead when omitted. */
  out?: string;
}

/**
 * Generates a starter Renovate config tailored to this project (see
 * `analyzers/renovateConfig.ts` for the grouping rationale) rather than a generic
 * `config:recommended` with no React-Native-specific awareness.
 */
export async function renovateConfigCommand(options: RenovateConfigOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();

  try {
    const { config: projectConfig } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const rnInfo = detectReactNativeVersions(cwd);

    const { config, nativeModuleCount, reviewFlagged } = buildRenovateConfig(
      dependencies,
      rnInfo.version,
      projectConfig.ignorePackages ?? []
    );

    const json = `${JSON.stringify(config, null, 2)}\n`;

    if (options.out) {
      writeFileSync(options.out, json);
      printHeader('Renovate Config');
      printSuccess(`Wrote ${options.out}`);
      printInfo(`${nativeModuleCount} native module(s) grouped into a separate, more cautious update group`);
      if (reviewFlagged.length > 0) {
        printInfo(`${reviewFlagged.length} package(s) flagged for New Architecture review: ${reviewFlagged.join(', ')}`);
      }
    } else {
      console.log(json);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    printError(`Fatal error: ${message}`);
    process.exit(1);
  }
}
