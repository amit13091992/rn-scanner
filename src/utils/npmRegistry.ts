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
