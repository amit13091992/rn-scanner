const REGISTRY_BASE = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 5000;
const CONCURRENCY = 10;

async function fetchLatestVersion(name: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}/latest`,
      { signal: controller.signal }
    );
    if (!response.ok) return undefined;

    const data = (await response.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${REGISTRY_BASE}/${encodeURIComponent(name).replace('%40', '@')}`,
      { signal: controller.signal }
    );
    if (!response.ok) return undefined;

    const data = (await response.json()) as { versions?: Record<string, unknown> };
    return data.versions ? Object.keys(data.versions) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
