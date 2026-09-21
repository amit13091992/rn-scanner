import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphCommand } from '../src/commands/graph.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'graph-test-'));
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
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { foo: '1.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app' },
        'node_modules/foo': { version: '1.0.0' },
        'node_modules/foo/node_modules/bar': { version: '2.0.0' },
      },
    })
  );
}

test('graphCommand - json output includes every node with parents/children', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => graphCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.manager, 'npm');
    assert.equal(result.hierarchyComplete, true);
    assert.equal(result.nodeCount, 3); // root + foo + bar
    const bar = result.nodes.find((n: { name: string }) => n.name === 'bar');
    assert.equal(bar.version, '2.0.0');
  } finally {
    cleanup(dir);
  }
});

test('graphCommand - --dot renders a Graphviz digraph with an edge per parent/child pair', async () => {
  const dir = makeTempDir();
  try {
    writeNestedProject(dir);

    const { output } = await captureStdout(() => graphCommand({ cwd: dir, dot: true }));

    assert.ok(output.startsWith('digraph dependencies {'));
    assert.ok(output.includes('"node_modules/foo" -> "node_modules/foo/node_modules/bar"'));
  } finally {
    cleanup(dir);
  }
});

test('graphCommand - no project/lockfile at all reports an error and exits 1', async () => {
  const dir = makeTempDir();
  try {
    const { output, exitCode } = await captureStdout(() => graphCommand({ cwd: dir, json: true }));

    assert.ok(output.includes('"error": "No project or lockfile found"'));
    assert.equal(exitCode, 1);
  } finally {
    cleanup(dir);
  }
});
