import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  detectVersionMismatches,
  detectDuplicateDependencies,
  isReactNativeCompatible,
} from '../src/utils/versionDetection.js';
import type { DependencyInfo } from '../src/types/dependency.js';

test('detectVersionMismatches - finds declared vs installed differences', () => {
  const deps: DependencyInfo[] = [
    {
      name: 'react',
      requestedVersion: '^18.0.0',
      resolvedVersion: '18.2.0',
      type: 'dependency',
    },
    {
      name: 'lodash',
      requestedVersion: '4.17.21',
      resolvedVersion: '4.17.21',
      type: 'dependency',
    },
  ];

  const mismatches = detectVersionMismatches(deps);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].package, 'react');
  assert.equal(mismatches[0].declared, '^18.0.0');
  assert.equal(mismatches[0].installed, '18.2.0');
});

test('detectDuplicateDependencies - identifies multiple versions', () => {
  const deps: DependencyInfo[] = [
    {
      name: 'react-native',
      requestedVersion: '0.73.0',
      resolvedVersion: '0.73.0',
      type: 'dependency',
    },
    {
      name: 'react-native-reanimated',
      requestedVersion: '3.5.0',
      resolvedVersion: '3.5.0',
      type: 'dependency',
    },
    {
      name: 'react-native-reanimated',
      requestedVersion: '4.0.0',
      resolvedVersion: '4.0.0',
      type: 'devDependency',
    },
  ];

  const duplicates = detectDuplicateDependencies(deps);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].package, 'react-native-reanimated');
  assert.equal(duplicates[0].versions.length, 2);
  assert.equal(duplicates[0].severity, 'critical');
});

test('detectDuplicateDependencies - marks react as critical', () => {
  const deps: DependencyInfo[] = [
    {
      name: 'react',
      requestedVersion: '18.0.0',
      resolvedVersion: '18.0.0',
      type: 'dependency',
    },
    {
      name: 'react',
      requestedVersion: '17.0.2',
      resolvedVersion: '17.0.2',
      type: 'devDependency',
    },
  ];

  const duplicates = detectDuplicateDependencies(deps);
  assert.equal(duplicates[0].severity, 'critical');
});

test('isReactNativeCompatible - detects RN 0.x with React 18+', () => {
  const result = isReactNativeCompatible('0.73.0', '18.2.0');
  assert.equal(result.compatible, false);
  assert(result.issue?.includes('React 16.x or 17.x'));
});

test('isReactNativeCompatible - detects RN 1.x with old React', () => {
  const result = isReactNativeCompatible('1.0.0', '17.0.2');
  assert.equal(result.compatible, false);
  assert(result.issue?.includes('React 18+'));
});

test('isReactNativeCompatible - allows compatible combinations', () => {
  const result1 = isReactNativeCompatible('0.73.0', '17.0.2');
  assert.equal(result1.compatible, true);

  const result2 = isReactNativeCompatible('1.0.0', '18.2.0');
  assert.equal(result2.compatible, true);
});
