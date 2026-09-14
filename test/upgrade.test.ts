import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upgradeCommand } from '../src/commands/upgrade.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'upgrade-test-'));
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

function writeProject(dir: string, rnVersion: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'test-app',
      dependencies: {
        'react-native': rnVersion,
        react: '18.2.0',
      },
    })
  );
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      name: 'test-app',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'react-native': rnVersion, react: '18.2.0' } },
        'node_modules/react-native': { version: rnVersion },
        'node_modules/react': { version: '18.2.0' },
      },
    })
  );
}

test('upgradeCommand - json output includes risk and all sections for an RN 0.72 -> 0.75 upgrade', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.72.0');
    const { output } = await captureStdout(() =>
      upgradeCommand('0.75', { json: true, cwd: dir })
    );
    const parsed = JSON.parse(output);
    assert.equal(parsed.to, '0.75');
    assert.ok(['low', 'medium', 'high'].includes(parsed.risk));
    assert.ok(Array.isArray(parsed.breakingChanges));
    assert.ok(Array.isArray(parsed.androidEnvironment));
    assert.ok(Array.isArray(parsed.iosEnvironment));
    assert.ok('newArchitecture' in parsed);
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - target version with mandatory New Architecture flags bridge removal', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.75.0');
    const { output } = await captureStdout(() =>
      upgradeCommand('0.82', { json: true, cwd: dir })
    );
    const parsed = JSON.parse(output);
    assert.equal(parsed.newArchitecture.isDefaultAtTarget, true);
    assert.equal(parsed.newArchitecture.isBridgeRemovedAtTarget, true);
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - human output prints a header and risk line', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.72.0');
    const { output } = await captureStdout(() => upgradeCommand('0.75', { cwd: dir }));
    assert.match(output, /Upgrade Readiness/);
    assert.match(output, /Risk:/);
    assert.match(output, /Breaking Changes/);
    assert.match(output, /New Architecture/);
    assert.match(output, /Android Environment/);
    assert.match(output, /iOS Environment/);
  } finally {
    cleanup(dir);
  }
});
