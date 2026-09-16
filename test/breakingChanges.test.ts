import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { detectBreakingChanges, analyzeBreakingChanges } from '../src/analyzers/breakingChanges.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function dep(name: string, resolvedVersion: string): DependencyInfo {
  return { name, requestedVersion: resolvedVersion, resolvedVersion, type: 'dependency' };
}

test('detectBreakingChanges - marks a change fresh when installed close to introducedInVersion', () => {
  const result = detectBreakingChanges(dep('react-native-reanimated', '4.1.7'));
  assert.equal(result.detected, true);
  assert.equal(result.issue?.stale, false);
});

test('detectBreakingChanges - marks a change stale once installed version has drifted far past it', () => {
  const result = detectBreakingChanges(dep('react-native', '0.82.1'));
  assert.equal(result.detected, true);
  assert.equal(result.issue?.introducedInVersion, '0.73.0');
  assert.equal(result.issue?.stale, true);
});

test('detectBreakingChanges - two majors ahead is stale', () => {
  const result = detectBreakingChanges(dep('@react-navigation/native', '9.0.0'));
  assert.equal(result.detected, true);
  assert.equal(result.issue?.stale, true);
});

test('analyzeBreakingChanges - a change is not stale when simulating a target version past the actual current one', () => {
  // Upgrading react-native from 0.72 to 0.90: the 0.73 breaking change hasn't happened for
  // this user yet, so it must not be marked stale just because 0.90 is far past 0.73.
  const currentDependencies = [dep('react-native', '0.72.0')];
  const dependenciesAtTarget = [dep('react-native', '0.90.0')];

  const results = analyzeBreakingChanges(dependenciesAtTarget, currentDependencies);

  assert.equal(results[0]?.detected, true);
  assert.equal(results[0]?.issue?.introducedInVersion, '0.73.0');
  assert.equal(results[0]?.issue?.stale, false);
});

test('analyzeBreakingChanges - defaults to plain check semantics when no reference list is given', () => {
  const results = analyzeBreakingChanges([dep('react-native', '0.82.1')]);

  assert.equal(results[0]?.issue?.stale, true);
});

test('detectBreakingChanges - no data for unknown package', () => {
  const result = detectBreakingChanges(dep('some-unlisted-package', '1.0.0'));
  assert.equal(result.detected, false);
  assert.equal(result.hasData, false);
});
