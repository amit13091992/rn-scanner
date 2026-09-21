import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pageSize16kCommand } from '../src/commands/pageSize16k.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureCwd = join(__dirname, '..', 'test-fixtures', 'page-size');

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

test('pageSize16kCommand - reuses the existing page-size fixture and reports an unaligned library', async () => {
  const { output } = await captureStdout(() => pageSize16kCommand({ cwd: fixtureCwd, json: true }));
  const result = JSON.parse(output);

  const unaligned = result.filter((r: { status: string }) => r.status === 'unaligned');
  assert.ok(unaligned.length > 0);
});
