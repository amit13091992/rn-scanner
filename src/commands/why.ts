import { basename } from 'node:path';
import { buildDependencyGraph, describePackageOccurrences, suggestPackageNames } from '../utils/dependencyGraph.js';
import { readPackageJson } from '../utils/packageJson.js';
import { printHeader, printSection, printError, printWarning, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { listWorkspaceTargets, runCapturingExit } from '../utils/workspaceRun.js';

const MAX_PATHS_SHOWN = 10;

interface Manifest {
  name?: string;
  requested(pkg: string): { range: string; field: string } | undefined;
}

function readManifest(cwd: string): Manifest {
  try {
    const pkg = readPackageJson(cwd);
    const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
    return {
      name: pkg.name,
      requested: (name) => {
        for (const field of fields) {
          const range = pkg[field]?.[name];
          if (range) return { range, field };
        }
        return undefined;
      },
    };
  } catch {
    return { requested: () => undefined };
  }
}

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
      const detail = describePackageOccurrences(graph, packageName);
      const manifest = readManifest(cwd);
      const projectName = manifest.name || basename(cwd);
      const requested = manifest.requested(packageName);
      const occurrences = detail.map((occ) => ({
        version: occ.version,
        direct: occ.direct,
        scope: occ.scope,
        optional: occ.optional,
        workspace: occ.workspace,
        ...(occ.direct && requested ? { requested: requested.range, declaredIn: requested.field } : {}),
        dependents: occ.dependents,
        pathCount: occ.paths.length,
        paths: occ.paths,
      }));

      if (occurrences.length === 0) {
        const suggestions = suggestPackageNames(graph, packageName);
        const declared = manifest.requested(packageName);
        if (jsonMode) {
          emitStructuredOutput(
            { package: packageName, project: projectName, occurrences: [], suggestions, declaredButNotInstalled: !!declared },
            'Why',
            options
          );
        } else {
          if (!graph.hierarchyComplete) {
            printWarning(
              `Dependency hierarchy for "${graph.manager}" is direct-only (not fully resolved); results may be incomplete.`
            );
          }
          printInfo(`"${packageName}" was not found in the dependency graph.`);
          if (declared) {
            printWarning(
              `It is declared in package.json (${declared.field}: ${declared.range}) but missing from the ${graph.manager} lockfile/install — run your package manager's install.`
            );
          }
          if (suggestions.length > 0) {
            console.log(`  Did you mean: ${suggestions.join(', ')}?`);
          }
        }
      } else if (jsonMode) {
        emitStructuredOutput(
          {
            package: packageName,
            project: projectName,
            summary: {
              versions: occurrences.length,
              direct: occurrences.some((o) => o.direct),
              totalPaths: occurrences.reduce((sum, o) => sum + o.pathCount, 0),
              duplicated: occurrences.length > 1,
            },
            occurrences,
          },
          'Why',
          options
        );
      } else {
        printHeader(`Why is "${packageName}" installed?`);

        if (!graph.hierarchyComplete) {
          printWarning(
            `Dependency hierarchy for "${graph.manager}" is direct-only (not fully resolved); results may be incomplete.`
          );
        }

        occurrences.forEach((occ) => {
          printSection(`${packageName}@${occ.version}`);
          const facts: string[] = [];
          if (occ.workspace) facts.push('workspace package');
          facts.push(
            occ.direct
              ? `direct dependency${occ.requested ? ` (${occ.declaredIn}: ${occ.requested})` : ''}`
              : 'transitive dependency'
          );
          if (occ.scope === 'development') facts.push('development only');
          else if (occ.scope === 'production') facts.push('production');
          if (occ.optional) facts.push('optional');
          console.log(`  ${facts.join(' · ')}`);
          if (occ.dependents.length > 0) {
            console.log(`  Required by: ${occ.dependents.join(', ')}`);
          }
          const shown = occ.paths.slice(0, MAX_PATHS_SHOWN);
          shown.forEach((path, idx) => {
            const isLast = idx === shown.length - 1 && occ.paths.length <= MAX_PATHS_SHOWN;
            console.log(`  ${isLast ? '└─' : '├─'} ${[projectName, ...path].join(' → ')}`);
          });
          if (occ.paths.length > MAX_PATHS_SHOWN) {
            console.log(`  └─ … and ${occ.paths.length - MAX_PATHS_SHOWN} more path(s) (use --json for all)`);
          }
        });

        if (occurrences.length > 1) {
          printWarning(
            `${occurrences.length} versions of "${packageName}" are installed — run \`rn-preflight tree --duplicates\` to see where they diverge.`
          );
        }
        console.log(
          `\n  Next: \`why-not ${packageName} <version>\` to see what blocks an upgrade, or \`impact ${packageName} <version>\` for the blast radius.`
        );
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
