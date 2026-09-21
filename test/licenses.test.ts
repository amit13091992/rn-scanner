import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licensesCommand } from '../src/commands/licenses.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'licenses-test-'));
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

function writeProject(dir: string, license: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'copyleft-pkg': '1.0.0' } }));
  mkdirSync(join(dir, 'node_modules', 'copyleft-pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'copyleft-pkg', 'package.json'), JSON.stringify({ name: 'copyleft-pkg', version: '1.0.0', license }));
}

test('licensesCommand - flags a package matching the configured denylist and exits 1', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, 'GPL-3.0');
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ licenseDenylist: ['gpl-3.0'] }));

    const { output, exitCode } = await captureStdout(() => licensesCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.denied.length, 1);
    assert.equal(result.denied[0].name, 'copyleft-pkg');
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});

test('licensesCommand - an MIT package with no denylist configured is not flagged', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, 'MIT');

    const { output, exitCode } = await captureStdout(() => licensesCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.denied, []);
    assert.equal(exitCode, undefined);
  } finally {
    cleanup(dir);
  }
});
