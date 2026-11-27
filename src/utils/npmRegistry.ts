import { fetchWithTimeout } from './network.js';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const CONCURRENCY = 10;

/**
 * Looks up the single latest published version for one package (npm's `dist-tags.latest`,
 * via the `/latest` endpoint). Exported for callers that need just one package resolved
 * (e.g. `upgrade --latest` resolving react-native's own current stable) without paying for
 * `fetchLatestVersions`' batch/dedup machinery built for many package names at once.
 */
export async function fetchLatestVersion(name: string): Promise<string | undefined> {
  const response = await fetchWithTimeout(`${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}/latest`);
  if (!response) return undefined;
  try {
    const data = (await response.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  }
}

/**
 * Looks up the latest published version for each package name from the npm registry.
 * Failures (network errors, unpublished/private packages, timeouts) resolve to a
 * missing entry rather than throwing, so one bad lookup never fails the whole batch.
 */
export async function fetchLatestVersions(
  names: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const queue = [...new Set(names)];

  async function worker() {
    while (queue.length > 0) {
      const name = queue.shift();
      if (!name) break;
      const version = await fetchLatestVersion(name);
      if (version) results.set(name, version);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker);
  await Promise.all(workers);

  return results;
}

/**
 * Fetches every published version string for a single package (the full packument's
 * `versions` map, keys only) — needed to pick the highest version *within a specific major
 * line* (e.g. "the latest 3.x", not npm's absolute latest), which `/latest` alone can't answer.
 * Deliberately scoped to callers that already know they need this (recommended-update
 * resolution for a small set of packages with compatibility data), not every outdated check —
 * the full packument is much larger than `/latest` and shouldn't be fetched for every dependency.
 */
export async function fetchAllVersions(name: string): Promise<string[] | undefined> {
  const response = await fetchWithTimeout(`${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}`);
  if (!response) return undefined;
  try {
    const data = (await response.json()) as { versions?: Record<string, unknown> };
    return data.versions ? Object.keys(data.versions) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * When one specific version of a package was published (the full packument's `time[version]`).
 * Uses the full packument because the abbreviated install document carries no per-version
 * times, so it can be large — callers should limit this to packages that justify the cost.
 * Resolves to undefined on any failure (offline, unpublished/private package, bad JSON).
 */
export async function fetchVersionPublishTime(name: string, version: string): Promise<Date | undefined> {
  const response = await fetchWithTimeout(`${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}`);
  if (!response) return undefined;
  try {
    const data = (await response.json()) as { time?: Record<string, string> };
    const published = data.time?.[version];
    const parsed = published ? new Date(published) : undefined;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
