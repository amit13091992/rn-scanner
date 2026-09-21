import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { policyCommand } from '../src/commands/policy.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'policy-test-'));
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

test('policyCommand - flags a banned package and exits 1', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'banned-pkg': '1.0.0' } }));
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ bannedPackages: ['banned-pkg'] }));

    const { output, exitCode } = await captureStdout(() => policyCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].rule, 'bannedPackages');
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});

test('policyCommand - no rules configured passes trivially with rulesConfigured: 0', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

    const { output, exitCode } = await captureStdout(() => policyCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.passed, true);
    assert.equal(result.rulesConfigured, 0);
    assert.equal(exitCode, undefined);
  } finally {
    cleanup(dir);
  }
});
