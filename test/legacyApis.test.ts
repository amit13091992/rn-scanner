import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyApisCommand } from '../src/commands/legacyApis.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'legacy-apis-test-'));
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

test('legacyApisCommand - detects a named import of a removed react-native core API and suggests its replacement', async () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'Screen.tsx'), "import { View, WebView } from 'react-native';\nexport default () => null;\n");

    const { output } = await captureStdout(() => legacyApisCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].symbol, 'WebView');
    assert.equal(result.occurrences[0].replacement, 'react-native-webview');
    assert.deepEqual(result.occurrences[0].files, [join('src', 'Screen.tsx')]);
  } finally {
    cleanup(dir);
  }
});

test('legacyApisCommand - a project with no legacy API usage reports an empty occurrences list', async () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'Screen.tsx'), "import { View, FlatList } from 'react-native';\nexport default () => null;\n");

    const { output } = await captureStdout(() => legacyApisCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.occurrences, []);
  } finally {
    cleanup(dir);
  }
});

test('legacyApisCommand - does not confuse a same-named symbol imported from an unrelated package', async () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'Screen.tsx'), "import { WebView } from 'react-native-webview';\nexport default () => null;\n");

    const { output } = await captureStdout(() => legacyApisCommand({ cwd: dir, json: true }));
    const result = JSON.parse(output);

    assert.deepEqual(result.occurrences, []);
  } finally {
    cleanup(dir);
  }
});
