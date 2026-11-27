import { readInstallScriptHooks } from '../detectors/installScripts.js';
import { fetchVersionRegistryInfo, type VersionRegistryInfo } from '../utils/npmRegistry.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { isOffline } from '../utils/network.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import type {
  InstallScriptFinding,
  ProvenanceRegressionFinding,
  PublisherChangeFinding,
  RecentlyPublishedFinding,
  ReleaseAgeNotCheckedReason,
  SupplyChainSignals,
} from '../types/supplyChain.js';

export const DEFAULT_MIN_RELEASE_AGE_DAYS = 7;
const DEFAULT_MAX_PUBLISH_LOOKUPS = 150;
const CONCURRENCY = 10;
const MS_PER_DAY = 86_400_000;

export interface SupplyChainOptions {
  minReleaseAgeDays?: number;
  maxPublishLookups?: number;
  now?: Date;
  /** Injectable for tests; defaults to the npm registry client. */
  fetchVersionInfo?: (name: string, version: string) => Promise<VersionRegistryInfo | undefined>;
}

/**
 * Heuristic supply-chain signals over the installed dependency graph — informational, not
 * verdicts: (1) packages declaring install-time lifecycle hooks (the mechanism npm worms run
 * on `npm install`; many legitimate packages have one, e.g. native-binary downloaders), and
 * (2) package versions published within the last N days (fresh versions are where a hijacked
 * maintainer account does its damage before an advisory exists), (3) a version published without
 * provenance when the previous version had it, and (4) a version published by a different npm
 * account than the previous one — both common traces of a stolen token or account. Registry facts cost a full
 * packument fetch each, so only direct dependencies and install-script packages are looked up,
 * capped; anything not looked up is reported as not-checked rather than assumed old.
 */
export async function analyzeSupplyChainSignals(
  cwd: string,
  graph: DependencyGraph | null,
  options: SupplyChainOptions = {}
): Promise<SupplyChainSignals> {
  const minAgeDays = options.minReleaseAgeDays ?? DEFAULT_MIN_RELEASE_AGE_DAYS;
  const empty: SupplyChainSignals = {
    scanned: false,
    installScripts: [],
    recentlyPublished: [],
    provenanceRegressions: [],
    publisherChanges: [],
    releaseAge: { minAgeDays, checked: 0, notChecked: {} },
  };
  if (!graph) return empty;

  const packages = collectAllPackageVersions(graph);

  const installScripts: InstallScriptFinding[] = [];
  for (const pkg of packages) {
    const hooks = readInstallScriptHooks(cwd, pkg.name);
    if (hooks && hooks.length > 0) {
      installScripts.push({ package: pkg.name, version: pkg.version, hooks, direct: pkg.direct });
    }
  }

  const scriptKeys = new Set(installScripts.map((s) => `${s.package}@${s.version}`));
  const candidates = [
    ...packages.filter((p) => scriptKeys.has(`${p.name}@${p.version}`)),
    ...packages.filter((p) => p.direct && !scriptKeys.has(`${p.name}@${p.version}`)),
  ];

  const notChecked: Partial<Record<ReleaseAgeNotCheckedReason, number>> = {};
  const bump = (reason: ReleaseAgeNotCheckedReason, n = 1): void => {
    notChecked[reason] = (notChecked[reason] ?? 0) + n;
  };

  const recentlyPublished: RecentlyPublishedFinding[] = [];
  const provenanceRegressions: ProvenanceRegressionFinding[] = [];
  const publisherChanges: PublisherChangeFinding[] = [];
  let checked = 0;

  if (minAgeDays === 0) {
    // Turned off by the user — not a failed check, so nothing is reported as not-checked.
  } else if (isOffline() && !options.fetchVersionInfo) {
    bump('offline', candidates.length);
  } else {
    const cap = options.maxPublishLookups ?? DEFAULT_MAX_PUBLISH_LOOKUPS;
    const queue = candidates.slice(0, cap);
    if (candidates.length > cap) bump('lookup_cap', candidates.length - cap);

    const lookup = options.fetchVersionInfo ?? fetchVersionRegistryInfo;
    const nowMs = (options.now ?? new Date()).getTime();

    const worker = async (): Promise<void> => {
      for (let pkg = queue.shift(); pkg; pkg = queue.shift()) {
        const info = await lookup(pkg.name, pkg.version);
        if (!info) {
          bump('lookup_failed');
          continue;
        }
        checked++;
        if (info.publishedAt) {
          const ageDays = Math.floor((nowMs - info.publishedAt.getTime()) / MS_PER_DAY);
          if (ageDays < minAgeDays) {
            recentlyPublished.push({
              package: pkg.name,
              version: pkg.version,
              publishedAt: info.publishedAt.toISOString(),
              ageDays: Math.max(ageDays, 0),
              direct: pkg.direct,
            });
          }
        }
        const { previous } = info;
        if (previous) {
          if (previous.hasProvenance && !info.hasProvenance) {
            provenanceRegressions.push({ package: pkg.name, version: pkg.version, previousVersion: previous.version, direct: pkg.direct });
          }
          if (info.publisher && previous.publisher && info.publisher !== previous.publisher) {
            publisherChanges.push({
              package: pkg.name,
              version: pkg.version,
              previousVersion: previous.version,
              publisher: info.publisher,
              previousPublisher: previous.publisher,
              direct: pkg.direct,
            });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  const byName = (a: { package: string }, b: { package: string }): number => a.package.localeCompare(b.package);
  return {
    scanned: true,
    installScripts: installScripts.sort(byName),
    recentlyPublished: recentlyPublished.sort(byName),
    provenanceRegressions: provenanceRegressions.sort(byName),
    publisherChanges: publisherChanges.sort(byName),
    releaseAge: { minAgeDays, checked, notChecked },
  };
}
