import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import type { RnDepScannerConfig } from '../types/config.js';
import type { VulnerabilitySeverity } from '../types/vulnerability.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { analyzeLicenses } from './licenses.js';
import { analyzeSecurityVulnerabilities } from './securityVulnerabilities.js';

export interface PolicyViolation {
  rule: 'bannedPackages' | 'licenseDenylist' | 'maxVulnerabilitySeverity';
  message: string;
}

export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
  /** How many of the three policy rules were actually configured — a policy with nothing
   *  configured always "passes" trivially, which is worth surfacing rather than reporting as
   *  a meaningful green check (ADR-0004: don't imply a conclusion an empty config didn't earn). */
  rulesConfigured: number;
}

const SEVERITY_RANK: Record<VulnerabilitySeverity, number> = { low: 0, moderate: 1, high: 2, critical: 3, unknown: -1 };

/**
 * Evaluates a project against `.rn-dep-scanner.json`'s org-policy fields
 * (`bannedPackages`/`licenseDenylist`/`maxVulnerabilitySeverity`) by reusing the existing
 * license and security analyzers rather than re-implementing their detection — `policy` is a
 * gate on top of data those already produce, not a new detection source. Banned packages are
 * checked against the full transitive graph when available (a banned package pulled in only
 * transitively is still a violation), falling back to direct dependencies otherwise.
 */
export async function evaluatePolicy(
  cwd: string,
  dependencies: DependencyInfo[],
  config: RnDepScannerConfig,
  graph?: DependencyGraph | null
): Promise<PolicyResult> {
  const violations: PolicyViolation[] = [];
  let rulesConfigured = 0;

  if (config.bannedPackages && config.bannedPackages.length > 0) {
    rulesConfigured++;
    const bannedSet = new Set(config.bannedPackages);
    const present = graph
      ? [...new Set(collectAllPackageVersions(graph).map((v) => v.name))].filter((n) => bannedSet.has(n))
      : dependencies.map((d) => d.name).filter((n) => bannedSet.has(n));
    present.forEach((name) => {
      violations.push({ rule: 'bannedPackages', message: `"${name}" is on the banned packages list` });
    });
  }

  if (config.licenseDenylist && config.licenseDenylist.length > 0) {
    rulesConfigured++;
    const licenseResult = analyzeLicenses(cwd, dependencies, config.licenseDenylist, graph);
    licenseResult.denied.forEach((d) => {
      violations.push({ rule: 'licenseDenylist', message: `"${d.name}@${d.version}" has denied license "${d.license}"` });
    });
  }

  if (config.maxVulnerabilitySeverity) {
    rulesConfigured++;
    const threshold = SEVERITY_RANK[config.maxVulnerabilitySeverity];
    const securityResult = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);
    if (securityResult.scanned) {
      securityResult.results.forEach((r) => {
        r.vulnerabilities.forEach((v) => {
          if (SEVERITY_RANK[v.severity] >= threshold) {
            violations.push({
              rule: 'maxVulnerabilitySeverity',
              message: `"${r.package}@${r.version}" has a ${v.severity} vulnerability (${v.id}), exceeding the configured max of "${config.maxVulnerabilitySeverity}"`,
            });
          }
        });
      });
    }
  }

  return { passed: violations.length === 0, violations, rulesConfigured };
}
