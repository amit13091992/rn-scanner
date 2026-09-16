import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectExpo } from '../src/detectors/expo.js';
import { analyzeExpoCompatibility } from '../src/analyzers/expoCompatibility.js';
import { getExpoSdkRequirements, EXPO_SDK_REGISTRY } from '../src/data/expo/registry.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'expo-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('detectExpo - not an Expo project when no expo dependency or config exists', () => {
  const dir = makeTempDir();
  try {
    const result = detectExpo(dir, {});
    assert.equal(result.isExpo, false);
    assert.equal(result.sdkVersion, null);
  } finally {
    cleanup(dir);
  }
});

test('detectExpo - reads SDK major version from package.json expo dependency', () => {
  const dir = makeTempDir();
  try {
    const result = detectExpo(dir, { dependencies: { expo: '~52.0.11' } });
    assert.equal(result.isExpo, true);
    assert.equal(result.sdkVersion, 52);
  } finally {
    cleanup(dir);
  }
});

test('detectExpo - falls back to app.json expo.sdkVersion when no expo dependency', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { sdkVersion: '50.0.0' } }));
    const result = detectExpo(dir, {});
    assert.equal(result.isExpo, true);
    assert.equal(result.sdkVersion, 50);
  } finally {
    cleanup(dir);
  }
});

test('detectExpo - malformed app.json does not throw', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'app.json'), '{ not valid json');
    const result = detectExpo(dir, {});
    assert.equal(result.isExpo, false);
  } finally {
    cleanup(dir);
  }
});

test('getExpoSdkRequirements - every registry entry has a reactNative baseline', () => {
  for (const entry of EXPO_SDK_REGISTRY) {
    assert.ok(entry.reactNative.length > 0);
  }
});

test('analyzeExpoCompatibility - non-Expo project reports isExpoProject false with no messages', () => {
  const dir = makeTempDir();
  try {
    const result = analyzeExpoCompatibility(dir, '0.76.0', {});
    assert.equal(result.isExpoProject, false);
    assert.deepEqual(result.messages, []);
  } finally {
    cleanup(dir);
  }
});

test('analyzeExpoCompatibility - matching React Native version produces no messages', () => {
  const dir = makeTempDir();
  try {
    const result = analyzeExpoCompatibility(dir, '0.76.3', { dependencies: { expo: '~52.0.11' } });
    assert.equal(result.isExpoProject, true);
    assert.equal(result.sdkVersion, 52);
    assert.equal(result.reactNativeMismatch, false);
    assert.equal(result.messages.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('analyzeExpoCompatibility - mismatched React Native version is flagged', () => {
  const dir = makeTempDir();
  try {
    const result = analyzeExpoCompatibility(dir, '0.74.0', { dependencies: { expo: '~52.0.11' } });
    assert.equal(result.reactNativeMismatch, true);
    assert.ok(result.messages.some((m) => m.includes('expo install --fix')));
  } finally {
    cleanup(dir);
  }
});

test('analyzeExpoCompatibility - SDK requiring New Architecture is flagged', () => {
  const dir = makeTempDir();
  try {
    const result = analyzeExpoCompatibility(dir, '0.86.0', { dependencies: { expo: '~57.0.0' } });
    assert.equal(result.newArchRequired, true);
    assert.ok(result.messages.some((m) => m.includes('New Architecture')));
  } finally {
    cleanup(dir);
  }
});

test('analyzeExpoCompatibility - unknown SDK version outside registry does not throw', () => {
  const dir = makeTempDir();
  try {
    const result = analyzeExpoCompatibility(dir, '0.99.0', { dependencies: { expo: '~99.0.0' } });
    assert.equal(result.isExpoProject, true);
    assert.equal(result.sdkVersion, 99);
    assert.ok(result.messages.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('analyzeExpoCompatibility - SDK detected but version unparseable does not throw', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'MyApp' } }));
    const result = analyzeExpoCompatibility(dir, '0.76.0', {});
    assert.equal(result.isExpoProject, true);
    assert.equal(result.sdkVersion, null);
    assert.ok(result.messages.length > 0);
  } finally {
    cleanup(dir);
  }
});
