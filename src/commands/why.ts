import { buildDependencyGraph, findPathsGroupedByVersion } from '../utils/dependencyGraph.js';
import { printHeader, printSection, printError, printWarning, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { listWorkspaceTargets, runCapturingExit } from '../utils/workspaceRun.js';

export interface WhyOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Trace this package across every workspace package in the monorepo, not just `cwd`. */
  allWorkspaces?: boolean;
}

async function runAcrossWorkspaces(packageName: string, cwd: string, options: WhyOptions): Promise<void> {
  const jsonMode = !!options.json || !!options.html;
  const targets = listWorkspaceTargets(cwd);

  if (targets.length === 0) {
    return whyCommand(packageName, { ...options, allWorkspaces: false });
  }

  if (!jsonMode) {
    printHeader(`Why is "${packageName}" installed? (all workspaces)`);
  }

  let anyExit = false;
  const perPackageResults: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (!jsonMode) {
      printSection(`Workspace package: ${target.name}`);
    }
    const { output, exitCode } = await runCapturingExit(() =>
      whyCommand(packageName, { ...options, cwd: target.dir, allWorkspaces: false, json: jsonMode, html: false })
    );
    if (exitCode) anyExit = true;

    if (jsonMode) {
      try {
        perPackageResults.push({ ...JSON.parse(output), package: target.name, dir: target.dir });
      } catch {
        perPackageResults.push({ package: target.name, dir: target.dir, error: 'Could not parse result' });
      }
    } else {
      console.log(output.replace(/\n$/, ''));
    }
  }

  if (jsonMode) {
    emitStructuredOutput({ package: packageName, workspaces: perPackageResults }, 'Why (all workspaces)', options);
  }

  if (anyExit) {
    process.exit(1);
  }
}

export async function whyCommand(packageName: string, options: WhyOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  if (options.allWorkspaces) {
    return runAcrossWorkspaces(packageName, cwd, options);
  }

  // Set inside the try block and read after it closes, so a non-zero exit is decided outside
  // the try/catch — calling `process.exit` from within `try` would otherwise be caught by this
  // function's own `catch` (a real concern in tests and in `runAcrossWorkspaces` above, where
  // `process.exit` is stubbed to throw) and misreported as a fatal error alongside the
  // already-printed result, doubling the output. Same pattern as `commands/check.ts`.
  let shouldExit = false;

  try {
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      if (jsonMode) {
        emitStructuredOutput({ error: 'No project or lockfile found' }, 'Why', options);
      } else {
        printError('No project or lockfile found');
      }
      shouldExit = true;
    } else {
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
      } else if (jsonMode) {
        emitStructuredOutput({ package: packageName, occurrences }, 'Why', options);
      } else {
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
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Error: ${message}` }, 'Why', options);
    } else {
      printError(`Error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (shouldExit) {
    process.exit(1);
  }
}
