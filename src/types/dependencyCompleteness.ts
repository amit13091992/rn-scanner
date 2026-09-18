export type MissingDependencyKind = 'dependency' | 'peerDependency';

export interface MissingDependency {
  parent: string;
  parentVersion: string;
  dependency: string;
  requiredRange: string;
  /** null = not installed at all; a string = installed but outside requiredRange */
  installedVersion: string | null;
  kind: MissingDependencyKind;
  optional: boolean;
}

export interface UncheckedParent {
  parent: string;
  reason: string;
}

export interface DependencyCompletenessResult {
  missing: MissingDependency[];
  notChecked: UncheckedParent[];
}
