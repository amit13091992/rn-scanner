import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { securityCommand } from '../src/commands/security.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'security-test-'));
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

function writeNestedProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-app', devDependencies: { eslint: '8.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-app', devDependencies: { eslint: '8.0.0' } },
        'node_modules/eslint': { version: '8.0.0', dev: true, dependencies: { keyv: '4.0.0' } },
        'node_modules/eslint/node_modules/keyv': { version: '4.0.0', dev: true },
      },
    })
  );
}

test('securityCommand - json output finds a vulnerable transitive package with its path and exits 1 on high severity', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return {
        ok: true,
        json: async () => ({ results: [{ vulns: [] }, { vulns: [{ id: 'GHSA-keyv-deep' }] }] }),
      } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-keyv-deep')) {
      return {
        ok: true,
        json: async () => ({ id: 'GHSA-keyv-deep', summary: 'Deep issue', database_specific: { severity: 'HIGH' }, references: [] }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    writeNestedProject(dir);

    const { output, exitCode } = await captureStdout(() => securityCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.scanned, true);
    assert.equal(result.hierarchyComplete, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].package, 'keyv');
    assert.equal(result.results[0].direct, false);
    assert.deepEqual(result.results[0].paths, [['eslint', 'keyv']]);
    assert.equal(exitCode, 1);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('securityCommand - json output reports a clean scan without exiting non-zero when nothing is found', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (url.toString().includes('querybatch')) {
      const n = (JSON.parse(String(init?.body)) as { queries: unknown[] }).queries.length;
      return { ok: true, json: async () => ({ results: Array.from({ length: n }, () => ({ vulns: [] })) }) } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    writeNestedProject(dir);

    const { output, exitCode } = await captureStdout(() => securityCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.scanned, true);
    assert.deepEqual(result.results, []);
    assert.equal(exitCode, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('securityCommand - --all-workspaces aggregates results across every workspace package, exiting 1 if any package has a high/critical finding', async () => {
  const root = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const queried = body.queries?.[0]?.package?.name;
      if (queried === 'vuln-pkg') {
        return { ok: true, json: async () => ({ results: [{ vulns: [{ id: 'GHSA-vuln-high' }] }] }) } as Response;
      }
      return { ok: true, json: async () => ({ results: [{ vulns: [] }] }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-vuln-high')) {
      return {
        ok: true,
        json: async () => ({ id: 'GHSA-vuln-high', summary: 'Bad stuff', database_specific: { severity: 'HIGH' }, references: [] }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const { mkdirSync } = await import('node:fs');
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'clean-pkg': '^1.0.0' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', dependencies: { 'vuln-pkg': '^1.0.0' } }));
    writeFileSync(
      join(root, 'yarn.lock'),
      `clean-pkg@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/clean-pkg/-/clean-pkg-1.0.0.tgz"\n\nvuln-pkg@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/vuln-pkg/-/vuln-pkg-1.0.0.tgz"\n`
    );

    const { output, exitCode } = await captureStdout(() =>
      securityCommand({ cwd: appDir, json: true, allWorkspaces: true })
    );
    const result = JSON.parse(output);

    assert.equal(result.workspaces.length, 2);
    const mobileApp = result.workspaces.find((w: { package: string }) => w.package === 'mobile-app');
    const shared = result.workspaces.find((w: { package: string }) => w.package === '@acme/shared');
    assert.ok(mobileApp.results.some((r: { package: string }) => r.package === 'vuln-pkg'));
    assert.equal(shared.results.length, 0);
    assert.equal(result.summary.high, 1);
    assert.equal(exitCode, 1);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(root);
  }
});

function stubOfflineFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('securityCommand - --min-release-age and the config field set the supply-chain threshold; the flag wins', async () => {
  const dir = makeTempDir();
  const restore = stubOfflineFetch();
  try {
    writeNestedProject(dir);
    const ageOf = async (opts: Record<string, unknown>) => {
      const { output } = await captureStdout(() => securityCommand({ cwd: dir, json: true, failOn: 'none', ...opts }));
      return JSON.parse(output).supplyChain.releaseAge.minAgeDays;
    };
    assert.equal(await ageOf({}), 7);
    assert.equal(await ageOf({ minReleaseAge: '14' }), 14);
    assert.equal(await ageOf({ minReleaseAge: 0 }), 0);

    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ minReleaseAgeDays: 30 }));
    assert.equal(await ageOf({}), 30);
    assert.equal(await ageOf({ minReleaseAge: '3' }), 3);
  } finally {
    restore();
    cleanup(dir);
  }
});

test('securityCommand - an invalid --min-release-age is rejected before any scan runs', async () => {
  const dir = makeTempDir();
  const restore = stubOfflineFetch();
  try {
    writeNestedProject(dir);
    for (const bad of ['abc', '-1', '1.5', '']) {
      const { output, exitCode } = await captureStdout(() => securityCommand({ cwd: dir, json: true, minReleaseAge: bad }));
      assert.equal(exitCode, 1, `"${bad}" should exit 1`);
      assert.match(output, /Invalid --min-release-age/);
    }
  } finally {
    restore();
    cleanup(dir);
  }
});
