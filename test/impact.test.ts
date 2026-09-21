import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { impactCommand } from '../src/commands/impact.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'impact-test-'));
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

test('impactCommand - reports currentVersion, a root-declared conflict, and a reverse dependent from the graph', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { foo: '1.0.0' } }));
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app' },
          'node_modules/foo': { version: '1.0.0' },
        },
      })
    );
    mkdirSync(join(dir, 'node_modules', 'foo'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'foo', 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0' }));

    const { output } = await captureStdout(() => impactCommand('foo', '2.0.0', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.currentVersion, '1.0.0');
    assert.equal(result.targetVersion, '2.0.0');
    // Root package.json still declares "1.0.0" (exact pin) — upgrading to 2.0.0 conflicts with it.
    assert.ok(result.blockers.some((b: { requiredBy: string }) => b.requiredBy === 'package.json'));
    assert.deepEqual(result.reverseDependents, ['your-app']);
    assert.ok(result.recommendedActions.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('impactCommand - a package not currently installed is evaluated as a new install rather than throwing', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output } = await captureStdout(() => impactCommand('never-installed', '1.0.0', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.currentVersion, null);
    assert.deepEqual(result.reverseDependents, []);
  } finally {
    cleanup(dir);
  }
});
