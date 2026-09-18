import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeIosPackage } from '../src/analyzers/iosPackage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', 'test-fixtures', 'ipa');

test('analyzeIosPackage - reports hasDsym true when a matching dSYM entry exists', () => {
  const result = analyzeIosPackage(join(fixtureDir, 'with-dsym.ipa'));

  assert.equal(result.appName, 'MyApp');
  assert.equal(result.hasDsym, true);
  assert.equal(result.notes.length, 0);
});

test('analyzeIosPackage - reports hasDsym false and a note when no dSYM entry exists', () => {
  const result = analyzeIosPackage(join(fixtureDir, 'without-dsym.ipa'));

  assert.equal(result.appName, 'MyApp');
  assert.equal(result.hasDsym, false);
  assert.ok(result.notes[0]!.includes('No dSYM found'));
});

test('analyzeIosPackage - reports a note instead of throwing for a non-zip file', () => {
  const result = analyzeIosPackage(join(fixtureDir, 'not-a-zip.ipa'));

  assert.equal(result.hasDsym, false);
  assert.equal(result.appName, null);
  assert.ok(result.notes[0]!.includes('Could not read'));
});

test('analyzeIosPackage - reports a note instead of throwing for a missing path', () => {
  const result = analyzeIosPackage(join(fixtureDir, 'does-not-exist.ipa'));

  assert.equal(result.hasDsym, false);
  assert.equal(result.appName, null);
});
