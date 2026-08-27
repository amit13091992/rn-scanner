export interface VersionParseResult {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
  metadata?: string;
  original: string;
  normalized: string;
}

export interface VersionRange {
  min?: VersionParseResult;
  max?: VersionParseResult;
  isInclusive: {
    min: boolean;
    max: boolean;
  };
  type: 'exact' | 'caret' | 'tilde' | 'range' | 'wildcard' | 'prerelease';
}

export interface VersionComparisonResult {
  isInRange: boolean;
  reason: string;
  details: {
    installedVersion: VersionParseResult;
    affectedRange: VersionRange;
  };
}
