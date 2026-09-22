/**
 * `data_unavailable` replaces the old `unknown` value (ADR-0007): the package isn't
 * incompatible, we simply have no curated or inferred compatibility data for it. Keeping
 * this distinct from `unsupported`/`partial` matters because summary counts and consumers
 * must not read "no data" as "known to be broken".
 */
export type NewArchSupport = 'supported' | 'unsupported' | 'partial' | 'data_unavailable';

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
  /** Present when support is 'data_unavailable' — explains why no verdict could be made. */
  reason?: string;
}

export interface NewArchProjectStatus {
  reactNativeVersion: string | null;
  isNewArchDefault: boolean;
  isBridgeRemoved: boolean;
}
