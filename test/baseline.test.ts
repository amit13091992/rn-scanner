import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineCommand } from '../src/commands/baseline.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'baseline-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function captureStdout(fn: () => Promise<void>): Promise<{ output: string; exitCode?: number }> {
  const originalLog = console.log;
  const originalExit = process.exit;
  let output = '';
  let exitCode: number | undefined;
  console.log = (msg?: unknown) => {
    output += `${String(msg)}\n`;
  };
  // @ts-expect-error - stub process.exit for the duration of the test
  process.exit = (code?: number) => {
    exitCode = code;
    throw new Error('__process_exit__');
  };
  return fn()
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== '__process_exit__') throw err;
    })
    .then(() => ({ output, exitCode }))
    .finally(() => {
      console.log = originalLog;
      process.exit = originalExit;
    });
}

test('baselineCommand - --create writes a baseline file and reports success', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output } = await captureStdout(() => baselineCommand({ cwd: dir, json: true, create: true }));
    const result = JSON.parse(output);

    assert.equal(result.created, true);
    assert.ok(existsSync(join(dir, '.rn-dep-scanner-baseline.json')));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('baselineCommand - without a baseline file reports an error and exits 1', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output, exitCode } = await captureStdout(() => baselineCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.ok(result.error.includes('No baseline found'));
    assert.equal(exitCode, 1);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});
