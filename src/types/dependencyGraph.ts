// Node ids: for npm graphs we reuse the package-lock.json "packages" object's own path key
// verbatim (e.g. "node_modules/foo/node_modules/bar", with "" as the project root) since it
// already uniquely identifies a package's position in the install tree. For yarn/pnpm/bun we
// synthesize ids as "<name>@<version>" (yarn) or the lockfile's own entry key (pnpm/bun) for a
// registry package, and "workspace:<name>" for a sibling monorepo workspace package resolved
// via `utils/workspacePackages.ts` rather than the lockfile. When no lockfile can be parsed at
// all, a best-effort graph falls back to "node_modules/<name>" for each direct dependency, with
// "" as the root in every case.
export interface DependencyGraphNode {
  name: string;
  version: string;
  parents: string[]; // node ids (see below) of direct parents
  children: string[]; // node ids of direct children
  dev?: boolean;
  optional?: boolean;
  /** true if this node is a sibling monorepo workspace package (resolved locally, not from
   *  the lockfile) rather than a registry-published dependency. */
  workspace?: boolean;
}

export interface DependencyGraph {
  manager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  hierarchyComplete: boolean; // true for npm, yarn, pnpm, and bun; false only for the no-lockfile/unparsable best-effort fallback
  root: string; // node id of the project root
  nodes: Map<string, DependencyGraphNode>; // keyed by a unique node id, NOT just package name (a package can appear at multiple graph positions with different versions)
}
