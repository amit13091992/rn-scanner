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

interface YarnEntry {
  name: string;
  version: string;
  specs: string[]; // raw range suffixes this entry satisfies, e.g. "^1.0.0" or "npm:^1.0.0"
  dependencies: Record<string, string>; // depName -> declared range
}

/**
 * Parses yarn.lock (classic v1 and berry v2+ formats) into a list of entries, each
 * representing one resolved (name, version) pair and the ranges that resolve to it.
 * Handles both `name "range"` (classic) and `name: range` (berry) dependency lines.
 */
function parseYarnLockEntries(content: string): YarnEntry[] {
  const entries: YarnEntry[] = [];
  const lines = content.split('\n');
  let i = 0;

  const splitSpecs = (header: string): string[] => {
    // Split on ", " outside of quotes.
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of header) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };

  const specName = (spec: string): string => {
    // spec is "name@range" or "name@npm:range"; scoped names start with @.
    const atIndex = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@');
    return atIndex === -1 ? spec : spec.slice(0, atIndex);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#') || line.startsWith(' ')) {
      i++;
      continue;
    }

    if (!line.endsWith(':')) {
      i++;
      continue;
    }

    const header = line.slice(0, -1);
    const specs = splitSpecs(header);
    if (specs.length === 0) {
      i++;
      continue;
    }
    const name = specName(specs[0]);

    i++;
    let version = '';
    const dependencies: Record<string, string> = {};

    while (i < lines.length) {
      const contentLine = lines[i];
      if (contentLine.trim() === '') {
        i++;
        continue;
      }
      // Stop once we hit a top-level (non-indented) line.
      if (!/^[ \t]/.test(contentLine)) break;

      const depth = contentLine.match(/^ */)?.[0].length ?? 0;
      const contentTrimmed = contentLine.trim();

      if (depth === 2 && contentTrimmed.startsWith('version')) {
        const m = contentTrimmed.match(/version:?\s+["']?([^"'\s]+)["']?/);
        if (m) version = m[1];
        i++;
        continue;
      }

      if (depth === 2 && (contentTrimmed === 'dependencies:' || contentTrimmed === 'optionalDependencies:')) {
        i++;
        while (i < lines.length) {
          const depLine = lines[i];
          const depDepth = depLine.match(/^ */)?.[0].length ?? 0;
          if (depDepth <= 2 || depLine.trim() === '') break;
          const depTrimmed = depLine.trim();
          // classic: `name "range"`  |  berry: `name: range` or `name: "range"`
          const m =
            depTrimmed.match(/^"?([^"\s:]+)"?:\s+["']?([^"'\s]+)["']?$/) ||
            depTrimmed.match(/^"?([^"\s]+)"?\s+["']([^"']+)["']$/);
          if (m) {
            dependencies[m[1]] = m[2];
          }
          i++;
        }
        continue;
      }

      i++;
    }

    entries.push({ name, version, specs, dependencies });
  }

  return entries;
}

function stripNpmProtocol(spec: string): string {
  return spec.startsWith('npm:') ? spec.slice(4) : spec;
}

async function buildYarnGraph(cwd: string): Promise<DependencyGraph | null> {
  const yarnLockPath = resolve(cwd, 'yarn.lock');
  if (!existsSync(yarnLockPath)) return null;

  const content = readFileSync(yarnLockPath, 'utf-8');
  const entries = parseYarnLockEntries(content);
  if (entries.length === 0) return null;

  const byName = new Map<string, YarnEntry[]>();
  entries.forEach((entry) => {
    if (!byName.has(entry.name)) byName.set(entry.name, []);
    byName.get(entry.name)!.push(entry);
  });

  const resolveEntry = (name: string, range: string): YarnEntry | undefined => {
    const candidates = byName.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    const wanted = stripNpmProtocol(range);
    return (
      candidates.find((c) => c.specs.some((s) => stripNpmProtocol(s.slice(s.indexOf('@') + 1)) === wanted)) ??
      candidates.find((c) => c.specs.some((s) => s === `${name}@${range}` || s === `${name}@npm:${range}`)) ??
      candidates[0]
    );
  };

  const packageJson = readPackageJson(cwd);
  const directDeps = getAllDependencies(packageJson);

  const nodes = new Map<string, DependencyGraphNode>();
  nodes.set('', { name: '', version: '', parents: [], children: [] });

  const queue: Array<{ id: string; entry: YarnEntry }> = [];
  const visited = new Set<string>();

  const ensureNode = (entry: YarnEntry): string => {
    const id = `${entry.name}@${entry.version}`;
    if (!nodes.has(id)) {
      nodes.set(id, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id, entry });
    }
    return id;
  };

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const entry = resolveEntry(dep.name, dep.requestedVersion);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const { id, entry } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    Object.entries(entry.dependencies).forEach(([depName, depRange]) => {
      const childEntry = resolveEntry(depName, depRange);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(id, childId);
    });
  }

  return {
    manager: 'yarn',
    hierarchyComplete: true,
    root: '',
    nodes,
  };
}

