import { coerce, gt } from 'semver';
import type { PackageVulnerabilityResult, VulnerabilitySeverity } from '../types/vulnerability.js';
import type { SupplyChainSignals } from '../types/supplyChain.js';
import { printSection, printWarning, printInfo } from './terminal.js';

export const SEVERITY_ORDER: VulnerabilitySeverity[] = ['critical', 'high', 'moderate', 'low', 'unknown'];

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  moderate: '🟡 MODERATE',
  low: 'ℹ️  LOW',
  unknown: 'ℹ️  UNKNOWN',
};

export interface SecurityPrintOptions {
  /** Name shown as the root of each dependency path — the scanned project's package.json name. */
  appName: string;
  /** One line per advisory instead of one block per package. */
  verbose?: boolean;
  /** Only the severity counts and one line per affected package. */
  summaryOnly?: boolean;
}

export function severityRank(severity: VulnerabilitySeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** True when any finding is at or above `threshold` (`none` never fails). */
export function meetsFailThreshold(
  summary: Record<VulnerabilitySeverity, number>,
  threshold: VulnerabilitySeverity | 'none'
): boolean {
  if (threshold === 'none') return false;
  return SEVERITY_ORDER.some((sev) => severityRank(sev) <= severityRank(threshold) && summary[sev] > 0);
}

export function parseFailOn(value: string | undefined): VulnerabilitySeverity | 'none' {
  const v = (value ?? 'high').toLowerCase();
  if (v === 'medium') return 'moderate';
  if (v === 'critical' || v === 'high' || v === 'moderate' || v === 'low' || v === 'none') return v;
  throw new Error(`Invalid --fail-on value "${value}" — use critical, high, moderate, low or none`);
}

/** `--min-release-age <days>`: a non-negative whole number of days; 0 turns release-age lookups off. */
export function parseMinReleaseAge(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid --min-release-age value "${value}" — use a non-negative whole number of days (0 disables the check)`);
  }
  return Number(text);
}

/** `--max-registry-lookups <n>`: a positive whole number of packument fetches. */
export function parseMaxRegistryLookups(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error(`Invalid --max-registry-lookups value "${value}" — use a positive whole number`);
  }
  return Number(text);
}

export function printSupplyChain(signals: SupplyChainSignals): void {
  if (!signals.scanned) return;
  const { installScripts, recentlyPublished, provenanceRegressions, publisherChanges, releaseAge } = signals;
  const notChecked = Object.values(releaseAge.notChecked).reduce((sum, n) => sum + (n ?? 0), 0);
  if (installScripts.length === 0 && recentlyPublished.length === 0 && provenanceRegressions.length === 0 && publisherChanges.length === 0 && notChecked === 0) return;

  printSection('Supply-chain signals (informational — does not affect the exit code)');
  if (installScripts.length > 0) {
    printWarning(`${installScripts.length} installed package(s) declare install-time scripts (run on \`npm install\`; many are legitimate, e.g. native-binary downloaders):`);
    installScripts.forEach((s) =>
      console.log(`  └─ ${s.package}@${s.version} (${s.hooks.join(', ')})${s.direct ? '' : ' [transitive]'}`)
    );
  }
  if (recentlyPublished.length > 0) {
    printWarning(`${recentlyPublished.length} package version(s) were published less than ${releaseAge.minAgeDays} days ago:`);
    recentlyPublished.forEach((r) =>
      console.log(`  └─ ${r.package}@${r.version} (${r.ageDays} day${r.ageDays === 1 ? '' : 's'} old)${r.direct ? '' : ' [transitive]'}`)
    );
  }
  if (provenanceRegressions.length > 0) {
    printWarning(`${provenanceRegressions.length} package version(s) were published without provenance although the previous version had it (can indicate a stolen publish token; also happens when a maintainer changes their release process):`);
    provenanceRegressions.forEach((f) =>
      console.log(`  └─ ${f.package}@${f.version} (${f.previousVersion} had provenance)${f.direct ? '' : ' [transitive]'}`)
    );
  }
  if (publisherChanges.length > 0) {
    printWarning(`${publisherChanges.length} package version(s) were published by a different npm account than the previous version:`);
    publisherChanges.forEach((f) =>
      console.log(`  └─ ${f.package}@${f.version} (${f.previousPublisher} → ${f.publisher})${f.direct ? '' : ' [transitive]'}`)
    );
  }
  if (notChecked > 0) {
    const causes = Object.entries(releaseAge.notChecked).map(([reason, n]) => `${n} ${reason.replace(/_/g, ' ')}`).join(', ');
    printInfo(`Registry signals (release age, provenance, publisher) were checked for ${releaseAge.checked} package(s) and not for ${notChecked} (${causes}). Lookups go to install-script and direct packages first, then the shallowest transitive ones; raise --max-registry-lookups to check more.`);
  }
}

