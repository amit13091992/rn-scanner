import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiSetupCommand } from '../src/commands/aiSetup.js';
import { __setModuleLoaderForTests, __resetModuleLoaderForTests } from '../src/services/localModelClient.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ai-setup-test-'));
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

test('aiSetupCommand - reports not ready when the native runtime cannot load', async () => {
  const dir = makeTempDir();
  // A model name that can't coincidentally already be cached on whatever machine runs this
  // test (isModelDownloaded() matches by filename suffix against ~/.cache/rn-dep-scanner).
  writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ai: { model: 'hf:Test/Fixture/never-really-cached-abc.gguf' } }));
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => {
      throw new Error('unsupported platform');
    },
  }) as never);
  try {
    const { output } = await captureStdout(() => aiSetupCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);
    assert.equal(result.runtimeAvailable, false);
    assert.equal(result.modelDownloaded, false);
    assert.equal(result.ready, false);
    assert.ok(result.nextSteps.length > 0);
  } finally {
    __resetModuleLoaderForTests();
    cleanup(dir);
  }
});

test('aiSetupCommand - reads the configured model from .rn-dep-scanner.json', async () => {
  const dir = makeTempDir();
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => {
      throw new Error('unsupported platform');
    },
  }) as never);
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ai: { model: 'hf:Org/Repo/tiny.gguf' } }));
    const { output } = await captureStdout(() => aiSetupCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);
    assert.equal(result.model, 'hf:Org/Repo/tiny.gguf');
  } finally {
    __resetModuleLoaderForTests();
    cleanup(dir);
  }
});

test('aiSetupCommand - does not attempt a download when --download is omitted, even if the model is missing', async () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ai: { model: 'hf:Test/Fixture/never-really-cached-def.gguf' } }));
  __setModuleLoaderForTests(async () => ({ getLlama: async () => ({}) }) as never);
  try {
    const { output } = await captureStdout(() => aiSetupCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);
    assert.equal(result.downloadAttempted, undefined);
    assert.equal(result.modelDownloaded, false);
  } finally {
    __resetModuleLoaderForTests();
    cleanup(dir);
  }
});

test('aiSetupCommand - --download attempts a download and reflects success in the result', async () => {
  const dir = makeTempDir();
  // A model name guaranteed not to collide with anything a real machine (including this
  // dev machine, which has actually downloaded the default model) might have cached —
  // isModelDownloaded() matches by filename suffix, so a shared/real model name here would
  // make this test's outcome depend on whatever happens to already be in ~/.cache.
  writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ai: { model: 'hf:Test/Fixture/never-really-cached-xyz.gguf' } }));
  let downloadCalled = false;
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => ({}),
    resolveModelFile: async () => {
      downloadCalled = true;
      return '/fake/cache/model.gguf';
    },
  }) as never);
  try {
    const { output } = await captureStdout(() => aiSetupCommand({ cwd: dir, json: true, download: true }));
    const result = JSON.parse(output);
    assert.equal(downloadCalled, true);
    assert.equal(result.downloadAttempted, true);
    assert.equal(result.downloadSucceeded, true);
  } finally {
    __resetModuleLoaderForTests();
    cleanup(dir);
  }
});

test('aiSetupCommand - human output does not crash and includes next steps when not ready', async () => {
  const dir = makeTempDir();
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => {
      throw new Error('unsupported platform');
    },
  }) as never);
  try {
    const { output } = await captureStdout(() => aiSetupCommand({ cwd: dir }));
    assert.match(output, /Next steps/);
  } finally {
    __resetModuleLoaderForTests();
    cleanup(dir);
  }
});