interface PnpmPackageEntry {
  key: string;
  name: string;
  version: string;
  dependencies: Record<string, string>; // depName -> resolved version spec (may include peer parens)
}

/**
 * Parses pnpm-lock.yaml's top-level `packages:` block (v5.x and v6+ key styles) into
 * entries keyed by their raw lockfile key, which already uniquely identifies a package's
 * resolved position (including distinct peer-dependency variants).
 */
function parsePnpmPackages(content: string): PnpmPackageEntry[] {
  const lines = content.split('\n');
  const entries: PnpmPackageEntry[] = [];
  let i = 0;

  // Find the top-level "packages:" block.
  while (i < lines.length && lines[i].trimEnd() !== 'packages:') i++;
  if (i >= lines.length) return entries;
  i++;

  const parseName = (rawKey: string): { name: string; version: string } => {
    let key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey;
    // Strip peer-dependency parenthetical suffix, e.g. "foo@1.0.0(react@18.0.0)".
    const parenIdx = key.indexOf('(');
    if (parenIdx !== -1) key = key.slice(0, parenIdx);
    const atIndex = key.startsWith('@') ? key.indexOf('@', 1) : key.indexOf('@');
    if (atIndex === -1) return { name: key, version: '' };
    return { name: key.slice(0, atIndex), version: key.slice(atIndex + 1) };
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    // A top-level "packages:" child entry is indented exactly 2 spaces and ends with ':'.
    const isTwoSpaceKey = /^  \S/.test(line) && line.trimEnd().endsWith(':');
    if (!isTwoSpaceKey) {
      // Anything at indent 0 ends the packages block.
      if (/^\S/.test(line)) break;
      i++;
      continue;
    }

    const rawKey = line.trim().replace(/:$/, '').replace(/^['"]|['"]$/g, '');
    const { name, version } = parseName(rawKey);
    const dependencies: Record<string, string> = {};

    i++;
    while (i < lines.length) {
      const sub = lines[i];
      if (sub.trim() === '') {
        i++;
        continue;
      }
      const subDepth = sub.match(/^ */)?.[0].length ?? 0;
      if (subDepth <= 2) break;

      if (subDepth === 4 && (sub.trim() === 'dependencies:' || sub.trim() === 'optionalDependencies:')) {
        i++;
        while (i < lines.length) {
          const depLine = lines[i];
          const depDepth = depLine.match(/^ */)?.[0].length ?? 0;
          if (depDepth <= 4 || depLine.trim() === '') break;
          const m = depLine.trim().match(/^['"]?([^'":\s]+)['"]?:\s*['"]?([^'"\s]+)['"]?$/);
          if (m) dependencies[m[1]] = m[2];
          i++;
        }
        continue;
      }

      i++;
    }

    entries.push({ key: rawKey, name, version, dependencies });
  }

  return entries;
}

/** Parses the root importer's direct dependencies from pnpm-lock.yaml (v5.x top-level
 * `dependencies:`/`devDependencies:` blocks, or v6+ `importers: '.':` blocks). */
function parsePnpmRootDependencies(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');

  const captureBlock = (startIdx: number, indent: number): number => {
    let i = startIdx;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        i++;
        continue;
      }
      const depth = line.match(/^ */)?.[0].length ?? 0;
      if (depth <= indent) break;
      const m = line.trim().match(/^['"]?([^'":\s]+)['"]?:\s*['"]?([^'"\s]+)['"]?$/);
      if (m) result.set(m[1], m[2]);
      i++;
    }
    return i;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (
      (trimmed === 'dependencies:' || trimmed === 'devDependencies:') &&
      (lines[i].match(/^ */)?.[0].length ?? 0) === 0
    ) {
      captureBlock(i + 1, 0);
    }
  }

  return result;
}

async function buildPnpmGraph(cwd: string): Promise<DependencyGraph | null> {
  const pnpmLockPath = resolve(cwd, 'pnpm-lock.yaml');
  if (!existsSync(pnpmLockPath)) return null;

  const content = readFileSync(pnpmLockPath, 'utf-8');
  const packages = parsePnpmPackages(content);
  if (packages.length === 0) return null;

  const byName = new Map<string, PnpmPackageEntry[]>();
  packages.forEach((pkg) => {
    if (!byName.has(pkg.name)) byName.set(pkg.name, []);
    byName.get(pkg.name)!.push(pkg);
  });

  const resolveEntry = (name: string, versionSpec: string): PnpmPackageEntry | undefined => {
    const candidates = byName.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    return (
      candidates.find((c) => c.version === versionSpec) ??
      candidates.find((c) => c.version.startsWith(versionSpec)) ??
      candidates[0]
    );
  };

  const packageJson = readPackageJson(cwd);
  const directDeps = getAllDependencies(packageJson);
  const rootDeps = parsePnpmRootDependencies(content);

  const nodes = new Map<string, DependencyGraphNode>();
  nodes.set('', { name: '', version: '', parents: [], children: [] });

  const queue: Array<{ id: string; entry: PnpmPackageEntry }> = [];
  const visited = new Set<string>();

  const ensureNode = (entry: PnpmPackageEntry): string => {
    if (!nodes.has(entry.key)) {
      nodes.set(entry.key, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id: entry.key, entry });
    }
    return entry.key;
  };

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const versionSpec = rootDeps.get(dep.name);
    const entry = versionSpec
      ? resolveEntry(dep.name, versionSpec)
      : resolveEntry(dep.name, dep.requestedVersion);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const { id, entry } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    Object.entries(entry.dependencies).forEach(([depName, depVersionSpec]) => {
      const childEntry = resolveEntry(depName, depVersionSpec);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(id, childId);
    });
  }

  if (nodes.get('')!.children.length === 0) return null;

  return {
    manager: 'pnpm',
    hierarchyComplete: true,
    root: '',
    nodes,
  };
}

