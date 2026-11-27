import { readInstallScriptHooks } from '../detectors/installScripts.js';
import { fetchVersionPublishTime } from '../utils/npmRegistry.js';
import { collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { isOffline } from '../utils/network.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import type {
  InstallScriptFinding,
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
  fetchPublishTime?: (name: string, version: string) => Promise<Date | undefined>;
}

/**
 * Heuristic supply-chain signals over the installed dependency graph — informational, not
 * verdicts: (1) packages declaring install-time lifecycle hooks (the mechanism npm worms run
 * on `npm install`; many legitimate packages have one, e.g. native-binary downloaders), and
 * (2) package versions published within the last N days (fresh versions are where a hijacked
 * maintainer account does its damage before an advisory exists). Publish times cost a full
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
  let checked = 0;

  if (isOffline() && !options.fetchPublishTime) {
    bump('offline', candidates.length);
  } else {
    const cap = options.maxPublishLookups ?? DEFAULT_MAX_PUBLISH_LOOKUPS;
    const queue = candidates.slice(0, cap);
    if (candidates.length > cap) bump('lookup_cap', candidates.length - cap);

    const lookup = options.fetchPublishTime ?? fetchVersionPublishTime;
    const nowMs = (options.now ?? new Date()).getTime();

    const worker = async (): Promise<void> => {
      for (let pkg = queue.shift(); pkg; pkg = queue.shift()) {
        const published = await lookup(pkg.name, pkg.version);
        if (!published) {
          bump('lookup_failed');
          continue;
        }
        checked++;
        const ageDays = Math.floor((nowMs - published.getTime()) / MS_PER_DAY);
        if (ageDays < minAgeDays) {
          recentlyPublished.push({
            package: pkg.name,
            version: pkg.version,
            publishedAt: published.toISOString(),
            ageDays: Math.max(ageDays, 0),
            direct: pkg.direct,
          });
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
    releaseAge: { minAgeDays, checked, notChecked },
  };
}
