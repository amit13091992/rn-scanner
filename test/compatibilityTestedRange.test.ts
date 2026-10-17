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
