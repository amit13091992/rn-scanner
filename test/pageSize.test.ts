import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findNativeLibraries } from '../src/detectors/pageSize.js';
import { analyzePageSize } from '../src/analyzers/pageSize.js';
import type { DependencyInfo } from '../src/types/dependency.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureCwd = join(__dirname, '..', 'test-fixtures', 'page-size');

function makeDep(name: string, version: string): DependencyInfo {
  return { name, requestedVersion: `^${version}`, resolvedVersion: version, type: 'dependency' };
}

test('findNativeLibraries - finds .so files under jniLibs/<abi>/ for both relevant ABIs', () => {
  const files = findNativeLibraries(fixtureCwd, 'native-aligned-pkg');

  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.abi === 'arm64-v8a'));
  assert.ok(files.some((f) => f.abi === 'x86_64'));
});

test('findNativeLibraries - returns empty for a package with no native libraries', () => {
  const files = findNativeLibraries(fixtureCwd, 'js-only-pkg');

  assert.equal(files.length, 0);
});

test('findNativeLibraries - returns empty for a package that is not installed', () => {
  const files = findNativeLibraries(fixtureCwd, 'never-installed-pkg');

  assert.equal(files.length, 0);
});

test('analyzePageSize - reports aligned for a package whose .so files are all 16KB-aligned', () => {
  const [result] = analyzePageSize(fixtureCwd, [makeDep('native-aligned-pkg', '1.0.0')]);

  assert.equal(result!.status, 'aligned');
  assert.equal(result!.libraries.length, 2);
});

test('analyzePageSize - reports unaligned for a package with a 4KB-aligned .so', () => {
  const [result] = analyzePageSize(fixtureCwd, [makeDep('native-unaligned-pkg', '2.0.0')]);

  assert.equal(result!.status, 'unaligned');
  assert.equal(result!.libraries[0]!.is16kAligned, false);
});

test('analyzePageSize - reports not-checked for a package with no native libraries', () => {
  const [result] = analyzePageSize(fixtureCwd, [makeDep('js-only-pkg', '1.0.0')]);

  assert.equal(result!.status, 'not-checked');
  assert.equal(result!.libraries.length, 0);
});
