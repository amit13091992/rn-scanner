export interface InstallScriptFinding {
  package: string;
  version: string;
  /** Lifecycle hooks present in the installed manifest (names only — never the script body). */
  hooks: string[];
  direct: boolean;
}

export interface RecentlyPublishedFinding {
  package: string;
  version: string;
  publishedAt: string;
  ageDays: number;
  direct: boolean;
}

export type ReleaseAgeNotCheckedReason = 'offline' | 'lookup_failed' | 'lookup_cap';

export interface SupplyChainSignals {
  /** false when there was no dependency graph to inspect — never a clean result. */
  scanned: boolean;
  installScripts: InstallScriptFinding[];
  recentlyPublished: RecentlyPublishedFinding[];
  releaseAge: {
    minAgeDays: number;
    checked: number;
    /** Candidates whose publish time could not be determined, by cause. */
    notChecked: Partial<Record<ReleaseAgeNotCheckedReason, number>>;
  };
}
