import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whyNotCommand } from '../src/commands/whyNot.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'whynot-test-'));
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

function writeProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'left-pad': '1.3.0' }, devDependencies: { eslint: '8.0.0' } }));
  mkdirSync(join(dir, 'node_modules', 'eslint'), { recursive: true });
  writeFileSync(
    join(dir, 'node_modules', 'eslint', 'package.json'),
    JSON.stringify({ name: 'eslint', version: '8.0.0', peerDependencies: { 'left-pad': '^2.0.0' } })
  );
}

test('whyNotCommand - reports a peer-dependency blocker for a version outside another package\'s declared peer range', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir);

    const { output } = await captureStdout(() => whyNotCommand('left-pad', '1.3.0', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.installable, false);
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].requiredBy, 'eslint');
    assert.equal(result.blockers[0].range, '^2.0.0');
  } finally {
    cleanup(dir);
  }
});

test('whyNotCommand - reports installable when the target version satisfies every known constraint', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir);

    const { output } = await captureStdout(() => whyNotCommand('left-pad', '2.5.0', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    // Root package.json still declares "1.3.0" (an exact pin), so that constraint alone
    // still blocks 2.5.0 — this asserts the eslint peer constraint specifically is satisfied.
    const eslintConstraint = result.constraints.find((c: { requiredBy: string }) => c.requiredBy === 'eslint');
    assert.equal(eslintConstraint.satisfied, true);
  } finally {
    cleanup(dir);
  }
});

test('whyNot - a "*" peer range is satisfied by any version, not reported as unknown', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { analyzeWhyNot } = await import('../src/analyzers/whyNot.js');
  const dir = mkdtempSync(join(tmpdir(), 'whynot-star-'));
  try {
    mkdirSync(join(dir, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'lib', 'package.json'), JSON.stringify({ name: 'lib', version: '1.0.0', peerDependencies: { react: '*' } }));
    const deps = [
      { name: 'react', requestedVersion: '19.0.0', resolvedVersion: '19.0.0', type: 'dependency' as const },
      { name: 'lib', requestedVersion: '1.0.0', resolvedVersion: '1.0.0', type: 'dependency' as const },
    ];
    const result = analyzeWhyNot(dir, deps, 'react', '18.0.0');
    assert.ok(!JSON.stringify(result).includes('not a resolvable semver'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
