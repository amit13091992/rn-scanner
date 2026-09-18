import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outdatedCommand } from '../src/commands/outdated.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'outdated-test-'));
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

function stubRegistry(latestByName: Record<string, string>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    const name = decodeURIComponent(url.split('/').slice(-2, -1)[0]!);
    const latest = latestByName[name];
    if (!latest) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify({ version: latest }), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('outdatedCommand - classifies major/minor/patch updates correctly', async () => {
  const dir = makeTempDir();
  const restore = stubRegistry({
    'major-pkg': '2.0.0',
    'minor-pkg': '1.1.0',
    'patch-pkg': '1.0.1',
  });
  try {
    writeProject(dir, { 'major-pkg': '1.0.0', 'minor-pkg': '1.0.0', 'patch-pkg': '1.0.0' });

    const { output } = await captureStdout(() => outdatedCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.summary.major, 1);
    assert.equal(result.summary.minor, 1);
    assert.equal(result.summary.patch, 1);
    assert.equal(result.packages.find((p: { name: string }) => p.name === 'major-pkg').type, 'major');
  } finally {
    restore();
    cleanup(dir);
  }
});

test('outdatedCommand - a package already at the latest version is not reported', async () => {
  const dir = makeTempDir();
  const restore = stubRegistry({ 'up-to-date-pkg': '1.0.0' });
  try {
    writeProject(dir, { 'up-to-date-pkg': '1.0.0' });

    const { output } = await captureStdout(() => outdatedCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.summary.total, 0);
  } finally {
    restore();
    cleanup(dir);
  }
});

test('outdatedCommand - --major-only suppresses minor/patch lines in human output', async () => {
  const dir = makeTempDir();
  const restore = stubRegistry({ 'major-pkg': '2.0.0', 'patch-pkg': '1.0.1' });
  try {
    writeProject(dir, { 'major-pkg': '1.0.0', 'patch-pkg': '1.0.0' });

    const { output } = await captureStdout(() => outdatedCommand({ cwd: dir, majorOnly: true }));

    assert.ok(output.includes('major-pkg'));
    assert.ok(!output.includes('patch-pkg'));
  } finally {
    restore();
    cleanup(dir);
  }
});

test('outdatedCommand - human output reports up to date when nothing is outdated', async () => {
  const dir = makeTempDir();
  const restore = stubRegistry({ 'up-to-date-pkg': '1.0.0' });
  try {
    writeProject(dir, { 'up-to-date-pkg': '1.0.0' });

    const { output } = await captureStdout(() => outdatedCommand({ cwd: dir }));

    assert.ok(output.includes('up to date'));
  } finally {
    restore();
    cleanup(dir);
  }
});
