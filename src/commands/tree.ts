import { buildDependencyGraph, findDuplicateVersionPaths } from '../utils/dependencyGraph.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { printHeader, printError, printWarning, printInfo } from '../utils/terminal.js';

export interface TreeOptions {
  json?: boolean;
  cwd?: string;
  duplicatesOnly?: boolean; // corresponds to a future `--duplicates` CLI flag
}

const MAX_DEPTH = 10;

interface JsonTreeNode {
  name: string;
  version: string;
  children: JsonTreeNode[];
  truncated?: boolean;
}

function buildJsonSubtree(
  graph: DependencyGraph,
  nodeId: string,
  depth: number,
  visited: Set<string>,
  duplicateNames?: Set<string>
): JsonTreeNode | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;

  if (visited.has(nodeId)) {
    return { name: node.name, version: node.version, children: [] };
  }

  if (depth > MAX_DEPTH) {
    return { name: node.name, version: node.version, children: [], truncated: true };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  let childIds = node.children;
  if (duplicateNames) {
    childIds = childIds.filter(childId => subtreeContainsDuplicate(graph, childId, duplicateNames, new Set()));
  }

  const children = childIds
    .map(childId => buildJsonSubtree(graph, childId, depth + 1, nextVisited, duplicateNames))
    .filter((n): n is JsonTreeNode => n !== null);

  return { name: node.name, version: node.version, children };
}

function subtreeContainsDuplicate(
  graph: DependencyGraph,
  nodeId: string,
  duplicateNames: Set<string>,
  visited: Set<string>
): boolean {
  if (visited.has(nodeId)) return false;
  const node = graph.nodes.get(nodeId);
  if (!node) return false;
  if (duplicateNames.has(node.name)) return true;

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  return node.children.some(childId => subtreeContainsDuplicate(graph, childId, duplicateNames, nextVisited));
}

function printSubtree(
  graph: DependencyGraph,
  nodeId: string,
  prefix: string,
  isLast: boolean,
  depth: number,
  visited: Set<string>,
  duplicateNames?: Set<string>
): void {
  const node = graph.nodes.get(nodeId);
  if (!node) return;

  const isRoot = nodeId === graph.root;
  const connector = isLast ? '└─ ' : '├─ ';
  const label = isRoot ? 'your-app' : `${node.name}@${node.version}`;

  if (isRoot) {
    console.log(label);
  } else {
    console.log(`${prefix}${connector}${label}`);
  }

  if (visited.has(nodeId)) {
    return;
  }

  if (depth > MAX_DEPTH) {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    console.log(`${childPrefix}... (max depth reached)`);
    return;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  let childIds = node.children;
  if (duplicateNames) {
    childIds = childIds.filter(childId => subtreeContainsDuplicate(graph, childId, duplicateNames, new Set()));
  }

  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');

  childIds.forEach((childId, idx) => {
    printSubtree(
      graph,
      childId,
      childPrefix,
      idx === childIds.length - 1,
      depth + 1,
      nextVisited,
      duplicateNames
    );
  });
}

function findFirstNodeIdForPackage(graph: DependencyGraph, packageName: string): string | null {
  for (const [nodeId, node] of graph.nodes.entries()) {
    if (nodeId === graph.root) continue;
    if (node.name === packageName) return nodeId;
  }
  return null;
}

export async function treeCommand(packageName?: string, options: TreeOptions = {}): Promise<void> {
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

    let rootId = graph.root;
    if (packageName) {
      const found = findFirstNodeIdForPackage(graph, packageName);
      if (!found) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: `"${packageName}" not found in dependency graph` }, null, 2));
        } else {
          printInfo(`"${packageName}" was not found in the dependency graph.`);
        }
        return;
      }
      rootId = found;
    }

    let duplicateNames: Set<string> | undefined;
    if (options.duplicatesOnly) {
      duplicateNames = new Set(findDuplicateVersionPaths(graph).keys());
    }

    if (jsonMode) {
      const startDepth = packageName ? 0 : 0;
      const tree = buildJsonSubtree(graph, rootId, startDepth, new Set(), duplicateNames);
      console.log(
        JSON.stringify(
          {
            manager: graph.manager,
            hierarchyComplete: graph.hierarchyComplete,
            tree,
          },
          null,
          2
        )
      );
      return;
    }

    printHeader(packageName ? `Dependency Tree: ${packageName}` : 'Dependency Tree');

    if (!graph.hierarchyComplete) {
      printWarning(
        `Dependency hierarchy for "${graph.manager}" only shows direct dependencies (not full transitive resolution).`
      );
    }

    printSubtree(graph, rootId, '', true, 0, new Set(), duplicateNames);
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
