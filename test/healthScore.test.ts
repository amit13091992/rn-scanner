import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeHealthScore } from '../src/utils/healthScore.js';

test('computeHealthScore - flags low coverage when almost nothing was analyzed', () => {
  const result = computeHealthScore({ compatible: 5, warnings: 0, errors: 0, notChecked: 74, total: 79 });

  assert.equal(result.score, 100);
  assert.equal(result.analyzed, 5);
  assert.equal(result.lowCoverage, true);
});

test('computeHealthScore - does not flag low coverage when most dependencies were analyzed', () => {
  const result = computeHealthScore({ compatible: 9, warnings: 1, errors: 0, notChecked: 1, total: 11 });

  assert.equal(result.score, 90);
  assert.equal(result.lowCoverage, false);
});

test('computeHealthScore - zero dependencies scores 100 with no coverage warning', () => {
  const result = computeHealthScore({ compatible: 0, warnings: 0, errors: 0, notChecked: 0, total: 0 });

  assert.equal(result.score, 100);
  assert.equal(result.lowCoverage, false);
});

test('computeHealthScore - all not-checked scores 0, not 100', () => {
  const result = computeHealthScore({ compatible: 0, warnings: 0, errors: 0, notChecked: 5, total: 5 });

  assert.equal(result.score, 0);
});
