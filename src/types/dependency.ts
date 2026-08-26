export type DependencyType = 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';

export interface DependencyInfo {
  name: string;
  requestedVersion: string;
  installedVersion?: string;
  latestVersion?: string;
  type: DependencyType;
  deprecated?: boolean;
  peerDependencies?: Record<string, string>;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

export interface ProjectMetadata {
  reactNativeVersion?: string;
  reactVersion?: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  dependencies: DependencyInfo[];
}

export interface CompatibilityRule {
  package: string;
  version: string;
  reactNative?: string;
  react?: string;
  node?: string;
}
