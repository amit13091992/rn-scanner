import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchCommand } from '../src/commands/watch.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'watch-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function captureStdout(fn: () => Promise<void>): Promise<{ output: string }> {
  const originalLog = console.log;
  let output = '';
  console.log = (msg?: unknown) => {
    output += `${String(msg)}\n`;
  };
  return fn().then(() => ({ output })).finally(() => {
    console.log = originalLog;
  });
}

test('watchCommand - runs the requested number of json-mode cycles and returns (bounded via iterations)', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output } = await captureStdout(() => watchCommand({ cwd: dir, json: true, iterations: 2, interval: 0 }));
    const cycleCount = (output.match(/"packageManager"/g) ?? []).length;

    // Two check cycles ran (each check --json prints one full result object) rather than looping forever.
    assert.equal(cycleCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});