interface BunPackageEntry {
  key: string;
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

function stripTrailingCommasForBun(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1');
}

function parseBunPackages(raw: string): { entries: BunPackageEntry[]; rootDeps: Record<string, string> } {
  const content = JSON.parse(stripTrailingCommasForBun(raw));
  const entries: BunPackageEntry[] = [];

  if (content.packages && typeof content.packages === 'object') {
    for (const [key, value] of Object.entries<unknown>(content.packages)) {
      if (!Array.isArray(value)) continue;
      const spec = value[0];
      if (typeof spec !== 'string') continue;
      const atIndex = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.lastIndexOf('@');
      if (atIndex <= 0) continue;
      const name = spec.slice(0, atIndex);
      const version = spec.slice(atIndex + 1);

      const meta = value.find((v) => v && typeof v === 'object' && !Array.isArray(v)) as
        | Record<string, unknown>
        | undefined;
      const dependencies: Record<string, string> = {};
      if (meta) {
        for (const field of ['dependencies', 'optionalDependencies']) {
          const depMap = meta[field];
          if (depMap && typeof depMap === 'object') {
            Object.entries(depMap as Record<string, unknown>).forEach(([depName, depRange]) => {
              if (typeof depRange === 'string') dependencies[depName] = depRange;
            });
          }
        }
      }

      entries.push({ key, name, version, dependencies });
    }
  }

  const rootDeps: Record<string, string> = {};
  const rootWorkspace = content.workspaces?.[''];
  if (rootWorkspace) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const depMap = rootWorkspace[field];
      if (depMap && typeof depMap === 'object') {
        Object.assign(rootDeps, depMap);
      }
    }
  }

  return { entries, rootDeps };
}

async function buildBunGraph(cwd: string): Promise<DependencyGraph | null> {
  const bunLockPath = resolve(cwd, 'bun.lock');
  if (!existsSync(bunLockPath)) return null;

  let parsed: { entries: BunPackageEntry[]; rootDeps: Record<string, string> };
  try {
    parsed = parseBunPackages(readFileSync(bunLockPath, 'utf-8'));
  } catch {
    return null;
  }
  const { entries, rootDeps } = parsed;
  if (entries.length === 0) return null;

  const byName = new Map<string, BunPackageEntry[]>();
  entries.forEach((entry) => {
    if (!byName.has(entry.name)) byName.set(entry.name, []);
    byName.get(entry.name)!.push(entry);
  });

  const resolveEntry = (name: string): BunPackageEntry | undefined => byName.get(name)?.[0];

  const packageJson = readPackageJson(cwd);
  const directDeps = getAllDependencies(packageJson);

  const nodes = new Map<string, DependencyGraphNode>();
  nodes.set('', { name: '', version: '', parents: [], children: [] });

  const queue: Array<{ id: string; entry: BunPackageEntry }> = [];
  const visited = new Set<string>();

  const ensureNode = (entry: BunPackageEntry): string => {
    if (!nodes.has(entry.key)) {
      nodes.set(entry.key, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id: entry.key, entry });
    }
    return entry.key;
  };

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const inRootDeps = Object.prototype.hasOwnProperty.call(rootDeps, dep.name);
    if (!inRootDeps && Object.keys(rootDeps).length > 0) return;
    const entry = resolveEntry(dep.name);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const { id, entry } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    Object.entries(entry.dependencies).forEach(([depName]) => {
      const childEntry = resolveEntry(depName);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(id, childId);
    });
  }

  if (nodes.get('')!.children.length === 0) return null;

  return {
    manager: 'bun',
    hierarchyComplete: true,
    root: '',
    nodes,
  };
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

    if (manager === 'yarn') {
      try {
        const graph = await buildYarnGraph(cwd);
        if (graph) return graph;
      } catch {
        // fall through to best-effort
      }
      return await buildBestEffortGraph(cwd, 'yarn');
    }

    if (manager === 'pnpm') {
      try {
        const graph = await buildPnpmGraph(cwd);
        if (graph) return graph;
      } catch {
        // fall through to best-effort
      }
      return await buildBestEffortGraph(cwd, 'pnpm');
    }

    if (manager === 'bun') {
      try {
        const graph = await buildBunGraph(cwd);
        if (graph) return graph;
      } catch {
        // fall through to best-effort
      }
      return await buildBestEffortGraph(cwd, 'bun');
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
