import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorCommand } from '../src/commands/doctor.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'doctor-test-'));
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

test('doctorCommand - json output includes a READY/WARN/BLOCKED verdict', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { 'react-native': '0.75.0', react: '18.2.0' } }),
    );
    const { output } = await captureStdout(() => doctorCommand({ json: true, cwd: dir }));
    const parsed = JSON.parse(output);
    assert.ok(['READY', 'WARN', 'BLOCKED'].includes(parsed.verdict));
    assert.ok(Array.isArray(parsed.nodeEnvironment));
  } finally {
    cleanup(dir);
  }
});

test('doctorCommand - human output prints a verdict line', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { 'react-native': '0.75.0', react: '18.2.0' } }),
    );
    const { output } = await captureStdout(() => doctorCommand({ cwd: dir }));
    assert.match(output, /Verdict:/);
    assert.match(output, /Node\.js Environment/);
  } finally {
    cleanup(dir);
  }
});

test('doctorCommand - --all-workspaces aggregates the verdict across every workspace package', async () => {
  const root = makeTempDir();
  try {
    const { mkdirSync } = await import('node:fs');
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0' }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', dependencies: { 'react-native': '0.75.0', react: '18.3.1' } }));

    const { output } = await captureStdout(() => doctorCommand({ cwd: appDir, json: true, allWorkspaces: true }));
    const result = JSON.parse(output);

    assert.equal(result.workspaces.length, 2);
    const mobileApp = result.workspaces.find((w: { package: string }) => w.package === 'mobile-app');
    assert.equal(mobileApp.reactNative.version, '0.75.0');
  } finally {
    cleanup(root);
  }
});
