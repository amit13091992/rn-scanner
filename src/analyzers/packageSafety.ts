import { lookupPackument, fetchWeeklyDownloads, type PackumentLookup } from '../utils/npmRegistry.js';
import { queryVulnerabilities } from '../services/osvClient.js';
import { matchKnownMalwarePackages } from '../data/knownMalwarePackages.js';
import { isDeprecated } from '../data/deprecatedPackages.js';
import type { RawSecurityScanResult } from '../types/vulnerability.js';

const MS_PER_DAY = 86_400_000;
const NEW_PACKAGE_DAYS = 30;
const NEW_VERSION_DAYS = 7;
const LOW_WEEKLY_DOWNLOADS = 100;
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

// npm's own naming rule (lowercase, URL-safe, optional @scope/). Arguments reach this function
// from an AI agent, so anything outside it is rejected before it can shape a registry URL.
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export type PackageSafetyVerdict = 'ok' | 'review' | 'avoid' | 'unknown';

export interface PackageSafetySignal {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}

export interface PackageSafetyResult {
  package: string;
  version: string | null;
  /**
   * `ok` only when every check ran and found nothing; `unknown` when no signal fired but some
   * check could not run (listed in `notChecked`) — never a clean bill of health by omission.
   */
  verdict: PackageSafetyVerdict;
  signals: PackageSafetySignal[];
  notChecked: string[];
  details: {
    latest: string | null;
    packageCreatedAt: string | null;
    versionPublishedAt: string | null;
    weeklyDownloads: number | null;
    installHooks: string[] | null;
    vulnerabilities: Array<{ id: string; severity: string; summary: string }> | null;
  };
}

export interface PackageSafetyDeps {
  lookupPackument: (name: string) => Promise<PackumentLookup>;
  fetchWeeklyDownloads: (name: string) => Promise<number | undefined>;
  queryVulnerabilities: (packages: { name: string; version: string }[]) => Promise<RawSecurityScanResult>;
  now: () => Date;
}

const defaultDeps: PackageSafetyDeps = {
  lookupPackument,
  fetchWeeklyDownloads,
  queryVulnerabilities,
  now: () => new Date(),
};

function ageDays(from: string | undefined, now: Date): number | null {
  const parsed = from ? Date.parse(from) : NaN;
  return Number.isNaN(parsed) ? null : Math.floor((now.getTime() - parsed) / MS_PER_DAY);
}

/**
 * "Should an AI agent (or a person) add this package?" — deterministic checks against public
 * registry data, run before anything is installed: does the name exist at all (a missing name is
 * the classic hallucinated/typo'd-package signal that slopsquatting registers), is the package
 * or version brand new, is usage implausibly low, does it run install-time scripts, is it
 * deprecated, does it appear in the known-malware list, and does OSV list advisories for the
 * exact version. Never throws; a lookup that cannot complete lands in `notChecked`.
 */
