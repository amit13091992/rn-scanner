import { analyzeLegacyApiUsage } from '../analyzers/legacyApiUsage.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

export interface LegacyApisOptions {
  json?: boolean;
  cwd?: string;
}

export async function legacyApisCommand(options: LegacyApisOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const result = analyzeLegacyApiUsage(cwd);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader('Legacy / Deprecated API Usage');
    printInfo(`Scanned ${result.filesScanned} source file(s)`);

    if (result.occurrences.length === 0) {
      printSuccess('No known legacy React Native API usage detected');
      return;
    }

    result.occurrences.forEach((occ) => {
      printSection(`${occ.symbol} (from "${occ.fromPackage}")`);
      printWarning(occ.reason);
      console.log(`  Replacement: ${occ.replacement}`);
      if (occ.removedInVersion) {
        console.log(`  Removed in: react-native@${occ.removedInVersion}`);
      }
      console.log(`  Found in ${occ.files.length} file(s):`);
      occ.files.forEach((f) => console.log(`    • ${f}`));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
