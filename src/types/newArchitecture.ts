export type NewArchSupport = 'supported' | 'unsupported' | 'partial' | 'unknown';

export interface NewArchPackageInfo {
  package: string;
  support: NewArchSupport;
  minVersion?: string;
  notes?: string;
}

export interface NewArchCheckResult {
  package: string;
  version: string;
  support: NewArchSupport;
  notes?: string;
}

export interface NewArchProjectStatus {
  reactNativeVersion: string | null;
  isNewArchDefault: boolean;
  isBridgeRemoved: boolean;
}
