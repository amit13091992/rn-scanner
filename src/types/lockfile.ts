export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface ParsedLockfile {
  manager: PackageManager;
  dependencies: Map<string, ResolvedDependency>;
  timestamp: number;
}

export interface ResolvedDependency {
  name: string;
  requestedVersion: string;
  resolvedVersion: string;
  integrity?: string;
  dependencies?: Map<string, string>;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
}

export interface NPMLockEntry {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
  dev?: boolean;
  optional?: boolean;
}

export interface YarnLockEntry {
  version: string;
  resolved: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface PnpmLockEntry {
  version: string;
  resolved?: string;
  integrity?: string;
}

export interface ILockfileParser {
  parse(content: string): ParsedLockfile;
  supports(manager: PackageManager): boolean;
}
