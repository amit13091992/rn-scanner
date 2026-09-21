import { checkCommand } from './check.js';
import { printHeader, printInfo } from '../utils/terminal.js';
import type { HtmlOption } from '../utils/htmlOutput.js';

export interface WatchOptions {
  cwd?: string;
  json?: boolean;
  html?: HtmlOption;
  /** Seconds between scans. Default 300 (5 minutes). */
  interval?: number;
  /** Internal/testing only — number of scan cycles to run before returning instead of looping
   *  forever. Not exposed as a CLI flag; real usage runs until the process is interrupted. */
  iterations?: number;
}

const DEFAULT_INTERVAL_SECONDS = 300;

/**
 * Runs `check` repeatedly on a fixed interval until interrupted (Ctrl+C) — continuous
 * monitoring for a long-running terminal/CI job, rather than a one-shot scan. Each cycle runs
 * with `--no-strict` regardless of what a caller might expect from `check` directly: a failed
 * cycle shouldn't kill the watch loop itself, only be visible in that cycle's own output.
 */
export async function watchCommand(options: WatchOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  const intervalSeconds = options.interval ?? DEFAULT_INTERVAL_SECONDS;
  const iterations = options.iterations ?? Infinity;

  for (let i = 0; i < iterations; i++) {
    if (!jsonMode) {
      printHeader(`Watch — scan ${i + 1} — ${new Date().toISOString()}`);
    }

    await checkCommand({ cwd, json: options.json, html: options.html, security: true, strict: false });

    if (i + 1 < iterations) {
      if (!jsonMode) {
        printInfo(`Next scan in ${intervalSeconds}s (Ctrl+C to stop)`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    }
  }
}
