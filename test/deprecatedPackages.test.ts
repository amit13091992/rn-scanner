import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isDeprecated, checkDeprecatedPackages } from '../src/data/deprecatedPackages.js';

test('isDeprecated - finds deprecated packages', () => {
  const result = isDeprecated('react-native-vector-icons-old');
  assert(result);
  assert.equal(result.name, 'react-native-vector-icons-old');
  assert(result.replacement);
});

test('isDeprecated - returns undefined for non-deprecated', () => {
  const result = isDeprecated('react');
  assert.equal(result, undefined);
});

test('checkDeprecatedPackages - identifies all deprecated in list', () => {
  const packages = [
    'react',
    'react-native-vector-icons-old',
    'lodash',
    'react-navigation-deprecated',
  ];

  const deprecated = checkDeprecatedPackages(packages);
  assert.equal(deprecated.length, 2);
  assert(deprecated.some(d => d.name === 'react-native-vector-icons-old'));
  assert(deprecated.some(d => d.name === 'react-navigation-deprecated'));
});

test('checkDeprecatedPackages - empty list when none deprecated', () => {
  const packages = ['react', 'react-native', 'lodash'];
  const deprecated = checkDeprecatedPackages(packages);
  assert.equal(deprecated.length, 0);
});
