import { buildDependencyGraph, findDuplicateVersionPaths } from '../utils/dependencyGraph.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { printHeader, printError, printWarning, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface TreeOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  duplicatesOnly?: boolean; // corresponds to a future `--duplicates` CLI flag
}

const MAX_DEPTH = 10;

interface JsonTreeNode {
  name: string;
  version: string;
  children: JsonTreeNode[];
  truncated?: boolean;
  expandedElsewhere?: boolean;
}

function buildJsonSubtree(
  graph: DependencyGraph,
  nodeId: string,
  depth: number,
  visited: Set<string>,
  expanded: Set<string>,
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

  if (expanded.has(nodeId)) {
    return { name: node.name, version: node.version, children: [], expandedElsewhere: true };
  }
  expanded.add(nodeId);

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  let childIds = node.children;
  if (duplicateNames) {
    childIds = childIds.filter(childId => subtreeContainsDuplicate(graph, childId, duplicateNames, new Set()));
  }

  const children = childIds
    .map(childId => buildJsonSubtree(graph, childId, depth + 1, nextVisited, expanded, duplicateNames))
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
  expanded: Set<string>,
  duplicateNames?: Set<string>
): void {
  const node = graph.nodes.get(nodeId);
  if (!node) return;

  const isRoot = nodeId === graph.root;
  const connector = isLast ? '└─ ' : '├─ ';
  const alreadyExpanded = !isRoot && expanded.has(nodeId);
  const label = isRoot
    ? 'your-app'
    : `${node.name}@${node.version}${alreadyExpanded ? ' (expanded above)' : ''}`;

  if (isRoot) {
    console.log(label);
  } else {
    console.log(`${prefix}${connector}${label}`);
  }

  if (visited.has(nodeId) || alreadyExpanded) {
    return;
  }
  expanded.add(nodeId);

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
      expanded,
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
  const jsonMode = !!options.json || !!options.html;

  try {
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      if (jsonMode) {
        emitStructuredOutput({ error: 'No project or lockfile found' }, 'Dependency Tree', options);
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
          emitStructuredOutput({ error: `"${packageName}" not found in dependency graph` }, 'Dependency Tree', options);
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
      const tree = buildJsonSubtree(graph, rootId, startDepth, new Set(), new Set(), duplicateNames);
      emitStructuredOutput(
        { manager: graph.manager, hierarchyComplete: graph.hierarchyComplete, tree },
        'Dependency Tree',
        options
      );
      return;
    }

    printHeader(packageName ? `Dependency Tree: ${packageName}` : 'Dependency Tree');

    if (!graph.hierarchyComplete) {
      printWarning(
        `Dependency hierarchy for "${graph.manager}" only shows direct dependencies (not full transitive resolution).`
      );
    }

    printSubtree(graph, rootId, '', true, 0, new Set(), new Set(), duplicateNames);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Error: ${message}` }, 'Dependency Tree', options);
    } else {
      printError(`Error: ${message}`);
    }
    process.exit(1);
  }
}
