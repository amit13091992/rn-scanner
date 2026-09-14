import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compareRnCommand } from '../src/commands/compareRn.js';

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

test('compareRnCommand - json output includes android and ios diffs between versions', async () => {
  const { output } = await captureStdout(() => compareRnCommand('0.72', '0.75', { json: true }));
  const parsed = JSON.parse(output);
  assert.equal(parsed.from, '0.72');
  assert.equal(parsed.to, '0.75');
  assert.ok(Array.isArray(parsed.android));
  assert.ok(Array.isArray(parsed.ios));
  const jdkDiff = parsed.android.find((d: { name: string }) => d.name === 'JDK');
  assert.equal(jdkDiff.from, '11');
  assert.equal(jdkDiff.to, '17');
  assert.equal(jdkDiff.changed, true);
});

test('compareRnCommand - identical versions produce no changed fields', async () => {
  const { output } = await captureStdout(() => compareRnCommand('0.75', '0.75', { json: true }));
  const parsed = JSON.parse(output);
  const allDiffs = [...parsed.android, ...parsed.ios];
  assert.ok(allDiffs.every((d: { changed: boolean }) => d.changed === false));
});

test('compareRnCommand - unparseable version exits with an error', async () => {
  const { output, exitCode } = await captureStdout(() =>
    compareRnCommand('not-a-version', '0.75', { json: true })
  );
  assert.equal(exitCode, 1);
  const parsed = JSON.parse(output);
  assert.match(parsed.error, /No native requirement baseline/);
});

test('compareRnCommand - human output prints a header and sections', async () => {
  const { output } = await captureStdout(() => compareRnCommand('0.72', '0.75', {}));
  assert.match(output, /0\.72/);
  assert.match(output, /0\.75/);
  assert.match(output, /Android/);
  assert.match(output, /iOS/);
});
