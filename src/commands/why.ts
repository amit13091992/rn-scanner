import { buildDependencyGraph, findPathsGroupedByVersion } from '../utils/dependencyGraph.js';
import { printHeader, printSection, printError, printWarning, printInfo } from '../utils/terminal.js';

export interface WhyOptions {
  json?: boolean;
  cwd?: string;
}

export async function whyCommand(packageName: string, options: WhyOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'No project or lockfile found' }, null, 2));
      } else {
        printError('No project or lockfile found');
      }
      process.exit(1);
    }

    const occurrences = findPathsGroupedByVersion(graph, packageName);

    if (occurrences.length === 0) {
      if (jsonMode) {
        console.log(JSON.stringify({ package: packageName, occurrences: [] }, null, 2));
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
      console.log(JSON.stringify({ package: packageName, occurrences }, null, 2));
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
      console.log(JSON.stringify({ error: `Error: ${message}` }, null, 2));
    } else {
      printError(`Error: ${message}`);
    }
    process.exit(1);
  }
}
