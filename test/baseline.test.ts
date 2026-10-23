import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
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
    assert.ok(existsSync(join(dir, '.rn-preflight-baseline.json')));
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

function mockOsv(ids: string[]): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('querybatch')) {
      return { ok: true, json: async () => ({ results: [{ vulns: ids.map((id) => ({ id })) }] }) } as Response;
    }
    const id = ids.find((i) => u.includes(`/vulns/${i}`)) ?? 'x';
    return {
      ok: true,
      json: async () => ({
        id,
        summary: `Advisory ${id}`,
        database_specific: { severity: 'HIGH' },
        affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
        references: [],
      }),
    } as Response;
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function writeLodashProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { lodash: '4.17.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { name: 'app', dependencies: { lodash: '4.17.0' } }, 'node_modules/lodash': { version: '4.17.0' } },
    })
  );
}

test('baselineCommand - reports new, still-present and resolved findings with severity detail', async () => {
  const dir = makeTempDir();
  let restore = mockOsv(['GHSA-old']);
  try {
    writeLodashProject(dir);
    const created = JSON.parse((await captureStdout(() => baselineCommand({ cwd: dir, json: true, create: true }))).output);
    assert.equal(created.entries, 1);
    assert.equal(created.bySeverity.high, 1);

    restore();
    restore = mockOsv(['GHSA-old', 'GHSA-new']);
    const checked = await captureStdout(() => baselineCommand({ cwd: dir, json: true }));
    const result = JSON.parse(checked.output);
    assert.equal(result.summary.new, 1);
    assert.equal(result.summary.unchanged, 1);
    assert.equal(result.summary.resolved, 0);
    assert.equal(result.summary.newBySeverity.high, 1);
    assert.equal(checked.exitCode, 1);

    restore();
    restore = mockOsv([]);
    const fixed = JSON.parse((await captureStdout(() => baselineCommand({ cwd: dir, json: true }))).output);
    assert.equal(fixed.summary.resolved, 1);
    assert.equal(fixed.resolved[0].id, 'GHSA-old');
    assert.equal(fixed.summary.new, 0);
  } finally {
    restore();
    cleanup(dir);
  }
});

test('baselineCommand - fails closed instead of passing or writing an empty baseline when the scan cannot run', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  try {
    writeLodashProject(dir);
    const { output, exitCode } = await captureStdout(() => baselineCommand({ cwd: dir, json: true, create: true }));
    assert.equal(JSON.parse(output).scanned, false);
    assert.equal(exitCode, 1);
    assert.equal(existsSync(join(dir, '.rn-preflight-baseline.json')), false);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('baselineCommand - a corrupt baseline file is reported clearly on check and replaced by --create', async () => {
  const dir = makeTempDir();
  const restore = mockOsv([]);
  try {
    writeLodashProject(dir);
    const path = join(dir, '.rn-preflight-baseline.json');
    writeFileSync(path, '<<<<<<< HEAD\n{"entries": [');
    const checked = await captureStdout(() => baselineCommand({ cwd: dir, json: true }));
    assert.match(JSON.parse(checked.output).error, /unreadable/);
    assert.equal(checked.exitCode, 1);

    const created = JSON.parse((await captureStdout(() => baselineCommand({ cwd: dir, json: true, create: true }))).output);
    assert.equal(created.created, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf-8')).entries, []);
  } finally {
    restore();
    cleanup(dir);
  }
});

test('baselineCommand - an existing pre-rename .rn-dep-scanner-baseline.json keeps being read and updated in place', async () => {
  const dir = makeTempDir();
  const restore = mockOsv(['GHSA-old']);
  try {
    writeLodashProject(dir);
    const legacy = join(dir, '.rn-dep-scanner-baseline.json');
    writeFileSync(legacy, JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', entries: ['lodash@4.17.0:GHSA-old'] }));
    const checked = JSON.parse((await captureStdout(() => baselineCommand({ cwd: dir, json: true }))).output);
    assert.equal(checked.summary.unchanged, 1);
    assert.equal(checked.summary.new, 0);

    await captureStdout(() => baselineCommand({ cwd: dir, json: true, create: true }));
    assert.equal(existsSync(join(dir, '.rn-preflight-baseline.json')), false);
    assert.equal(JSON.parse(readFileSync(legacy, 'utf-8')).entries.length, 1);
  } finally {
    restore();
    cleanup(dir);
  }
});
