import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeCommand } from '../src/commands/tree.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tree-test-'));
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
        '': { name: 'test-app' },
        'node_modules/foo': { version: '1.0.0' },
        'node_modules/foo/node_modules/bar': { version: '2.0.0' },
      },
    })
  );
}

test('treeCommand - json output includes the full nested tree for a package', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => treeCommand(undefined, { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.manager, 'npm');
    assert.equal(result.hierarchyComplete, true);
    const fooNode = result.tree.children.find((c: { name: string }) => c.name === 'foo');
    assert.ok(fooNode);
    assert.equal(fooNode.version, '1.0.0');
    assert.ok(fooNode.children.some((c: { name: string }) => c.name === 'bar'));
  } finally {
    cleanup(dir);
  }
});

test('treeCommand - rooting at a specific package only shows its own subtree', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => treeCommand('foo', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.tree.name, 'foo');
    assert.ok(result.tree.children.some((c: { name: string }) => c.name === 'bar'));
  } finally {
    cleanup(dir);
  }
});

test('treeCommand - a package not in the graph reports an error in json mode instead of throwing', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => treeCommand('nonexistent-pkg', { cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.ok(result.error.includes('nonexistent-pkg'));
  } finally {
    cleanup(dir);
  }
});

test('treeCommand - no project/lockfile at all reports an error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    // process.exit is stubbed to throw (see captureStdout) so the run can be asserted on
    // without actually killing the test process; that throw is then re-caught by the
    // command's own top-level try/catch, which reports and exits a second time — an
    // artifact of stubbing process.exit, not something that happens with the real one. Assert
    // on the first (real) error rather than parsing the whole capture as one JSON document.
    const { output, exitCode } = await captureStdout(() => treeCommand(undefined, { cwd: dir, json: true }));

    assert.ok(output.includes('"error": "No project or lockfile found"'));
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});
