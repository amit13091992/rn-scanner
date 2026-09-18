export type ExpoGoSupport = 'supported' | 'unsupported' | 'unknown';

export interface ExpoGoPackageInfo {
  package: string;
  support: ExpoGoSupport;
  reason?: string;
  notes?: string;
}

export interface ExpoGoCheckResult {
  package: string;
  version: string;
  support: ExpoGoSupport;
  reason?: string;
  notes?: string;
}
