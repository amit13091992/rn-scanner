import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unusedCommand } from '../src/commands/unused.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'unused-test-'));
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

test('unusedCommand - flags a declared dependency never required/imported from source, while skipping the one that is used', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { 'left-pad': '1.3.0', 'never-imported': '1.0.0' } })
    );
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), "const leftPad = require('left-pad');\nconsole.log(leftPad);\n");

    const { output } = await captureStdout(() => unusedCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.unused.map((u: { name: string }) => u.name), ['never-imported']);
    assert.equal(result.filesScanned, 1);
  } finally {
    cleanup(dir);
  }
});

test('unusedCommand - excludes known tooling-only packages instead of flagging them as unused', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', devDependencies: { eslint: '8.0.0', typescript: '5.0.0' } })
    );

    const { output } = await captureStdout(() => unusedCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.unused, []);
    assert.deepEqual(result.excludedAsTooling.sort(), ['eslint', 'typescript']);
  } finally {
    cleanup(dir);
  }
});
