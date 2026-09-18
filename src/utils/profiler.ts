export interface ProfileEntry {
  label: string;
  durationMs: number;
}

/**
 * Opt-in step timer for a command run. Disabled by default so normal runs pay zero overhead;
 * `time()` becomes a plain pass-through when `enabled` is false rather than a no-op wrapper,
 * so callers don't need their own `if (profile)` branching around every step. Timing is by
 * wall-clock label only — it has no knowledge of package manager or project type, so it works
 * identically whether the repo is npm/yarn/pnpm/bun, RN, or Expo.
 */
export class Profiler {
  private readonly entries: ProfileEntry[] = [];

  constructor(private readonly enabled: boolean) {}

  async time<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    if (!this.enabled) return fn();
    const start = performance.now();
    const result = await fn();
    this.entries.push({ label, durationMs: performance.now() - start });
    return result;
  }

  /** Recorded steps, slowest first. Empty when the profiler is disabled. */
  report(): ProfileEntry[] {
    return [...this.entries].sort((a, b) => b.durationMs - a.durationMs);
  }

  totalMs(): number {
    return this.entries.reduce((sum, e) => sum + e.durationMs, 0);
  }
}
