import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleCommand } from '../src/commands/bundle.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bundle-test-'));
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

test('bundleCommand - reports on-disk size per direct dependency, largest first, excluding devDependencies', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { big: '1.0.0', small: '1.0.0' }, devDependencies: { 'dev-only': '1.0.0' } }));
    mkdirSync(join(dir, 'node_modules', 'big'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'small'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'dev-only'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'big', 'index.js'), 'x'.repeat(2000));
    writeFileSync(join(dir, 'node_modules', 'small', 'index.js'), 'x'.repeat(10));
    writeFileSync(join(dir, 'node_modules', 'dev-only', 'index.js'), 'x'.repeat(5000));

    const { output } = await captureStdout(() => bundleCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.packages.map((p: { name: string }) => p.name), ['big', 'small']);
    assert.ok(result.packages[0].sizeBytes >= 2000);
    assert.ok(result.packages[1].sizeBytes >= 10);
    assert.equal(result.totalBytes, result.packages[0].sizeBytes + result.packages[1].sizeBytes);
  } finally {
    cleanup(dir);
  }
});
