import type { CompatibilityRule } from './dependency.js';
import type { BundleBudget } from './bundleSize.js';

export interface RnDepScannerConfig {
  /** Project-specific compatibility rules, same shape as the curated entries in
   *  `data/compatibility.ts` (package/version line + optional reactNative/react range). Checked
   *  in addition to the curated rules, not instead of them — useful for an internal fork or an
   *  unreleased package this project depends on that the curated data can't know about. */
  customCompatibilityRules?: CompatibilityRule[];
  /** Package names to exclude entirely from compatibility/breaking-change/New Architecture/deprecated/security output. */
  ignorePackages?: string[];
  /** Specific OSV/GHSA/CVE IDs to suppress from --security output even if a flagged package isn't otherwise ignored (accepted-risk vulnerabilities). */
  ignoreVulnerabilities?: string[];
  /** License identifiers (e.g. "GPL-3.0", "AGPL-3.0") that `licenses` should flag as disallowed. Matched case-insensitively against each package's own declared license. */
  licenseDenylist?: string[];
  /** Package names that must not appear anywhere in the dependency tree (direct or transitive) — an org-level ban, distinct from `data/deprecatedPackages.ts`'s curated "this is generally outdated" list. Consumed by `policy`. */
  bannedPackages?: string[];
  /** The most severe OSV vulnerability severity this project will tolerate — 'critical'/'high'/'moderate'/'low'. A finding at or above this severity is a `policy` violation. Omitted means no severity gate. */
  maxVulnerabilitySeverity?: 'critical' | 'high' | 'moderate' | 'low';
  /** `security`'s "published too recently" threshold in days (default 7; 0 turns the release-age lookups off). Overridden by `--min-release-age`. */
  minReleaseAgeDays?: number;
  /** Path (relative to the project) or https URL of a JSON array of known-malware entries (same shape as `data/knownMalwarePackages.ts`), checked alongside the built-in list — for pushing a live incident to every scan before an advisory exists. */
  knownMalwareFeed?: string;
  /** Bundle-size budget evaluated by `size diff` (KiB limits; see `types/bundleSize.ts`). */
  sizeBudget?: BundleBudget;
}
