import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiExposureCommand } from '../src/commands/aiExposure.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ai-exposure-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(dir: string, deps: Record<string, string>): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: deps }, null, 2)
  );
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

test('aiExposureCommand - no AI dependency and no key literal reports a clean result', async () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { react: '18.0.0' });
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'App.tsx'), "export default () => null;\n");

    const { output } = await captureStdout(() => aiExposureCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.sdksDetected, []);
    assert.equal(result.directCallWarning, false);
    assert.deepEqual(result.keyExposures, []);
  } finally {
    cleanup(dir);
  }
});

test('aiExposureCommand - a direct AI SDK dependency is flagged even without a key literal', async () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { openai: '^4.0.0' });
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'Chat.tsx'), "import OpenAI from 'openai';\nexport default () => null;\n");

    const { output } = await captureStdout(() => aiExposureCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.sdksDetected.length, 1);
    assert.equal(result.sdksDetected[0].packageName, 'openai');
    assert.equal(result.sdksDetected[0].provider, 'OpenAI');
    assert.equal(result.directCallWarning, true);
    assert.deepEqual(result.keyExposures, []);
  } finally {
    cleanup(dir);
  }
});

test('aiExposureCommand - a key-shaped literal is reported by location only, never by value', async () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, {});
    mkdirSync(join(dir, 'src'));
    const fakeKey = `sk-${'a'.repeat(24)}`;
    writeFileSync(join(dir, 'src', 'Chat.tsx'), `const apiKey = "${fakeKey}";\n`);

    const { output } = await captureStdout(() => aiExposureCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.keyExposures.length, 1);
    assert.equal(result.keyExposures[0].provider, 'OpenAI');
    assert.equal(result.keyExposures[0].file, join('src', 'Chat.tsx'));
    assert.equal(result.keyExposures[0].line, 1);
    assert.ok(!output.includes(fakeKey), 'raw key text must never appear in output');
  } finally {
    cleanup(dir);
  }
});

test('aiExposureCommand - an Anthropic-shaped key is attributed to Anthropic, not OpenAI', async () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, {});
    mkdirSync(join(dir, 'src'));
    const fakeKey = `sk-ant-${'b'.repeat(24)}`;
    writeFileSync(join(dir, 'src', 'Chat.tsx'), `const apiKey = "${fakeKey}";\n`);

    const { output } = await captureStdout(() => aiExposureCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.keyExposures.length, 1);
    assert.equal(result.keyExposures[0].provider, 'Anthropic');
  } finally {
    cleanup(dir);
  }
});
