import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzeWhyNot } from '../analyzers/whyNot.js';
import { printHeader, printSection, printSuccess, printError, printInfo } from '../utils/terminal.js';

import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface WhyNotOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

export async function whyNotCommand(packageName: string, targetVersion: string, options: WhyNotOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const result = analyzeWhyNot(cwd, dependencies, packageName, targetVersion);

    if (jsonMode) {
      emitStructuredOutput(result, 'Why Not Report', options);
      return;
    }

    printHeader(`Why not ${packageName}@${targetVersion}?`);

    if (result.constraints.length === 0) {
      printInfo(`No other installed package declares a dependency or peer dependency on "${packageName}" — nothing found blocking it, but this doesn't confirm no other issue exists (e.g. registry-level conflicts).`);
      return;
    }

    if (result.installable) {
      printSuccess(`No conflicting constraints found — ${packageName}@${targetVersion} should be installable.`);
    } else {
      printSection('Blocked by');
      result.blockers.forEach((b) => {
        console.log(`  • ${b.requiredBy} requires ${packageName}@${b.range}${b.kind === 'peerDependency' ? ' (peer dependency)' : ''}`);
      });
    }

    const unknown = result.constraints.filter((c) => c.satisfied === null);
    if (unknown.length > 0) {
      printSection('Could not evaluate');
      unknown.forEach((c) => {
        console.log(`  • ${c.requiredBy} declares ${packageName}@${c.range} — not a resolvable semver range, verify manually`);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Why Not Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
