import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeCommand } from '../src/commands/native.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'native-test-'));
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

test('nativeCommand - reports android/ios environment requirements and an overall verdict', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'react-native': '0.87.0' } }));

    const { output } = await captureStdout(() => nativeCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.reactNative, '0.87.0');
    assert.ok(Array.isArray(result.android));
    assert.ok(Array.isArray(result.ios));
    assert.ok(['READY', 'WARN', 'BLOCKED'].includes(result.verdict));
  } finally {
    cleanup(dir);
  }
});

test('nativeCommand - no React Native version detected reports an error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output, exitCode } = await captureStdout(() => nativeCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.ok(result.error.includes('not detected'));
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});
