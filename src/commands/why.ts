import { buildDependencyGraph, findPathsGroupedByVersion } from '../utils/dependencyGraph.js';
import { printHeader, printSection, printError, printWarning, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface WhyOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

export async function whyCommand(packageName: string, options: WhyOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      if (jsonMode) {
        emitStructuredOutput({ error: 'No project or lockfile found' }, 'Why', options);
      } else {
        printError('No project or lockfile found');
      }
      process.exit(1);
    }

    const occurrences = findPathsGroupedByVersion(graph, packageName);

    if (occurrences.length === 0) {
      if (jsonMode) {
        emitStructuredOutput({ package: packageName, occurrences: [] }, 'Why', options);
      } else {
        if (!graph.hierarchyComplete) {
          printWarning(
            `Dependency hierarchy for "${graph.manager}" is direct-only (not fully resolved); results may be incomplete.`
          );
        }
        printInfo(`"${packageName}" was not found in the dependency graph.`);
      }
      return;
    }

    if (jsonMode) {
      emitStructuredOutput({ package: packageName, occurrences }, 'Why', options);
      return;
    }

    printHeader(`Why is "${packageName}" installed?`);

    if (!graph.hierarchyComplete) {
      printWarning(
        `Dependency hierarchy for "${graph.manager}" is direct-only (not fully resolved); results may be incomplete.`
      );
    }

    occurrences.forEach(occ => {
      printSection(`${packageName}@${occ.version}`);
      occ.paths.forEach((path, idx) => {
        const connector = idx === occ.paths.length - 1 ? '└─' : '├─';
        const line = ['your-app', ...path].join(' → ');
        console.log(`  ${connector} ${line}`);
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Error: ${message}` }, 'Why', options);
    } else {
      printError(`Error: ${message}`);
    }
    process.exit(1);
  }
}
