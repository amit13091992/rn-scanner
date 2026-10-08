import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { planUpgradePath } from '../src/analyzers/upgradePath.js';

test('planUpgradePath - routes through known intermediate minors between from and to', () => {
  const hops = planUpgradePath('0.70.0', '0.75.0');
  assert.deepEqual(hops, ['0.71', '0.72', '0.73', '0.74', '0.75.0']);
});

test('planUpgradePath - adjacent minors with no known version between them is a single direct hop', () => {
  const hops = planUpgradePath('0.74.5', '0.75.0');
  assert.deepEqual(hops, ['0.75.0']);
});

test('planUpgradePath - from version unparseable falls back to a single direct hop', () => {
  assert.deepEqual(planUpgradePath('not-a-version', '0.75.0'), ['0.75.0']);
});

test('planUpgradePath - null/missing from version falls back to a single direct hop', () => {
  assert.deepEqual(planUpgradePath(null, '0.75.0'), ['0.75.0']);
  assert.deepEqual(planUpgradePath(undefined, '0.75.0'), ['0.75.0']);
});

test('planUpgradePath - target at or before the current version is a single direct hop, not a reversed path', () => {
  assert.deepEqual(planUpgradePath('0.80.0', '0.75.0'), ['0.75.0']);
  assert.deepEqual(planUpgradePath('0.75.0', '0.75.0'), ['0.75.0']);
});
