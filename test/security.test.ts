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
        '': { name: 'test-app' },
        'node_modules/eslint': { version: '8.0.0', dev: true },
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
  globalThis.fetch = (async (url: string | URL) => {
    if (url.toString().includes('querybatch')) {
      return { ok: true, json: async () => ({ results: [] }) } as Response;
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
