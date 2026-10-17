import { checkCommand } from './check.js';
import { printHeader, printInfo, printWarning } from '../utils/terminal.js';
import { runCapturingExit } from '../utils/workspaceRun.js';
import type { HtmlOption } from '../utils/htmlOutput.js';

export interface WatchOptions {
  cwd?: string;
  json?: boolean;
  html?: HtmlOption;
  /** Seconds between scans. Default 300 (5 minutes). */
  interval?: number;
  /** Number of scan cycles to run before returning (`--once` = 1, `--iterations <n>`). Omitted
   *  = run until interrupted. */
  iterations?: number;
}

const DEFAULT_INTERVAL_SECONDS = 300;

/**
 * Runs `check` repeatedly on a fixed interval until interrupted (Ctrl+C) or until `iterations`
 * scans have run (`--once` / `--iterations <n>`) — continuous monitoring for a long-running
 * terminal/CI job. Each cycle runs non-strict and with process.exit captured: a failed cycle
 * is reported and retried next cycle rather than ending the watch.
 */
export async function watchCommand(options: WatchOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  const intervalSeconds =
    options.interval !== undefined && Number.isFinite(options.interval) && options.interval >= 0
      ? options.interval
      : DEFAULT_INTERVAL_SECONDS;
  const iterations = options.iterations && options.iterations > 0 ? options.iterations : Infinity;

  let stopped = false;
  let wake: (() => void) | undefined;
  const onSigint = () => {
    stopped = true;
    wake?.();
  };
  // SIGBREAK is Ctrl+Break on Windows; SIGTERM covers service managers and containers.
  const stopSignals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK', 'SIGTERM'] : ['SIGINT', 'SIGTERM'];
  stopSignals.forEach((sig) => process.once(sig, onSigint));

  try {
    for (let i = 0; i < iterations && !stopped; i++) {
      if (!jsonMode) {
        printHeader(`Watch — scan ${i + 1} — ${new Date().toISOString()}`);
      }

      // A failed cycle (network error, unreadable lockfile) calls process.exit inside
      // checkCommand — capture it so one bad cycle doesn't silently end the whole watch.
      const { output, exitCode } = await runCapturingExit(() =>
        checkCommand({ cwd, json: options.json, html: options.html, security: true, strict: false })
      );
      if (output) console.log(output.replace(/\n$/, ''));
      if (exitCode && !jsonMode) {
        printWarning(`Scan ${i + 1} ended with exit code ${exitCode} — will retry on the next cycle`);
      }

      if (i + 1 >= iterations || stopped) break;
      await waitWithCountdown(intervalSeconds, jsonMode, (resolve) => {
        wake = resolve;
      });
    }
  } finally {
    stopSignals.forEach((sig) => process.removeListener(sig, onSigint));
  }

  if (!jsonMode) {
    printInfo(stopped ? 'Watch stopped.' : `Watch finished after ${iterations} scan(s).`);
  }
}

async function waitWithCountdown(
  seconds: number,
  quiet: boolean,
  registerWake: (resolve: () => void) => void
): Promise<void> {
  if (seconds <= 0) return;
  const interactive = !quiet && process.stdout.isTTY;
  let remaining = seconds;
  if (!quiet && !interactive) {
    printInfo(`Next scan in ${seconds}s (Ctrl+C to stop)`);
  }

  await new Promise<void>((resolve) => {
    registerWake(() => {
      clearInterval(timer);
      resolve();
    });
    const timer = setInterval(() => {
      remaining--;
      if (interactive) {
        process.stdout.write(`\rNext scan in ${remaining}s (Ctrl+C to stop)   `);
      }
      if (remaining <= 0) {
        clearInterval(timer);
        resolve();
      }
    }, 1000);
    if (interactive) {
      process.stdout.write(`\rNext scan in ${remaining}s (Ctrl+C to stop)   `);
    }
  });

  if (interactive) process.stdout.write('\n');
}
