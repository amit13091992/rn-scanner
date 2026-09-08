import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { DependencyGraph, DependencyGraphNode } from '../types/dependencyGraph.js';
import { detectPackageManager, parseLockfile } from './lockfile.js';
import { readPackageJson, getAllDependencies } from './packageJson.js';

interface NPMLockPackageRaw {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface NPMLockRaw {
  lockfileVersion?: number;
  version?: number;
  packages?: Record<string, NPMLockPackageRaw>;
}

/**
 * Derives the parent packages-key for an npm lockfile v2/v3 "packages" path by
 * stripping the last "node_modules/<name>" segment. Root ("") has no parent.
 */
function getParentPath(path: string): string | null {
  if (path === '') return null;

  const idx = path.lastIndexOf('node_modules/');
  if (idx === -1) return '';

  // Find the start of the LAST "node_modules/<name>" segment.
  // Walk back to find the previous "node_modules/" boundary if any.
  const prefix = path.slice(0, idx);
  // prefix ends with '/' if there is a parent chain, or is '' for a top-level package.
  if (prefix === '') return '';
  return prefix.slice(0, -1); // strip trailing slash
}

function extractNameFromPath(path: string): string {
  const idx = path.lastIndexOf('node_modules/');
  if (idx === -1) return '';
  const rest = path.slice(idx + 'node_modules/'.length);
  const segments = rest.split('/');
  if (segments[0]?.startsWith('@') && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] || '';
}

function buildNpmGraph(cwd: string): DependencyGraph | null {
  const { lockfilePath } = detectPackageManager(cwd);
  if (!existsSync(lockfilePath)) return null;

  const content = readFileSync(lockfilePath, 'utf-8');
  const parsed: NPMLockRaw = JSON.parse(content);
  const lockfileVersion = parsed.lockfileVersion || parsed.version || 1;

  const nodes = new Map<string, DependencyGraphNode>();

  if (lockfileVersion >= 2 && parsed.packages) {
    const packages = parsed.packages;

    // First pass: create nodes for every packages entry (including root "").
    Object.entries(packages).forEach(([path, pkg]) => {
      const name = path === '' ? '' : extractNameFromPath(path);
      nodes.set(path, {
        name,
        version: pkg.version || '',
        parents: [],
        children: [],
        dev: pkg.dev,
        optional: pkg.optional,
      });
    });

    if (!nodes.has('')) {
      nodes.set('', { name: '', version: '', parents: [], children: [] });
    }

    // Second pass: wire parent/child edges based on path hierarchy.
    Object.keys(packages).forEach(path => {
      if (path === '') return;
      const parentPath = getParentPath(path);
      if (parentPath === null) return;
      if (!nodes.has(parentPath)) {
        nodes.set(parentPath, { name: '', version: '', parents: [], children: [] });
      }
      const node = nodes.get(path);
      const parentNode = nodes.get(parentPath);
      if (node && parentNode) {
        node.parents.push(parentPath);
        parentNode.children.push(path);
      }
    });

    return {
      manager: 'npm',
      hierarchyComplete: true,
      root: '',
      nodes,
    };
  }

  // v1 lockfiles have a flat, nested "dependencies" tree but no packages-path hierarchy
  // we can reliably line up with our npm-specific id scheme; caller falls back to best-effort.
  return null;
}

async function buildBestEffortGraph(
  cwd: string,
  manager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): Promise<DependencyGraph | null> {
  const packageJson = readPackageJson(cwd);
  const directDeps = getAllDependencies(packageJson);
  const parsedLockfile = await parseLockfile(cwd);

  const nodes = new Map<string, DependencyGraphNode>();
  nodes.set('', { name: '', version: '', parents: [], children: [] });

  directDeps.forEach(dep => {
    const nodeId = `node_modules/${dep.name}`;
    const resolved = parsedLockfile?.dependencies.get(dep.name);
    nodes.set(nodeId, {
      name: dep.name,
      version: resolved?.resolvedVersion || dep.requestedVersion,
      parents: [''],
      children: [],
      dev: dep.type === 'devDependency',
      optional: dep.type === 'optionalDependency',
    });
    nodes.get('')!.children.push(nodeId);
  });

  return {
    manager,
    hierarchyComplete: false,
    root: '',
    nodes,
  };
}

export async function buildDependencyGraph(
  cwd: string = process.cwd()
): Promise<DependencyGraph | null> {
  try {
    const packageJsonPath = resolve(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) return null;

    const { manager } = detectPackageManager(cwd);

    if (manager === 'npm') {
      const graph = buildNpmGraph(cwd);
      if (graph) return graph;
      return await buildBestEffortGraph(cwd, 'npm');
    }

    return await buildBestEffortGraph(cwd, manager);
  } catch {
    return null;
  }
}

/**
 * Walks every root-to-node path once, invoking `onNode` for each non-root node
 * reached along with the path (package names, root excluded) leading to it.
 * Shared by findPathsToPackage and findDuplicateVersionPaths so both operate on
 * the exact same traversal semantics (cycle-safe via a per-branch visited set).
 */
function walkAllPaths(
  graph: DependencyGraph,
  onNode: (node: DependencyGraphNode, nodeId: string, path: string[]) => void
): void {
  const visit = (nodeId: string, path: string[], visited: Set<string>) => {
    if (visited.has(nodeId)) return; // guard against cycles
    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const node = graph.nodes.get(nodeId);
    if (!node) return;

    const currentPath = nodeId === graph.root ? path : [...path, node.name];

    if (nodeId !== graph.root) {
      onNode(node, nodeId, currentPath);
    }

    node.children.forEach(childId => visit(childId, currentPath, nextVisited));
  };

  visit(graph.root, [], new Set());
}

export function findPathsToPackage(graph: DependencyGraph, packageName: string): string[][] {
  const results: string[][] = [];

  walkAllPaths(graph, (node, _nodeId, path) => {
    if (node.name === packageName) {
      results.push(path);
    }
  });

  return results;
}

export function findDuplicateVersionPaths(
  graph: DependencyGraph
): Map<string, Array<{ version: string; paths: string[][] }>> {
  const result = new Map<string, Array<{ version: string; paths: string[][] }>>();

  const versionsByName = new Map<string, Set<string>>();
  graph.nodes.forEach((node, nodeId) => {
    if (nodeId === graph.root) return;
    if (!versionsByName.has(node.name)) versionsByName.set(node.name, new Set());
    versionsByName.get(node.name)!.add(node.version);
  });

  const duplicateNames = new Set(
    Array.from(versionsByName.entries())
      .filter(([, versions]) => versions.size >= 2)
      .map(([name]) => name)
  );

  const byNameAndVersion = new Map<string, Map<string, string[][]>>();
  for (const name of duplicateNames) {
    byNameAndVersion.set(name, new Map());
  }

  walkAllPaths(graph, (node, _nodeId, path) => {
    if (!duplicateNames.has(node.name)) return;
    const byVersion = byNameAndVersion.get(node.name)!;
    if (!byVersion.has(node.version)) byVersion.set(node.version, []);
    byVersion.get(node.version)!.push(path);
  });

  byNameAndVersion.forEach((byVersion, name) => {
    result.set(
      name,
      Array.from(byVersion.entries()).map(([version, paths]) => ({ version, paths }))
    );
  });

  return result;
}
