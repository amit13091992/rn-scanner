import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeExpoGoSupport } from '../src/analyzers/expoGoSupport.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function makeDep(name: string, resolvedVersion: string): DependencyInfo {
  return {
    name,
    requestedVersion: `^${resolvedVersion}`,
    resolvedVersion,
    type: 'dependency',
  };
}

test('analyzeExpoGoSupport - returns nothing for a non-Expo project', () => {
  const dependencies = [makeDep('react-native-vision-camera', '4.0.0')];

  const results = analyzeExpoGoSupport(dependencies, false);

  assert.equal(results.length, 0);
});

test('analyzeExpoGoSupport - known unsupported package reports its reason', () => {
  const dependencies = [makeDep('react-native-vision-camera', '4.0.0')];

  const results = analyzeExpoGoSupport(dependencies, true);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.support, 'unsupported');
  assert.ok(results[0]!.reason?.includes('custom native code'));
});

test('analyzeExpoGoSupport - known supported package reports supported', () => {
  const dependencies = [makeDep('react-native-reanimated', '3.5.0')];

  const results = analyzeExpoGoSupport(dependencies, true);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.support, 'supported');
});

test('analyzeExpoGoSupport - native-looking package with no curated entry is flagged unknown', () => {
  const dependencies = [makeDep('react-native-some-unknown-native-module', '1.0.0')];

  const results = analyzeExpoGoSupport(dependencies, true);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.support, 'unknown');
  assert.ok(results[0]!.notes?.includes('No Expo Go compatibility data'));
});

test('analyzeExpoGoSupport - does not flag a plain JS package with no data entry', () => {
  const dependencies = [makeDep('lodash', '4.17.21')];

  const results = analyzeExpoGoSupport(dependencies, true);

  assert.equal(results.length, 0);
});

test('analyzeExpoGoSupport - does not flag CLI/build tooling', () => {
  const dependencies = [
    makeDep('@react-native-community/cli', '20.0.0'),
    makeDep('react-native-svg-transformer', '1.5.3'),
  ];

  const results = analyzeExpoGoSupport(dependencies, true);

  assert.equal(results.length, 0);
});
