import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whyCommand } from '../src/commands/why.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'why-test-'));
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
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-app', dependencies: { foo: '1.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'test-app', dependencies: { foo: '1.0.0' } },
        'node_modules/foo': { version: '1.0.0', dependencies: { bar: '2.0.0' } },
        'node_modules/foo/node_modules/bar': { version: '2.0.0' },
      },
    })
  );
}

test('whyCommand - json output traces every path to the package with its resolved version', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => whyCommand('bar', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.package, 'bar');
    assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].version, '2.0.0');
    assert.deepEqual(result.occurrences[0].paths[0], ['foo', 'bar']);
  } finally {
    cleanup(dir);
  }
});

test('whyCommand - a package that is not installed returns an empty occurrences list, not an error', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => whyCommand('nonexistent-pkg', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.package, 'nonexistent-pkg');
    assert.deepEqual(result.occurrences, []);
  } finally {
    cleanup(dir);
  }
});

test('whyCommand - no project/lockfile at all reports an error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    // See the equivalent tree.test.ts case for why this asserts on a substring rather than
    // parsing the whole capture as one JSON document (a stubbed-process.exit test artifact).
    const { output, exitCode } = await captureStdout(() => whyCommand('bar', { cwd: dir, json: true }));

    assert.ok(output.includes('"error": "No project or lockfile found"'));
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});

test('whyCommand - traces a transitive dependency reached only through a sibling workspace package', async () => {
  const root = makeTempDir();
  try {
    const { mkdirSync } = await import('node:fs');
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', dependencies: { '@acme/shared': 'workspace:^1.0.0' } }));
    writeFileSync(
      join(root, 'yarn.lock'),
      `left-pad@^1.0.0:\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"\n`
    );

    const { output } = await captureStdout(() => whyCommand('left-pad', { cwd: appDir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].paths[0].join(' > '), '@acme/shared > left-pad');
  } finally {
    cleanup(root);
  }
});

test('whyCommand - --all-workspaces aggregates results across every workspace package', async () => {
  const root = makeTempDir();
  try {
    const { mkdirSync } = await import('node:fs');
    const sharedDir = join(root, 'packages', 'shared');
    const appDir = join(root, 'packages', 'mobile-app');
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } }));
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile-app', dependencies: { '@acme/shared': 'workspace:^1.0.0' } }));
    writeFileSync(join(root, 'yarn.lock'), `left-pad@^1.0.0:\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"\n`);

    const { output } = await captureStdout(() => whyCommand('left-pad', { cwd: appDir, json: true, allWorkspaces: true }));
    const result = JSON.parse(output);

    assert.equal(result.workspaces.length, 2);
    const shared = result.workspaces.find((w: { package: string }) => w.package === '@acme/shared');
    const mobileApp = result.workspaces.find((w: { package: string }) => w.package === 'mobile-app');
    assert.equal(shared.occurrences[0].paths[0].join(' > '), 'left-pad');
    assert.equal(mobileApp.occurrences[0].paths[0].join(' > '), '@acme/shared > left-pad');
  } finally {
    cleanup(root);
  }
});

test('whyCommand - --all-workspaces outside a workspace falls back to a plain single-project scan', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'single-app', dependencies: { 'left-pad': '^1.0.0' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { 'left-pad': '^1.0.0' } }, 'node_modules/left-pad': { version: '1.3.0' } } }));

    const { output } = await captureStdout(() => whyCommand('left-pad', { cwd: dir, json: true, allWorkspaces: true }));
    const result = JSON.parse(output);

    assert.equal(result.package, 'left-pad');
    assert.ok(result.occurrences);
    assert.equal(result.workspaces, undefined);
  } finally {
    cleanup(dir);
  }
});

test('whyCommand - json output says direct vs transitive, who requires it, and the declared range', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);
    const bar = JSON.parse((await captureStdout(() => whyCommand('bar', { cwd: dir, json: true }))).output);
    assert.equal(bar.project, 'test-app');
    assert.equal(bar.occurrences[0].direct, false);
    assert.deepEqual(bar.occurrences[0].dependents, ['foo']);
    assert.equal(bar.summary.duplicated, false);

    const foo = JSON.parse((await captureStdout(() => whyCommand('foo', { cwd: dir, json: true }))).output);
    assert.equal(foo.occurrences[0].direct, true);
    assert.equal(foo.occurrences[0].requested, '1.0.0');
    assert.equal(foo.occurrences[0].declaredIn, 'dependencies');
  } finally {
    cleanup(dir);
  }
});

test('whyCommand - human output uses the real project name and suggests close matches when nothing is found', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);
    const found = await captureStdout(() => whyCommand('bar', { cwd: dir }));
    assert.match(found.output, /test-app → foo → bar/);
    assert.match(found.output, /transitive dependency/);
    assert.match(found.output, /Required by: foo/);

    const missing = await captureStdout(() => whyCommand('fooo', { cwd: dir }));
    assert.match(missing.output, /Did you mean: foo/);
  } finally {
    cleanup(dir);
  }
});
