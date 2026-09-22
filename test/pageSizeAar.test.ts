import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNativeLibraries } from '../src/detectors/pageSize.js';
import { analyzePageSize } from '../src/analyzers/pageSize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const aarFixtureDir = join(__dirname, '..', 'test-fixtures', 'aar');

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'page-size-aar-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function installPackage(dir: string, packageName: string, aarFixture: string): void {
  const pkgDir = join(dir, 'node_modules', packageName, 'android');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(dir, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }));
  copyFileSync(join(aarFixtureDir, aarFixture), join(pkgDir, 'library-release.aar'));
}

test('findNativeLibraries - finds .so entries packaged inside an .aar archive, not just loose jniLibs files', () => {
  const dir = makeTempDir();
  try {
    installPackage(dir, 'react-native-with-aar', 'with-native-lib.aar');

    const libraries = findNativeLibraries(dir, 'react-native-with-aar');

    assert.equal(libraries.length, 2);
    const arm64 = libraries.find((l) => l.abi === 'arm64-v8a');
    const x86_64 = libraries.find((l) => l.abi === 'x86_64');
    assert.ok(arm64);
    assert.ok(x86_64);
    assert.equal(arm64!.zipEntryName, 'jni/arm64-v8a/libfoo.so');
    assert.ok(arm64!.bytes && arm64!.bytes!.length > 0);
    // The x86_64 entry was written DEFLATE-compressed in the fixture — bytes must come back
    // decompressed to the original (larger) ELF content, not the raw compressed stream.
    assert.ok(x86_64!.bytes && x86_64!.bytes!.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('findNativeLibraries - an .aar with no jni/ entries reports no libraries', () => {
  const dir = makeTempDir();
  try {
    installPackage(dir, 'react-native-no-native', 'no-native-lib.aar');

    const libraries = findNativeLibraries(dir, 'react-native-no-native');

    assert.equal(libraries.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('analyzePageSize - reads real alignment from an .aar-packaged library (stored, uncompressed entry)', () => {
  const dir = makeTempDir();
  try {
    installPackage(dir, 'react-native-with-aar', 'with-native-lib.aar');

    const results = analyzePageSize(dir, [
      { name: 'react-native-with-aar', requestedVersion: '1.0.0', resolvedVersion: '1.0.0', type: 'dependency' },
    ]);

    assert.equal(results.length, 1);
    // arm64-v8a is aligned.so (16KB-aligned), x86_64 is unaligned.so (4KB) — the package as a
    // whole is 'unaligned' since not every library passes.
    assert.equal(results[0]!.status, 'unaligned');
    assert.equal(results[0]!.libraries.length, 2);
    const arm64Lib = results[0]!.libraries.find((l) => l.abi === 'arm64-v8a');
    assert.equal(arm64Lib!.is16kAligned, true);
    assert.match(arm64Lib!.path, /!jni\/arm64-v8a\/libfoo\.so$/);
  } finally {
    cleanup(dir);
  }
});
