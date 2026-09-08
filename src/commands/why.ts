import { buildDependencyGraph, findPathsToPackage } from '../utils/dependencyGraph.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { printHeader, printSection, printError, printWarning, printInfo } from '../utils/terminal.js';

interface Occurrence {
  version: string;
  paths: string[][];
}

/**
 * Groups the paths returned by findPathsToPackage by the resolved version at each
 * path's terminal node (a package can be installed at multiple versions).
 */
function groupPathsByVersion(graph: DependencyGraph, packageName: string): Occurrence[] {
  const paths = findPathsToPackage(graph, packageName);
  const byVersion = new Map<string, string[][]>();

  // Re-derive each path's terminal node id by walking the graph the same way
  // findPathsToPackage does, so we can read off its version.
  const idPaths: Array<{ path: string[]; nodeId: string }> = [];
  const visit = (nodeId: string, path: string[], visited: Set<string>) => {
    if (visited.has(nodeId)) return;
    const next = new Set(visited);
    next.add(nodeId);
    const node = graph.nodes.get(nodeId);
    if (!node) return;
    const currentPath = nodeId === graph.root ? path : [...path, node.name];
    if (nodeId !== graph.root && node.name === packageName) {
      idPaths.push({ path: currentPath, nodeId });
    }
    node.children.forEach(childId => visit(childId, currentPath, next));
  };
  visit(graph.root, [], new Set());

  idPaths.forEach(({ path, nodeId }) => {
    const version = graph.nodes.get(nodeId)?.version || 'unknown';
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version)!.push(path);
  });

  // `paths` (from findPathsToPackage) and `idPaths` always have the same length
  // and content; the count is used only as a sanity fallback for "not found".
  if (paths.length === 0) return [];

  return Array.from(byVersion.entries()).map(([version, groupPaths]) => ({
    version,
    paths: groupPaths,
  }));
}

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

    const occurrences = groupPathsByVersion(graph, packageName);

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
