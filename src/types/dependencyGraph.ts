// Node ids: for npm graphs we reuse the package-lock.json "packages" object's own path key
// verbatim (e.g. "node_modules/foo/node_modules/bar", with "" as the project root) since it
// already uniquely identifies a package's position in the install tree. For yarn/pnpm/bun
// (best-effort, direct-from-root only) we synthesize ids as "node_modules/<name>" for each
// direct dependency, with "" as the root.
export interface DependencyGraphNode {
  name: string;
  version: string;
  parents: string[]; // node ids (see below) of direct parents
  children: string[]; // node ids of direct children
  dev?: boolean;
  optional?: boolean;
}

export interface DependencyGraph {
  manager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  hierarchyComplete: boolean; // true only for npm today
  root: string; // node id of the project root
  nodes: Map<string, DependencyGraphNode>; // keyed by a unique node id, NOT just package name (a package can appear at multiple graph positions with different versions)
}
