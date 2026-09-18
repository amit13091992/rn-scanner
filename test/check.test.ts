import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCommand } from '../src/commands/check.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'check-test-'));
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

function writeProject(dir: string, dependencies: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-app', dependencies }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: Object.fromEntries(
        Object.entries(dependencies).map(([name, version]) => [`node_modules/${name}`, { version }])
      ),
    })
  );
}

test('checkCommand - json output reports the detected react-native/react versions and dependency list', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, { 'react-native': '0.75.0', react: '18.3.1', 'left-pad': '1.3.0' });

    const { output } = await captureStdout(() => checkCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.reactNative.current, '0.75.0');
    assert.equal(result.react.current, '18.3.1');
    assert.equal(result.packageManager, 'npm');
    assert.ok(result.dependencies.some((d: { name: string }) => d.name === 'left-pad'));
  } finally {
    cleanup(dir);
  }
});

test('checkCommand - a package listed in .rn-dep-scanner.json ignorePackages is excluded from the dependency list', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, { 'react-native': '0.75.0', react: '18.3.1', 'noisy-pkg': '1.0.0' });
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ignorePackages: ['noisy-pkg'] }));

    const { output } = await captureStdout(() => checkCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.dependencies.some((d: { name: string }) => d.name === 'noisy-pkg'), false);
    assert.deepEqual(result.config.ignoredPackages, ['noisy-pkg']);
  } finally {
    cleanup(dir);
  }
});

test('checkCommand - surfaces a malformed .rn-dep-scanner.json as a config warning without failing the scan', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, { 'react-native': '0.75.0', react: '18.3.1' });
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ignorePackages: 'not-an-array' }));

    const { output } = await captureStdout(() => checkCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.ok(result.config.warnings[0].includes('ignorePackages'));
  } finally {
    cleanup(dir);
  }
});

test('checkCommand - --profile includes a per-step timing breakdown in json output', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, { 'react-native': '0.75.0', react: '18.3.1' });

    const { output } = await captureStdout(() => checkCommand({ cwd: dir, json: true, profile: true }));
    const result = JSON.parse(output);

    assert.ok(Array.isArray(result.profile.steps));
    assert.ok(result.profile.steps.length > 0);
    assert.equal(typeof result.profile.totalMs, 'number');
  } finally {
    cleanup(dir);
  }
});

test('checkCommand - a fatal error (unreadable package.json) reports json error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    // No package.json written at all - readPackageJson throws.
    const { output, exitCode } = await captureStdout(() => checkCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.ok(result.error.includes('Fatal error'));
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});
