import { existsSync, readFileSync } from 'fs';
import { resolve, relative, sep } from 'path';
import type { DependencyGraph, DependencyGraphNode } from '../types/dependencyGraph.js';
import { detectPackageManager, parseLockfile } from './lockfile.js';
import { readPackageJson, getAllDependencies } from './packageJson.js';
import { resolveDependencyRoot } from './projectRoot.js';
import { findWorkspacePackages, type WorkspacePackageInfo } from './workspacePackages.js';

/**
 * Cross-links a sibling monorepo workspace package as a graph node — by name, not by matching
 * the declared range (a `workspace:*`/`workspace:^1.0.0`/plain `*` protocol reference always
 * means "the local workspace copy", never a same-named registry package, so the package
 * manager itself never consults the registry for it either). Shared by the yarn/pnpm/bun
 * builders since the logic doesn't depend on any manager-specific lockfile shape.
 */
function ensureWorkspaceNode(
  nodes: Map<string, DependencyGraphNode>,
  ws: WorkspacePackageInfo,
  onNew: (id: string, deps: Record<string, string>) => void
): string {
  const id = `workspace:${ws.name}`;
  if (!nodes.has(id)) {
    nodes.set(id, {
      name: ws.name,
      version: ws.version || 'workspace',
      parents: [],
      children: [],
      workspace: true,
    });
    onNew(id, { ...ws.dependencies, ...ws.optionalDependencies });
  }
  return id;
}

