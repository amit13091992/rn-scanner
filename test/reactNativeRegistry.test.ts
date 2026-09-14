import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getReactNativeRequirements } from '../src/data/reactNative/index.js';
import { REACT_NATIVE_REQUIREMENTS_REGISTRY as REGISTRY } from '../src/data/reactNative/registry.js';

test('getReactNativeRequirements - covers RN 0.85 through 0.87 with a node baseline', () => {
  for (const version of ['0.85', '0.86', '0.87']) {
    const req = getReactNativeRequirements(version);
    assert.ok(req, `expected a registry entry for ${version}`);
    assert.equal(req?.version, version);
    assert.ok(req?.node, `expected a node baseline for ${version}`);
    assert.ok(req?.android.compileSdk, `expected android requirements for ${version}`);
    assert.ok(req?.ios.xcode, `expected ios requirements for ${version}`);
  }
});

test('getReactNativeRequirements - 0.87 reflects the compileSdk/buildTools 37 bump', () => {
  const req = getReactNativeRequirements('0.87');
  assert.equal(req?.android.compileSdk, '37');
  assert.equal(req?.android.buildToolsVersion, '37.0.0');
  assert.equal(req?.node, '22.13.0');
});

test('getReactNativeRequirements - every registry entry has a node baseline', () => {
  for (const version of ['0.70', '0.71', '0.72', '0.73', '0.74', '0.75', '0.76', '0.77', '0.78', '0.79', '0.80', '0.81', '0.82', '0.83', '0.84', '0.85', '0.86', '0.87']) {
    const req = getReactNativeRequirements(version);
    assert.ok(req?.node, `expected a node baseline for ${version}`);
  }
});

function toMinor(version: string): number {
  const match = /^0\.(\d+)/.exec(version);
  assert.ok(match, `registry version "${version}" is not in the expected 0.x form`);
  return Number(match![1]);
}

function toSemverParts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareSemver(a: string, b: string): number {
  const aParts = toSemverParts(a);
  const bParts = toSemverParts(b);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

test('registry structural discipline - no gaps between consecutive minor versions', () => {
  const minors = REGISTRY.map((entry) => toMinor(entry.version)).sort((a, b) => a - b);
  for (let i = 1; i < minors.length; i++) {
    assert.equal(
      minors[i],
      minors[i - 1]! + 1,
      `registry has a gap between 0.${minors[i - 1]} and 0.${minors[i]} — every RN minor in range must have an entry`,
    );
  }
});

test('registry structural discipline - every entry has all required fields populated', () => {
  const androidFields = ['jdk', 'kotlin', 'agp', 'gradle', 'compileSdk', 'targetSdk', 'minSdk', 'ndk', 'buildToolsVersion'] as const;
  const iosFields = ['xcode', 'deploymentTarget', 'cocoapods', 'ruby', 'swift'] as const;

  for (const entry of REGISTRY) {
    assert.ok(entry.node, `${entry.version} is missing a node baseline`);
    for (const field of androidFields) {
      assert.ok(entry.android[field], `${entry.version} is missing android.${field}`);
    }
    for (const field of iosFields) {
      assert.ok(entry.ios[field], `${entry.version} is missing ios.${field}`);
    }
  }
});

test('registry structural discipline - node baseline never decreases across versions', () => {
  const sorted = [...REGISTRY].sort((a, b) => toMinor(a.version) - toMinor(b.version));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    assert.ok(
      compareSemver(curr.node, prev.node) >= 0,
      `node baseline regressed from ${prev.node} (${prev.version}) to ${curr.node} (${curr.version}) — later RN versions should never require an older Node`,
    );
  }
});
