const DEFAULT_TIMEOUT_MS = 8000;

/** Reads `RN_PREFLIGHT_<name>`, falling back to the pre-rename `RN_DEP_SCANNER_<name>`. */
export function readEnv(name: string): string | undefined {
  return process.env[`RN_PREFLIGHT_${name}`] ?? process.env[`RN_DEP_SCANNER_${name}`];
}

/** Per-request network timeout; `RN_PREFLIGHT_TIMEOUT_MS` (or `--timeout <ms>`) overrides the default. */
export function networkTimeoutMs(fallback: number = DEFAULT_TIMEOUT_MS): number {
  const parsed = Number.parseInt(readEnv('TIMEOUT_MS') ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** True when `--offline` / `RN_PREFLIGHT_OFFLINE=1` asks for no network calls at all. */
export function isOffline(): boolean {
  const v = readEnv('OFFLINE');
  return v === '1' || v === 'true';
}

let failedRequests = 0;
export function recordNetworkFailure(): void {
  failedRequests++;
}
export function networkFailureCount(): number {
  return failedRequests;
}

/**
 * fetch with a hard timeout and an offline short-circuit. Resolves to null (never throws) on
 * offline mode, timeout, network error or a non-2xx response, so callers degrade instead of
 * crashing; every null caused by a real attempt is counted for the "N lookups failed" notice.
 */
export async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs: number = networkTimeoutMs()): Promise<Response | null> {
  if (isOffline()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      recordNetworkFailure();
      return null;
    }
    return response;
  } catch {
    recordNetworkFailure();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
