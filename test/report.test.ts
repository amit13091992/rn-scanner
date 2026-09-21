import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportCommand } from '../src/commands/report.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'report-test-'));
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

test('reportCommand - renders a Markdown report to stdout with health score and section headings', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', dependencies: {} }));

    const { output } = await captureStdout(() => reportCommand({ cwd: dir, format: 'md' }));

    assert.ok(output.includes('# Dependency Report: my-app'));
    assert.ok(output.includes('## Health Score'));
    assert.ok(output.includes('## Security'));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});

test('reportCommand - --out writes the report to a file instead of stdout', async () => {
  const dir = makeTempDir();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', dependencies: {} }));
    const outPath = join(dir, 'out.html');

    await reportCommand({ cwd: dir, format: 'html', out: outPath });
    const content = readFileSync(outPath, 'utf-8');

    assert.ok(content.includes('<!doctype html>'));
    assert.ok(content.includes('my-app'));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup(dir);
  }
});
