export interface RnDepScannerConfig {
  /** Package names to exclude entirely from compatibility/breaking-change/New Architecture/deprecated/security output. */
  ignorePackages?: string[];
  /** Specific OSV/GHSA/CVE IDs to suppress from --security output even if a flagged package isn't otherwise ignored (accepted-risk vulnerabilities). */
  ignoreVulnerabilities?: string[];
  /** License identifiers (e.g. "GPL-3.0", "AGPL-3.0") that `licenses` should flag as disallowed. Matched case-insensitively against each package's own declared license. */
  licenseDenylist?: string[];
}
