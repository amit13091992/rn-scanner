export type DependencyType = 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';

export interface DependencyInfo {
  name: string;
  requestedVersion: string;
  resolvedVersion?: string;
  installedVersion?: string;
  latestVersion?: string;
  type: DependencyType;
  deprecated?: boolean;
  peerDependencies?: Record<string, string>;
  integrity?: string;
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

export interface BreakingChange {
  package: string;
  introducedInVersion: string;
  affectedVersions: string[];
  category?: 'api' | 'behavior' | 'dependency' | 'platform' | 'config';
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
  migrationGuide?: string;
  references?: string[];
}

export type CompatibilityStatus = 'compatible' | 'warning' | 'error' | 'not-checked';

export interface CompatibilityCheckResult {
  package: string;
  version: string;
  status: CompatibilityStatus;
  reason?: string;
  messages: string[];
  detectedFrom: 'rules' | 'no-rules' | 'no-lock-file';
}