export async function analyzePackageSafety(
  name: string,
  requestedVersion?: string,
  deps: PackageSafetyDeps = defaultDeps
): Promise<PackageSafetyResult> {
  const signals: PackageSafetySignal[] = [];
  const notChecked: string[] = [];
  const result: PackageSafetyResult = {
    package: name,
    version: requestedVersion ?? null,
    verdict: 'unknown',
    signals,
    notChecked,
    details: {
      latest: null,
      packageCreatedAt: null,
      versionPublishedAt: null,
      weeklyDownloads: null,
      installHooks: null,
      vulnerabilities: null,
    },
  };

  if (!NPM_NAME.test(name) || name.length > 214) {
    signals.push({ severity: 'critical', code: 'invalid_name', message: `"${name}" is not a valid npm package name` });
    result.verdict = 'avoid';
    return result;
  }

  const malwareByName = matchKnownMalwarePackages([{ name, version: requestedVersion ?? '' }]);
  const deprecatedEntry = isDeprecated(name);
  if (deprecatedEntry) {
    signals.push({
      severity: 'warning',
      code: 'deprecated_package',
      message: `${deprecatedEntry.reason}${deprecatedEntry.replacement ? ` — use ${deprecatedEntry.replacement}` : ''}`,
    });
  }

  const lookup = await deps.lookupPackument(name);
  if (lookup.status === 'not_found') {
    signals.push({
      severity: 'critical',
      code: 'not_on_registry',
      message: 'No such package on the npm registry — likely a hallucinated or mistyped name; do not install it',
    });
    result.verdict = 'avoid';
    return result;
  }
  if (lookup.status === 'unavailable') {
    notChecked.push('registry (could not reach npm to confirm the package exists)');
    return finish(result, malwareByName);
  }

  const { packument } = lookup;
  const now = deps.now();
  const latest = packument['dist-tags']?.latest ?? null;
  result.details.latest = latest;
  const version = requestedVersion ?? latest;
  result.version = version;
  result.details.packageCreatedAt = packument.time?.created ?? null;

  const createdAge = ageDays(packument.time?.created, now);
  if (createdAge !== null && createdAge < NEW_PACKAGE_DAYS) {
    signals.push({
      severity: 'warning',
      code: 'new_package',
      message: `Package was first published ${createdAge} day(s) ago — newly registered names are where slopsquatting and typosquats live`,
    });
  }

  if (!version || !packument.versions?.[version]) {
    signals.push({
      severity: 'critical',
      code: 'version_not_found',
      message: version ? `Version ${version} was never published` : 'No installable version found',
    });
    return finish(result, malwareByName);
  }

  const versionMeta = packument.versions[version];
  result.details.versionPublishedAt = packument.time?.[version] ?? null;
  const versionAge = ageDays(packument.time?.[version], now);
  if (versionAge !== null && versionAge < NEW_VERSION_DAYS) {
    signals.push({
      severity: 'warning',
      code: 'new_version',
      message: `Version ${version} was published ${versionAge} day(s) ago — too fresh for advisories to exist yet`,
    });
  }

  if (versionMeta?.deprecated) {
    signals.push({ severity: 'warning', code: 'deprecated_version', message: `Marked deprecated on npm: ${versionMeta.deprecated}` });
  }

  const hooks = INSTALL_HOOKS.filter((h) => typeof versionMeta?.scripts?.[h] === 'string');
  result.details.installHooks = hooks;
  if (hooks.length > 0) {
    signals.push({
      severity: 'warning',
      code: 'install_scripts',
      message: `Runs install-time script(s) on npm install: ${hooks.join(', ')} (common for native-binary packages, but also how npm worms execute)`,
    });
  }

  const [downloads, osv] = await Promise.all([
    deps.fetchWeeklyDownloads(name),
    deps.queryVulnerabilities([{ name, version }]),
  ]);

  if (downloads === undefined) {
    notChecked.push('weekly downloads');
  } else {
    result.details.weeklyDownloads = downloads;
    if (downloads < LOW_WEEKLY_DOWNLOADS) {
      signals.push({
        severity: 'warning',
        code: 'low_usage',
        message: `Only ${downloads} download(s) in the last week — verify this is the package you mean`,
      });
    }
  }

  if (!osv.scanned) {
    notChecked.push('known vulnerabilities (OSV.dev unreachable)');
  } else {
    const vulns = osv.results.flatMap((r) => r.vulnerabilities);
    result.details.vulnerabilities = vulns.map((v) => ({ id: v.id, severity: v.severity, summary: v.summary }));
    for (const v of vulns) {
      signals.push({
        severity: v.severity === 'critical' || v.severity === 'high' ? 'critical' : 'warning',
        code: 'known_vulnerability',
        message: `${v.id} (${v.severity}): ${v.summary}`,
      });
    }
  }

  return finish(result, matchKnownMalwarePackages([{ name, version }]));
}

function finish(
  result: PackageSafetyResult,
  malware: ReturnType<typeof matchKnownMalwarePackages>
): PackageSafetyResult {
  for (const m of malware) {
    result.signals.push({
      severity: 'critical',
      code: 'known_malware',
      message: `Listed in a known supply-chain incident (${m.incident}): ${m.summary}`,
    });
  }

  const hasCritical = result.signals.some((s) => s.severity === 'critical');
  const hasWarning = result.signals.some((s) => s.severity === 'warning');
  result.verdict = hasCritical ? 'avoid' : hasWarning ? 'review' : result.notChecked.length > 0 ? 'unknown' : 'ok';
  return result;
}
