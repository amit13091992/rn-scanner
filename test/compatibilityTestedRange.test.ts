import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeCompatibility } from '../src/analyzers/compatibility.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function dep(name: string, resolvedVersion: string): DependencyInfo {
  return { name, requestedVersion: `^${resolvedVersion}`, resolvedVersion, type: 'dependency' };
}

test('reanimated 3.16 on RN 0.87 is a warning (above tested range), not an error', () => {
  const r = analyzeCompatibility(dep('react-native-reanimated', '3.16.0'), '0.87.1', '19.0.0');
  assert.equal(r.status, 'warning');
  assert.ok(r.messages.some((m) => m.includes('documents as tested')));
  assert.ok(!r.messages.some((m) => m.includes('Incompatible')));
});

test('reanimated 3.x below the hard minimum is still an error', () => {
  const r = analyzeCompatibility(dep('react-native-reanimated', '3.16.0'), '0.70.0', '18.2.0');
  assert.equal(r.status, 'error');
});

test('reanimated 3.x inside the tested range stays compatible', () => {
  const r = analyzeCompatibility(dep('react-native-reanimated', '3.16.0'), '0.76.0', '18.3.1');
  assert.equal(r.status, 'compatible');
});

test('reanimated 4.7.x: error below RN 0.86, compatible on 0.88, warning on 0.89', () => {
  const d = dep('react-native-reanimated', '4.7.1');
  assert.equal(analyzeCompatibility(d, '0.85.0', '19.0.0').status, 'error');
  assert.equal(analyzeCompatibility(d, '0.88.0', '19.3.0').status, 'compatible');
  assert.equal(analyzeCompatibility(d, '0.89.0', '19.3.0').status, 'warning');
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeAllDependencies } from '../src/analyzers/compatibility.js';

test('packages with no curated rule fall back to their own declared react-native peer range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'peer-compat-'));
  try {
    const mk = (name: string, peers: Record<string, string>) => {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', peerDependencies: peers }));
    };
    mk('lib-ok', { 'react-native': '>=0.80' });
    mk('lib-old', { 'react-native': '0.70 - 0.75' });
    mk('lib-any', { 'react-native': '*' });
    writeFileSync(join(dir, 'package.json'), '{}');
    const deps = ['lib-ok', 'lib-old', 'lib-any'].map((n) => dep(n, '1.0.0'));
    const [ok, old, any] = analyzeAllDependencies(deps, '0.88.0', '19.3.0', [], dir);
    assert.equal(ok!.status, 'compatible');
    assert.equal(ok!.detectedFrom, 'peer-dependencies');
    assert.equal(old!.status, 'warning');
    assert.equal(any!.status, 'not-checked');
    assert.equal(analyzeAllDependencies(deps, '0.88.0', '19.3.0')[0]!.status, 'not-checked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
