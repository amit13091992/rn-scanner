import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeNewArchitecture } from '../src/analyzers/newArchitecture.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function makeDep(name: string, resolvedVersion: string): DependencyInfo {
  return {
    name,
    requestedVersion: `^${resolvedVersion}`,
    resolvedVersion,
    type: 'dependency',
  };
}

test('analyzeNewArchitecture - flags a native-looking package with no data entry as untested', () => {
  const dependencies = [makeDep('react-native-some-unknown-native-module', '1.0.0')];

  const { results } = analyzeNewArchitecture(dependencies, '0.83.0');

  assert.equal(results.length, 1);
  assert.equal(results[0]!.support, 'unknown');
  assert.ok(results[0]!.notes?.includes('No New Architecture compatibility data'));
});

test('analyzeNewArchitecture - does not flag a plain JS package with no data entry', () => {
  const dependencies = [makeDep('lodash', '4.17.21')];

  const { results } = analyzeNewArchitecture(dependencies, '0.83.0');

  assert.equal(results.length, 0);
});

test('analyzeNewArchitecture - known package keeps its curated support status, not untested', () => {
  const dependencies = [makeDep('react-native-reanimated', '3.5.0')];

  const { results } = analyzeNewArchitecture(dependencies, '0.83.0');

  assert.equal(results.length, 1);
  assert.equal(results[0]!.support, 'supported');
});

test('analyzeNewArchitecture - untested packages are not reported when New Architecture is not default', () => {
  const dependencies = [makeDep('react-native-some-unknown-native-module', '1.0.0')];

  const { status, results } = analyzeNewArchitecture(dependencies, '0.68.0');

  assert.equal(status.isNewArchDefault, false);
  assert.equal(results.length, 0);
});
