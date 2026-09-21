import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { architectureCommand } from '../src/commands/architecture.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'architecture-test-'));
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

test('architectureCommand - reports New Architecture as mandatory for a bridge-removed RN version', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'react-native': '0.87.0' } }));

    const { output } = await captureStdout(() => architectureCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.status.isBridgeRemoved, true);
    assert.equal(result.status.isNewArchDefault, true);
  } finally {
    cleanup(dir);
  }
});