/** The single version that clears every advisory on a package: the highest `fixedVersion` among them. */
export function highestFixedVersion(result: PackageVulnerabilityResult): string | undefined {
  let best: string | undefined;
  for (const vuln of result.vulnerabilities) {
    const fixed = vuln.fixedVersion;
    if (!fixed || !coerce(fixed)) continue;
    if (!best || gt(coerce(fixed)!, coerce(best)!)) best = fixed;
  }
  return best;
}

function worstSeverity(result: PackageVulnerabilityResult): VulnerabilitySeverity {
  return result.vulnerabilities.reduce<VulnerabilitySeverity>(
    (worst, v) => (severityRank(v.severity) < severityRank(worst) ? v.severity : worst),
    'unknown'
  );
}

function countBySeverity(result: PackageVulnerabilityResult): string {
  return SEVERITY_ORDER.map((sev) => ({ sev, n: result.vulnerabilities.filter((v) => v.severity === sev).length }))
    .filter((e) => e.n > 0)
    .map((e) => `${e.n} ${e.sev}`)
    .join(', ');
}

/** Shortest path first — the most direct explanation of why the package is installed. */
function sortedPaths(result: PackageVulnerabilityResult): string[][] {
  return result.paths.slice().sort((a, b) => a.length - b.length);
}

/**
 * Groups advisories by package@version so a package with a dozen advisories (e.g. `tar`) is one
 * block with one upgrade target, instead of a dozen near-identical blocks.
 */
export function printGroupedVulnerabilities(results: PackageVulnerabilityResult[], options: SecurityPrintOptions): void {
  const ordered = results
    .slice()
    .sort((a, b) => severityRank(worstSeverity(a)) - severityRank(worstSeverity(b)) || b.vulnerabilities.length - a.vulnerabilities.length
      || a.package.localeCompare(b.package) || a.version.localeCompare(b.version));

  for (const pkg of ordered) {
    const worst = worstSeverity(pkg);
    const label = `${SEVERITY_ICON[worst] ?? worst}  ${pkg.package}@${pkg.version}${pkg.direct ? ' (direct)' : ' (transitive)'}`;
    const fixed = highestFixedVersion(pkg);
    const count = pkg.vulnerabilities.length;

    if (options.summaryOnly) {
      console.log(`${label} — ${count} advisor${count === 1 ? 'y' : 'ies'} (${countBySeverity(pkg)})${fixed ? `, fix: ${fixed}` : ''}`);
      continue;
    }

    console.log(`\n${label} — ${count} advisor${count === 1 ? 'y' : 'ies'} (${countBySeverity(pkg)})`);
    console.log(`  ├─ ${fixed ? `Upgrade to ${fixed} or later (clears all fixable advisories)` : 'No fixed version published'}`);
    const paths = sortedPaths(pkg);
    if (paths.length > 0) {
      const extra = paths.length > 1 ? `  (+${paths.length - 1} more path${paths.length > 2 ? 's' : ''})` : '';
      console.log(`  ├─ Path: ${options.appName} → ${paths[0]!.join(' → ')}${extra}`);
    }
    const advisories = pkg.vulnerabilities.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    if (options.verbose) {
      advisories.forEach((v, i) => {
        const last = i === advisories.length - 1;
        console.log(`  ${last ? '└─' : '├─'} [${v.severity}] ${v.id}: ${v.summary}${v.fixedVersion ? ` (fixed in ${v.fixedVersion})` : ''}`);
      });
    } else {
      const ids = advisories.slice(0, 3).map((v) => v.id).join(', ');
      console.log(`  └─ ${ids}${count > 3 ? `, +${count - 3} more` : ''} (re-run with --verbose for every advisory)`);
    }
  }
}