interface NPMLockPackageRaw {
  name?: string;
  version?: string;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  /** A workspace-package symlink entry under node_modules (e.g. "node_modules/@acme/shared")
   *  points at its real entry via `resolved` (e.g. "packages/shared") instead of carrying its
   *  own version/dependencies. */
  link?: boolean;
  resolved?: string;
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
 * Strips the last "node_modules/<name>" segment from an npm lockfile "packages" path, giving
 * the path to search from one level up — used by `resolveNpmDependency`'s Node-resolution-style
 * walk, not for parent/child wiring (edges come from each entry's own `dependencies`, not path
 * nesting — see `buildNpmGraph`'s doc comment for why path nesting alone is wrong).
 */
function stripLastNodeModulesSegment(path: string): string | null {
  if (path === '') return null;
  const idx = path.lastIndexOf('node_modules/');
  if (idx === -1) return '';
  const prefix = path.slice(0, idx);
  if (prefix === '') return '';
  return prefix.slice(0, -1);
}

/**
 * The display name for a "packages" entry: its own `name` field when present (always present
 * for a root/workspace entry whose package.json name differs from its path's basename —
 * npm omits it when they match), else the last `node_modules/<name>` segment for an ordinary
 * installed dependency, else the path's own basename as a last resort (a workspace package
 * whose directory name happens to match its package.json name).
 */
function npmEntryName(path: string, pkg: NPMLockPackageRaw): string {
  if (pkg.name) return pkg.name;
  if (path === '') return '';
  const idx = path.lastIndexOf('node_modules/');
  if (idx !== -1) {
    const rest = path.slice(idx + 'node_modules/'.length);
    const segments = rest.split('/');
    if (segments[0]?.startsWith('@') && segments.length > 1) {
      return `${segments[0]}/${segments[1]}`;
    }
    return segments[0] || '';
  }
  const segments = path.split('/');
  return segments[segments.length - 1] || '';
}

/**
 * Resolves `name` as Node's own module resolution would from `fromPath`: try
 * `<fromPath>/node_modules/<name>` first, then walk up one `node_modules/<segment>` layer at a
 * time until the root's own `node_modules/<name>`. Follows a workspace-package symlink entry's
 * `resolved` pointer to its real entry (see `NPMLockPackageRaw.link`).
 */
function resolveNpmDependency(
  packages: Record<string, NPMLockPackageRaw>,
  fromPath: string,
  name: string
): string | null {
  let current: string | null = fromPath;
  while (current !== null) {
    const candidate = current === '' ? `node_modules/${name}` : `${current}/node_modules/${name}`;
    const entry = packages[candidate];
    if (entry) {
      if (entry.link && entry.resolved && packages[entry.resolved]) {
        return entry.resolved;
      }
      return candidate;
    }
    if (current === '') return null;
    current = stripLastNodeModulesSegment(current);
  }
  return null;
}

/**
 * Builds the npm dependency graph from each "packages" entry's own `dependencies`/
 * `optionalDependencies` (BFS-resolved via `resolveNpmDependency`), NOT from path nesting.
 * Path nesting only reflects nesting when npm physically can't hoist a package (a version
 * conflict) — the much more common case is every package flat at `node_modules/<name>`
 * regardless of whether it's a direct or transitive dependency, with the real tree recoverable
 * only from each entry's declared `dependencies`. Wiring by path alone (this function's
 * previous implementation) misattributed every hoisted transitive dependency as a direct
 * child of the project root, and — since an npm workspace's sibling packages and every hoisted
 * `node_modules/*` entry sit at the same path depth — made `--cwd`-scoping into a specific
 * workspace package a no-op (the whole monorepo's lockfile came back as one graph regardless
 * of which package you asked about). BFS-walking from the specific entry at `cwd` fixes both:
 * an ordinary transitive dependency now resolves to its real parent, and scoping into a
 * workspace package naturally limits the graph to what that package can actually reach.
 */
function buildNpmGraph(cwd: string): DependencyGraph | null {
  const { lockfilePath } = detectPackageManager(cwd);
  if (!existsSync(lockfilePath)) return null;

  const content = readFileSync(lockfilePath, 'utf-8');
  const parsed: NPMLockRaw = JSON.parse(content);
  const lockfileVersion = parsed.lockfileVersion || parsed.version || 1;

  if (lockfileVersion < 2 || !parsed.packages) {
    // v1 lockfiles have a flat, nested "dependencies" tree but no packages-path hierarchy
    // we can reliably line up with our npm-specific id scheme; caller falls back to best-effort.
    return null;
  }
  const packages = parsed.packages;

  const nodes = new Map<string, DependencyGraphNode>();
  Object.entries(packages).forEach(([path, pkg]) => {
    nodes.set(path, {
      name: npmEntryName(path, pkg),
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

  // Scope the graph to the specific workspace package at `cwd`, when it resolves to one, so
  // `why`/`tree`/`security` run from inside a workspace package see only what that package can
  // actually reach — not every sibling package's dependencies lumped into one graph.
  const lockfileRootDir = resolveDependencyRoot(cwd);
  const relPath = relative(lockfileRootDir, resolve(cwd)).split(sep).join('/');
  const root = relPath !== '' && relPath !== '.' && Object.prototype.hasOwnProperty.call(packages, relPath)
    ? relPath
    : '';

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId);
    const childNode = nodes.get(childId);
    if (!parentNode || !childNode) return;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  const queue: string[] = [root];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const entry = packages[path];
    if (!entry) continue;

    const deps = { ...entry.dependencies, ...entry.optionalDependencies };
    // devDependencies are only real "direct" dependencies for whichever package is the
    // effective root of this scan — a transitive package's own devDependencies were never
    // installed as part of the tree at all.
    if (path === root && entry.devDependencies) {
      Object.assign(deps, entry.devDependencies);
    }

    Object.keys(deps).forEach((depName) => {
      const resolved = resolveNpmDependency(packages, path, depName);
      if (!resolved) return;
      queue.push(resolved);
      const isDev = path === root && !!entry.devDependencies?.[depName];
      const isOptional = !!entry.optionalDependencies?.[depName];
      addEdge(path, resolved, isDev, isOptional);
    });
  }

  return {
    manager: 'npm',
    hierarchyComplete: true,
    root,
    nodes,
  };
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
  const workspaceRoot = resolveDependencyRoot(cwd);
  const yarnLockPath = resolve(workspaceRoot, 'yarn.lock');
  if (!existsSync(yarnLockPath)) return null;
  const workspacePackages = findWorkspacePackages(workspaceRoot);

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

  type QueueItem = { id: string; deps: Record<string, string> } | { id: string; entry: YarnEntry };
  const queue: QueueItem[] = [];
  const visited = new Set<string>();

  const ensureNode = (entry: YarnEntry): string => {
    const id = `${entry.name}@${entry.version}`;
    if (!nodes.has(id)) {
      nodes.set(id, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id, entry });
    }
    return id;
  };

  const ensureWsNode = (ws: WorkspacePackageInfo): string =>
    ensureWorkspaceNode(nodes, ws, (id, deps) => queue.push({ id, deps }));

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const ws = workspacePackages.get(dep.name);
    if (ws) {
      const id = ensureWsNode(ws);
      addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
      return;
    }
    const entry = resolveEntry(dep.name, dep.requestedVersion);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);

    const depsToResolve = 'entry' in item ? item.entry.dependencies : item.deps;
    Object.entries(depsToResolve).forEach(([depName, depRange]) => {
      const ws = workspacePackages.get(depName);
      if (ws) {
        const childId = ensureWsNode(ws);
        addEdge(item.id, childId);
        return;
      }
      const childEntry = resolveEntry(depName, depRange);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(item.id, childId);
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

/** Strips a peer-dependency parenthetical suffix and a leading "/" from a pnpm lockfile key
 *  (e.g. "/foo@1.0.0(react@18.0.0)" or "foo@1.0.0") and splits it into name/version. Shared by
 *  both the legacy `packages:`-block parser and the current `snapshots:`-block parser, since
 *  both use the same "name@version" key shape. */
function parsePnpmKey(rawKey: string): { name: string; version: string } {
  let key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey;
  const parenIdx = key.indexOf('(');
  if (parenIdx !== -1) key = key.slice(0, parenIdx);
  const atIndex = key.startsWith('@') ? key.indexOf('@', 1) : key.indexOf('@');
  if (atIndex === -1) return { name: key, version: '' };
  return { name: key.slice(0, atIndex), version: key.slice(atIndex + 1) };
}

/**
 * Parses a block of 2-space-indented "name@version:" entries, each optionally followed by a
 * 4-space `dependencies:`/`optionalDependencies:` sub-block of 6-space "depName: depVersion"
 * lines — the shared shape of pnpm-lock.yaml's legacy `packages:` block (v5.x/v6.x, where each
 * package entry carries its own resolved dependency versions directly) and its current
 * `snapshots:` block (v9+, introduced when pnpm split package metadata from the actual
 * dependency graph — `packages:` in v9+ has resolution/engines metadata only, no
 * `dependencies`, which is exactly why this needed fixing: the old parser kept finding a
 * `packages:` block and successfully parsing it, just one that no longer carries any edges).
 * A key line with no sub-block ends in a literal `{}` (e.g. "is-number@6.0.0: {}") rather than
 * bare ":", which the legacy parser's "must end with ':'" check didn't account for either.
 */
function parsePnpmEntryBlock(lines: string[], startIdx: number): PnpmPackageEntry[] {
  const entries: PnpmPackageEntry[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\S/.test(line)) break; // indent 0 — block ended

    const keyMatch = line.match(/^ {2}(.+?):(\s*\{\})?\s*$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const rawKey = keyMatch[1].replace(/^['"]|['"]$/g, '');
    const { name, version } = parsePnpmKey(rawKey);
    const dependencies: Record<string, string> = {};
    const hasEmptyBlock = !!keyMatch[2];
    i++;

    if (!hasEmptyBlock) {
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
    }

    entries.push({ key: rawKey, name, version, dependencies });
  }

  return entries;
}

/** Finds a top-level (indent-0) "<name>:" line and returns the index just after it, or -1. */
function findTopLevelBlockStart(lines: string[], blockName: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === `${blockName}:`) return i + 1;
  }
  return -1;
}

/**
 * Parses pnpm-lock.yaml's actual dependency-graph data: the current (v9+) `snapshots:` block
 * when present (what every current `pnpm install` produces), else the legacy `packages:` block
 * (v5.x/v6.x, where `packages:` itself still carried `dependencies`).
 */
function parsePnpmPackages(content: string): PnpmPackageEntry[] {
  const lines = content.split('\n');

  const snapshotsStart = findTopLevelBlockStart(lines, 'snapshots');
  if (snapshotsStart !== -1) return parsePnpmEntryBlock(lines, snapshotsStart);

  const packagesStart = findTopLevelBlockStart(lines, 'packages');
  if (packagesStart !== -1) return parsePnpmEntryBlock(lines, packagesStart);

  return [];
}

/**
 * Parses one importer's (a single-package project's root, or one workspace package's own
 * entry) declared dependencies from pnpm-lock.yaml's current (v9+) `importers:` block —
 * `importers: { '.': { dependencies: { name: { specifier, version } } }, 'packages/foo': {...} }`
 * — returning each dependency's resolved `version` (a `link:../relative` target for a sibling
 * workspace package, otherwise a plain resolved version to look up in `snapshots:`). Returns an
 * empty map, not a crash, for a legacy lockfile with no `importers:` block at all — callers
 * fall back to resolving by the dependency's own requested range in that case.
 */
function parsePnpmImporterDependencies(content: string, importerPath: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');
  const importersStart = findTopLevelBlockStart(lines, 'importers');
  if (importersStart === -1) return result;

  const targetKey = importerPath === '' ? '.' : importerPath;
  let i = importersStart;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\S/.test(line)) break; // indent 0 — importers block ended

    const importerMatch = line.match(/^ {2}(.+?):(\s*\{\})?\s*$/);
    if (!importerMatch) {
      i++;
      continue;
    }
    const importerKey = importerMatch[1].replace(/^['"]|['"]$/g, '');
    const isTarget = importerKey === targetKey;
    const importerHasEmptyBlock = !!importerMatch[2];
    i++;
    if (importerHasEmptyBlock) continue;

    while (i < lines.length) {
      const sub = lines[i];
      if (sub.trim() === '') {
        i++;
        continue;
      }
      const subDepth = sub.match(/^ */)?.[0].length ?? 0;
      if (subDepth <= 2) break;

      if (subDepth === 4 && /^(dependencies|devDependencies|optionalDependencies):$/.test(sub.trim())) {
        i++;
        while (i < lines.length) {
          const depLine = lines[i];
          const depDepth = depLine.match(/^ */)?.[0].length ?? 0;
          if (depDepth <= 4 || depLine.trim() === '') break;

          const depNameMatch = depLine.trim().match(/^['"]?([^'":\s]+)['"]?:\s*$/);
          if (depNameMatch) {
            const depName = depNameMatch[1];
            i++;
            while (i < lines.length) {
              const detailLine = lines[i];
              const detailDepth = detailLine.match(/^ */)?.[0].length ?? 0;
              if (detailDepth <= 6 || detailLine.trim() === '') break;
              const versionMatch = detailLine.trim().match(/^version:\s*['"]?([^'"\s]+)['"]?$/);
              if (versionMatch && isTarget) result.set(depName, versionMatch[1]);
              i++;
            }
            continue;
          }
          i++;
        }
        continue;
      }

      i++;
    }
  }

  return result;
}

/** Parses the root importer's direct dependencies from pnpm-lock.yaml's legacy (v5.x) top-level
 *  `dependencies:`/`devDependencies:` blocks — v6.x/v9+ use `importers:` instead (see
 *  `parsePnpmImporterDependencies`), checked first by `resolvePnpmDependencyVersions` below. */
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

/** `importers:` (v6+/v9+) takes precedence over the legacy top-level `dependencies:` block
 *  (v5.x) when present — a lockfile never has both for the same information. */
function resolvePnpmDependencyVersions(content: string, importerPath: string): Map<string, string> {
  const fromImporters = parsePnpmImporterDependencies(content, importerPath);
  if (fromImporters.size > 0) return fromImporters;
  return parsePnpmRootDependencies(content);
}

async function buildPnpmGraph(cwd: string): Promise<DependencyGraph | null> {
  const workspaceRoot = resolveDependencyRoot(cwd);
  const pnpmLockPath = resolve(workspaceRoot, 'pnpm-lock.yaml');
  if (!existsSync(pnpmLockPath)) return null;
  const workspacePackages = findWorkspacePackages(workspaceRoot);

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
  const importerPath = relative(workspaceRoot, resolve(cwd)).split(sep).join('/');
  const rootDeps = resolvePnpmDependencyVersions(content, importerPath);

  const nodes = new Map<string, DependencyGraphNode>();
  nodes.set('', { name: '', version: '', parents: [], children: [] });

  type QueueItem = { id: string; deps: Record<string, string> } | { id: string; entry: PnpmPackageEntry };
  const queue: QueueItem[] = [];
  const visited = new Set<string>();

  const ensureNode = (entry: PnpmPackageEntry): string => {
    if (!nodes.has(entry.key)) {
      nodes.set(entry.key, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id: entry.key, entry });
    }
    return entry.key;
  };

  const ensureWsNode = (ws: WorkspacePackageInfo): string =>
    ensureWorkspaceNode(nodes, ws, (id, deps) => queue.push({ id, deps }));

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const ws = workspacePackages.get(dep.name);
    if (ws) {
      const id = ensureWsNode(ws);
      addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
      return;
    }
    const versionSpec = rootDeps.get(dep.name);
    const entry = versionSpec
      ? resolveEntry(dep.name, versionSpec)
      : resolveEntry(dep.name, dep.requestedVersion);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);

    const depsToResolve = 'entry' in item ? item.entry.dependencies : item.deps;
    Object.entries(depsToResolve).forEach(([depName, depVersionSpec]) => {
      const ws = workspacePackages.get(depName);
      if (ws) {
        const childId = ensureWsNode(ws);
        addEdge(item.id, childId);
        return;
      }
      const childEntry = resolveEntry(depName, depVersionSpec);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(item.id, childId);
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

/**
 * `content.workspaces` has one entry per workspace package, keyed by its relative path from
 * the monorepo root ("" for the root/single-package project itself, "packages/foo" for a
 * workspace package) — each carrying that specific package's own `dependencies`/
 * `devDependencies`/`optionalDependencies`. `importerPath` selects which one to read, so a
 * workspace sub-package's own declared deps are used (previously hardcoded to `['']`, the
 * monorepo root's own deps — wrong for any sub-package that declares a dependency the root
 * doesn't, which the `rootDeps` gate below would then silently drop as if it weren't real).
 */
function parseBunPackages(
  raw: string,
  importerPath: string
): { entries: BunPackageEntry[]; rootDeps: Record<string, string> } {
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
  const importer = content.workspaces?.[importerPath];
  if (importer) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const depMap = importer[field];
      if (depMap && typeof depMap === 'object') {
        Object.assign(rootDeps, depMap);
      }
    }
  }

  return { entries, rootDeps };
}

async function buildBunGraph(cwd: string): Promise<DependencyGraph | null> {
  const workspaceRoot = resolveDependencyRoot(cwd);
  const bunLockPath = resolve(workspaceRoot, 'bun.lock');
  if (!existsSync(bunLockPath)) return null;
  const workspacePackages = findWorkspacePackages(workspaceRoot);

  const importerPath = relative(workspaceRoot, resolve(cwd)).split(sep).join('/');
  let parsed: { entries: BunPackageEntry[]; rootDeps: Record<string, string> };
  try {
    parsed = parseBunPackages(readFileSync(bunLockPath, 'utf-8'), importerPath);
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

  type QueueItem = { id: string; deps: Record<string, string> } | { id: string; entry: BunPackageEntry };
  const queue: QueueItem[] = [];
  const visited = new Set<string>();

  const ensureNode = (entry: BunPackageEntry): string => {
    if (!nodes.has(entry.key)) {
      nodes.set(entry.key, { name: entry.name, version: entry.version, parents: [], children: [] });
      queue.push({ id: entry.key, entry });
    }
    return entry.key;
  };

  const ensureWsNode = (ws: WorkspacePackageInfo): string =>
    ensureWorkspaceNode(nodes, ws, (id, deps) => queue.push({ id, deps }));

  const addEdge = (parentId: string, childId: string, dev?: boolean, optional?: boolean): void => {
    const parentNode = nodes.get(parentId)!;
    const childNode = nodes.get(childId)!;
    if (!parentNode.children.includes(childId)) parentNode.children.push(childId);
    if (!childNode.parents.includes(parentId)) childNode.parents.push(parentId);
    if (dev) childNode.dev = true;
    if (optional) childNode.optional = true;
  };

  directDeps.forEach((dep) => {
    const ws = workspacePackages.get(dep.name);
    if (ws) {
      const id = ensureWsNode(ws);
      addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
      return;
    }
    const inRootDeps = Object.prototype.hasOwnProperty.call(rootDeps, dep.name);
    if (!inRootDeps && Object.keys(rootDeps).length > 0) return;
    const entry = resolveEntry(dep.name);
    if (!entry) return;
    const id = ensureNode(entry);
    addEdge('', id, dep.type === 'devDependency', dep.type === 'optionalDependency');
  });

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);

    const depsToResolve = 'entry' in item ? item.entry.dependencies : item.deps;
    Object.entries(depsToResolve).forEach(([depName]) => {
      const ws = workspacePackages.get(depName);
      if (ws) {
        const childId = ensureWsNode(ws);
        addEdge(item.id, childId);
        return;
      }
      const childEntry = resolveEntry(depName);
      if (!childEntry) return;
      const childId = ensureNode(childEntry);
      addEdge(item.id, childId);
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

export interface PackageOccurrence {
  version: string;
  paths: string[][];
}

/**
 * Groups every root-to-node path to `packageName` by the resolved version at each path's
 * terminal node (a package can be installed at multiple versions at once). Shared by `why`
 * and the security analyzer so both report identical paths for the same graph.
 */
export function findPathsGroupedByVersion(graph: DependencyGraph, packageName: string): PackageOccurrence[] {
  const byVersion = new Map<string, string[][]>();

  walkAllPaths(graph, (node, _nodeId, path) => {
    if (node.name !== packageName) return;
    const version = node.version || 'unknown';
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version)!.push(path);
  });

  return Array.from(byVersion.entries()).map(([version, paths]) => ({ version, paths }));
}

export interface GraphPackageVersion {
  name: string;
  version: string;
  /** true if this (name, version) is reachable via at least one direct (root-to-node length-1) path */
  direct: boolean;
  paths: string[][];
}

/**
 * Collects every unique (name, version) pair reachable in the graph, each with every path
 * that reaches it. Used by the security analyzer to scan the full transitive tree (not just
 * `package.json`'s direct dependencies) — e.g. a vulnerable package three levels deep like
 * `eslint > file-entry-cache > flat-cache > keyv` is invisible to a direct-only scan.
 */
export function collectAllPackageVersions(graph: DependencyGraph): GraphPackageVersion[] {
  const byKey = new Map<string, GraphPackageVersion>();

  walkAllPaths(graph, (node, _nodeId, path) => {
    if (!node.version) return;
    const key = `${node.name}@${node.version}`;
    const direct = path.length === 1;
    const existing = byKey.get(key);
    if (existing) {
      existing.paths.push(path);
      if (direct) existing.direct = true;
    } else {
      byKey.set(key, { name: node.name, version: node.version, direct, paths: [path] });
    }
  });

  return Array.from(byKey.values());
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
