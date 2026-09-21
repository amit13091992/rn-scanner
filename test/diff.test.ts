import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffCommand } from '../src/commands/diff.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'diff-test-'));
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

function writeProject(dir: string, deps: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: deps }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app' },
        ...Object.fromEntries(Object.entries(deps).map(([name, version]) => [`node_modules/${name}`, { version }])),
      },
    })
  );
}

test('diffCommand - reports added, removed, and changed packages between two project directories', async () => {
  const fromDir = makeTempDir();
  const toDir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeProject(fromDir, { foo: '1.0.0', bar: '1.0.0' });
    writeProject(toDir, { foo: '2.0.0', baz: '1.0.0' });

    const { output } = await captureStdout(() => diffCommand({ from: fromDir, to: toDir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.added, [{ name: 'baz', version: '1.0.0' }]);
    assert.deepEqual(result.removed, [{ name: 'bar', version: '1.0.0' }]);
    assert.deepEqual(result.changed, [{ name: 'foo', fromVersion: '1.0.0', toVersion: '2.0.0' }]);
    assert.equal(result.security.scanned, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(fromDir);
    cleanup(toDir);
  }
});

test('diffCommand - no changes between identical directories reports empty diff', async () => {
  const fromDir = makeTempDir();
  const toDir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeProject(fromDir, { foo: '1.0.0' });
    writeProject(toDir, { foo: '1.0.0' });

    const { output } = await captureStdout(() => diffCommand({ from: fromDir, to: toDir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.changed, []);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(fromDir);
    cleanup(toDir);
  }
});
