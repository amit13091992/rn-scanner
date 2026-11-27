import semver from 'semver';
import { fetchWithTimeout, isOffline, networkTimeoutMs } from './network.js';

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

export interface NpmPackument {
  'dist-tags'?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, { deprecated?: string; scripts?: Record<string, unknown> }>;
}

export type PackumentLookup =
  | { status: 'found'; packument: NpmPackument }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/**
 * Looks up a full packument and — unlike the other helpers here, which fold every failure into
 * `undefined` — tells a registry 404 ("no such package") apart from a lookup that simply could
 * not be completed (offline, timeout, 5xx, bad JSON). `package_safety` needs the difference: a
 * missing package is a strong signal, an unreachable registry is no signal at all.
 */
export async function lookupPackument(name: string): Promise<PackumentLookup> {
  if (isOffline()) return { status: 'unavailable' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), networkTimeoutMs());
  try {
    const response = await fetch(`${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}`, {
      signal: controller.signal,
    });
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };
    return { status: 'found', packument: (await response.json()) as NpmPackument };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads in the last week from npm's public download-count API, or undefined if unavailable. */
export async function fetchWeeklyDownloads(name: string): Promise<number | undefined> {
  const response = await fetchWithTimeout(
    `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name).replace('%40', '@')}`
  );
  if (!response) return undefined;
  try {
    const data = (await response.json()) as { downloads?: unknown };
    return typeof data.downloads === 'number' ? data.downloads : undefined;
  } catch {
    return undefined;
  }
}

export interface PublishedVersionFacts {
  version: string;
  /** npm account that published this version (`_npmUser.name`); undefined when not recorded. */
  publisher: string | undefined;
  /** Whether the version carries a Sigstore provenance attestation (`dist.attestations`). */
  hasProvenance: boolean;
}

export interface VersionRegistryInfo extends PublishedVersionFacts {
  publishedAt: Date | undefined;
  /** Highest earlier stable version, for comparing who published it and whether it had provenance. */
  previous: PublishedVersionFacts | undefined;
}

type PackumentVersionEntry = { _npmUser?: { name?: string }; dist?: { attestations?: unknown } };

function factsOf(version: string, entry: PackumentVersionEntry | undefined): PublishedVersionFacts {
  return {
    version,
    publisher: typeof entry?._npmUser?.name === 'string' ? entry._npmUser.name : undefined,
    hasProvenance: entry?.dist?.attestations !== undefined && entry.dist.attestations !== null,
  };
}

/**
 * Registry facts about one version — publish time, publishing account, provenance — and the same
 * for the highest earlier stable version, from a single packument fetch. Resolves to undefined
 * when the packument or the version cannot be read (never a guessed "no provenance").
 */
export async function fetchVersionRegistryInfo(name: string, version: string): Promise<VersionRegistryInfo | undefined> {
  const response = await fetchWithTimeout(`${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}`);
  if (!response) return undefined;
  try {
    const data = (await response.json()) as { time?: Record<string, string>; versions?: Record<string, PackumentVersionEntry> };
    const entry = data.versions?.[version];
    if (!entry) return undefined;

    const published = data.time?.[version];
    const parsed = published ? new Date(published) : undefined;

    const earlier = Object.keys(data.versions ?? {})
      .filter((v) => semver.valid(v) && !semver.prerelease(v) && semver.lt(v, version))
      .sort(semver.rcompare)[0];

    return {
      ...factsOf(version, entry),
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined,
      previous: earlier ? factsOf(earlier, data.versions?.[earlier]) : undefined,
    };
  } catch {
    return undefined;
  }
}
