import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRenovateConfig } from '../src/analyzers/renovateConfig.js';
import { renovateConfigCommand } from '../src/commands/renovateConfig.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'renovate-config-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function dep(name: string, type: DependencyInfo['type'] = 'dependency'): DependencyInfo {
  return { name, requestedVersion: '1.0.0', type };
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

test('buildRenovateConfig - groups react-native/react core packages together', () => {
  const { config } = buildRenovateConfig([dep('react-native'), dep('react'), dep('left-pad')], '0.75.0');
  const rules = config.packageRules as Array<{ groupName: string; matchPackageNames?: string[] }>;
  const coreRule = rules.find((r) => r.groupName === 'React Native core');
  assert.ok(coreRule);
  assert.deepEqual(coreRule!.matchPackageNames, ['react-native', 'react']);
});

test('buildRenovateConfig - groups native modules by pattern and counts them', () => {
  const { config, nativeModuleCount } = buildRenovateConfig(
    [dep('react-native-screens'), dep('@react-native-community/netinfo'), dep('left-pad')],
    '0.75.0'
  );
  const rules = config.packageRules as Array<{ groupName: string }>;
  assert.ok(rules.some((r) => r.groupName === 'Native modules (requires a native rebuild)'));
  assert.equal(nativeModuleCount, 2);
});

test('buildRenovateConfig - flags a package unsupported on the New Architecture for priority review', () => {
  const { config, reviewFlagged } = buildRenovateConfig(
    [dep('@react-native-community/async-storage')],
    '0.75.0'
  );
  const rules = config.packageRules as Array<{ groupName: string; matchPackageNames?: string[] }>;
  const reviewRule = rules.find((r) => r.groupName === 'New Architecture review needed');
  assert.ok(reviewRule);
  assert.deepEqual(reviewRule!.matchPackageNames, ['@react-native-community/async-storage']);
  assert.deepEqual(reviewFlagged, ['@react-native-community/async-storage']);
});

test('buildRenovateConfig - respects ignorePackages via ignoreDeps', () => {
  const { config } = buildRenovateConfig([dep('noisy-pkg')], null, ['noisy-pkg']);
  assert.deepEqual(config.ignoreDeps, ['noisy-pkg']);
});

test('buildRenovateConfig - a project with no native modules or core packages omits those groups entirely', () => {
  const { config } = buildRenovateConfig([dep('left-pad')], null);
  assert.equal(config.packageRules, undefined);
});

test('renovateConfigCommand - prints valid JSON to stdout by default', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'react-native': '0.75.0' } }));
    const { output } = await captureStdout(() => renovateConfigCommand({ cwd: dir }));
    const parsed = JSON.parse(output);
    assert.equal(parsed.extends[0], 'config:recommended');
  } finally {
    cleanup(dir);
  }
});

test('renovateConfigCommand - --out writes the config to a file instead of stdout', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'react-native': '0.75.0' } }));
    const outPath = join(dir, 'renovate.json');
    await renovateConfigCommand({ cwd: dir, out: outPath });
    assert.ok(existsSync(outPath));
    const parsed = JSON.parse(readFileSync(outPath, 'utf-8'));
    assert.equal(parsed.extends[0], 'config:recommended');
  } finally {
    cleanup(dir);
  }
});
