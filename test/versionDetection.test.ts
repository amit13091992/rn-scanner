import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  detectVersionMismatches,
  detectDuplicateDependencies,
  isReactNativeCompatible,
} from '../src/utils/versionDetection.js';
import type { DependencyInfo } from '../src/types/dependency.js';

test('detectVersionMismatches - only flags installs outside the declared range', () => {
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
    {
      name: 'old-package',
      requestedVersion: '^2.0.0',
      resolvedVersion: '1.5.0',
      type: 'dependency',
    },
  ];

  const mismatches = detectVersionMismatches(deps);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].package, 'old-package');
  assert.equal(mismatches[0].declared, '^2.0.0');
  assert.equal(mismatches[0].installed, '1.5.0');
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

test('isReactNativeCompatible - detects RN pre-0.69 with React 18+', () => {
  const result = isReactNativeCompatible('0.68.0', '18.2.0');
  assert.equal(result.compatible, false);
  assert(result.issue?.includes('React 16.x or 17.x'));
});

test('isReactNativeCompatible - detects RN 0.69+ with old React', () => {
  const result = isReactNativeCompatible('0.73.0', '17.0.2');
  assert.equal(result.compatible, false);
  assert(result.issue?.includes('React 18+'));
});

test('isReactNativeCompatible - allows compatible combinations', () => {
  const result1 = isReactNativeCompatible('0.68.0', '17.0.2');
  assert.equal(result1.compatible, true);

  const result2 = isReactNativeCompatible('0.83.0', '19.2.0');
  assert.equal(result2.compatible, true);
});
