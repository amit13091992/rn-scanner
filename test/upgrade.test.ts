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
    assert.ok(['READY', 'WARN', 'BLOCKED'].includes(parsed.verdict));
    assert.ok(['READY', 'WARN', 'BLOCKED'].includes(parsed.envVerdict));
    assert.ok(Array.isArray(parsed.breakingChanges));
    assert.ok(Array.isArray(parsed.nodeEnvironment));
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

test('upgradeCommand - breaking change introduced before the current RN version is marked historical, not action_required', async () => {
  const dir = makeTempDir();
  try {
    // react-native's 0.73.0 breaking change (critical) is already true at the current 0.77.3
    // install — upgrading further to 0.80.0 should not blame that change on this upgrade.
    writeProject(dir, '0.77.3');
    const { output } = await captureStdout(() =>
      upgradeCommand('0.80', { json: true, cwd: dir })
    );
    const parsed = JSON.parse(output);
    const rnChanges = parsed.breakingChanges.filter((c: { package: string }) => c.package === 'react-native');
    assert.ok(rnChanges.length > 0);
    rnChanges.forEach((c: { relevance: string; introducedInVersion: string }) => {
      assert.equal(c.relevance, 'historical');
    });
    // None of those historical changes should have pushed risk to high on their own.
    assert.notEqual(parsed.risk, 'high');
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - breaking change newly introduced by this upgrade is relevant/action_required', async () => {
  const dir = makeTempDir();
  try {
    // Starting below 0.71.0, upgrading to 0.75.0 — all three react-native breaking changes
    // (0.71/0.72/0.73) are newly triggered by this specific upgrade.
    writeProject(dir, '0.70.0');
    const { output } = await captureStdout(() =>
      upgradeCommand('0.75', { json: true, cwd: dir })
    );
    const parsed = JSON.parse(output);
    const rnChanges = parsed.breakingChanges.filter((c: { package: string }) => c.package === 'react-native');
    assert.ok(rnChanges.length > 0);
    assert.ok(rnChanges.every((c: { relevance: string }) => c.relevance === 'relevant' || c.relevance === 'action_required'));
    assert.ok(rnChanges.some((c: { relevance: string }) => c.relevance === 'action_required'));
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
    assert.match(output, /Verdict:/);
    assert.match(output, /Risk:/);
    assert.match(output, /Breaking Changes/);
    assert.match(output, /New Architecture/);
    assert.match(output, /Android Environment/);
    assert.match(output, /iOS Environment/);
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - --all-workspaces aggregates readiness across every workspace package', async () => {
  const root = makeTempDir();
  try {
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0' }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', dependencies: { 'react-native': '0.72.0', react: '18.2.0' } }));

    const { output } = await captureStdout(() =>
      upgradeCommand('0.75', { cwd: appDir, json: true, allWorkspaces: true })
    );
    const result = JSON.parse(output);

    assert.equal(result.workspaces.length, 2);
    const mobileApp = result.workspaces.find((w: { package: string }) => w.package === 'mobile-app');
    assert.equal(mobileApp.to, '0.75');
    assert.ok(mobileApp.verdict);
  } finally {
    cleanup(root);
  }
});

test('upgradeCommand - --latest resolves the target from the npm registry dist-tag instead of --to', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  try {
    writeProject(dir, '0.72.0');
    globalThis.fetch = (async (url: string | URL) => {
      assert.ok(url.toString().includes('react-native/latest'));
      return { ok: true, json: async () => ({ version: '0.88.0' }) } as Response;
    }) as typeof fetch;

    const { output } = await captureStdout(() =>
      upgradeCommand(undefined, { json: true, cwd: dir, latest: true })
    );
    const parsed = JSON.parse(output);
    assert.equal(parsed.to, '0.88.0');
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('upgradeCommand - --latest reports an error and exits 1 when the registry lookup fails', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  try {
    writeProject(dir, '0.72.0');
    globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;

    const { output, exitCode } = await captureStdout(() =>
      upgradeCommand(undefined, { json: true, cwd: dir, latest: true })
    );
    assert.equal(exitCode, 1);
    const parsed = JSON.parse(output);
    assert.match(parsed.error, /Could not resolve/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('upgradeCommand - neither --to nor --latest reports an error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.72.0');
    const { output, exitCode } = await captureStdout(() => upgradeCommand(undefined, { json: true, cwd: dir }));
    assert.equal(exitCode, 1);
    const parsed = JSON.parse(output);
    assert.match(parsed.error, /No target version/);
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - a multi-minor jump includes an upgradePath with one assessed hop per known intermediate version', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.70.0');
    const { output } = await captureStdout(() => upgradeCommand('0.75', { json: true, cwd: dir }));
    const parsed = JSON.parse(output);
    assert.ok(Array.isArray(parsed.upgradePath));
    // 0.70 -> 0.75 routes through 0.71/0.72/0.73/0.74 before landing on 0.75.
    assert.deepEqual(parsed.upgradePath.map((s: { to: string }) => s.to), ['0.71', '0.72', '0.73', '0.74', '0.75']);
    assert.equal(parsed.upgradePath[0].from, '0.70.0');
    parsed.upgradePath.forEach((step: { risk: string; verdict: string }) => {
      assert.ok(['low', 'medium', 'high'].includes(step.risk));
      assert.ok(['READY', 'WARN', 'BLOCKED'].includes(step.verdict));
    });
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - an adjacent-minor upgrade with no known intermediate version omits upgradePath entirely', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.74.5');
    const { output } = await captureStdout(() => upgradeCommand('0.75', { json: true, cwd: dir }));
    const parsed = JSON.parse(output);
    assert.equal('upgradePath' in parsed, false);
  } finally {
    cleanup(dir);
  }
});

test('upgradeCommand - human output prints the suggested incremental path section when a multi-hop path exists', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir, '0.70.0');
    const { output } = await captureStdout(() => upgradeCommand('0.75', { cwd: dir }));
    assert.match(output, /Suggested Incremental Path/);
  } finally {
    cleanup(dir);
  }
});
