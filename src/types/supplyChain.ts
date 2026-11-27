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

export interface ProvenanceRegressionFinding {
  package: string;
  version: string;
  /** The earlier version that did carry a provenance attestation. */
  previousVersion: string;
  direct: boolean;
}

export interface PublisherChangeFinding {
  package: string;
  version: string;
  previousVersion: string;
  /** npm account names only. */
  publisher: string;
  previousPublisher: string;
  direct: boolean;
}

export type ReleaseAgeNotCheckedReason = 'offline' | 'lookup_failed' | 'lookup_cap';

export interface SupplyChainSignals {
  /** false when there was no dependency graph to inspect — never a clean result. */
  scanned: boolean;
  installScripts: InstallScriptFinding[];
  recentlyPublished: RecentlyPublishedFinding[];
  /** Versions published without provenance although the previous version had it. */
  provenanceRegressions: ProvenanceRegressionFinding[];
  /** Versions published by a different npm account than the previous version. */
  publisherChanges: PublisherChangeFinding[];
  releaseAge: {
    minAgeDays: number;
    checked: number;
    /** Candidates whose publish time could not be determined, by cause. */
    notChecked: Partial<Record<ReleaseAgeNotCheckedReason, number>>;
  };
}
