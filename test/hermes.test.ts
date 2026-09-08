import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectHermes } from '../src/detectors/hermes.js';
import { analyzeHermes } from '../src/analyzers/hermes.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'hermes-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('detectHermes - Android gradle.properties hermesEnabled=true', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android'), { recursive: true });
    writeFileSync(join(dir, 'android', 'gradle.properties'), 'hermesEnabled=true\n');

    const result = detectHermes(dir, '0.72.0');
    assert.equal(result.enabled, true);
    assert.equal(result.detectedFrom, 'android-gradle-properties');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - Android gradle.properties hermesEnabled=false (quoted, case-insensitive)', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android'), { recursive: true });
    writeFileSync(join(dir, 'android', 'gradle.properties'), 'HermesEnabled = "false"\n');

    const result = detectHermes(dir, '0.72.0');
    assert.equal(result.enabled, false);
    assert.equal(result.detectedFrom, 'android-gradle-properties');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - iOS Podfile :hermes_enabled => true', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(join(dir, 'ios', 'Podfile'), "use_react_native!(\n  :hermes_enabled => true\n)\n");

    const result = detectHermes(dir, '0.71.0');
    assert.equal(result.enabled, true);
    assert.equal(result.detectedFrom, 'ios-podfile');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - legacy Android build.gradle enableHermes: false', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'app', 'build.gradle'),
      'project.ext.react = [\n  enableHermes: false\n]\n'
    );

    const result = detectHermes(dir, '0.68.0');
    assert.equal(result.enabled, false);
    assert.equal(result.detectedFrom, 'android-build-gradle');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - Expo app.json jsEngine hermes', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { jsEngine: 'hermes' } }));

    const result = detectHermes(dir, '0.69.0');
    assert.equal(result.enabled, true);
    assert.equal(result.detectedFrom, 'expo-config');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - Expo app.json jsEngine jsc', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { jsEngine: 'jsc' } }));

    const result = detectHermes(dir, '0.73.0');
    assert.equal(result.enabled, false);
    assert.equal(result.detectedFrom, 'expo-config');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - no explicit config, RN >=0.70 defaults to enabled', () => {
  const dir = makeTempDir();
  try {
    const result = detectHermes(dir, '0.72.0');
    assert.equal(result.enabled, true);
    assert.equal(result.detectedFrom, 'default');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - no explicit config, RN <0.70 is unknown', () => {
  const dir = makeTempDir();
  try {
    const result = detectHermes(dir, '0.65.0');
    assert.equal(result.enabled, null);
    assert.equal(result.detectedFrom, 'unknown');
  } finally {
    cleanup(dir);
  }
});

test('detectHermes - no explicit config, no RN version is unknown', () => {
  const dir = makeTempDir();
  try {
    const result = detectHermes(dir, null);
    assert.equal(result.enabled, null);
    assert.equal(result.detectedFrom, 'unknown');
  } finally {
    cleanup(dir);
  }
});

test('analyzeHermes - enabled status', () => {
  const result = analyzeHermes({ enabled: true, detectedFrom: 'android-gradle-properties', reactNativeVersion: '0.72.0' });
  assert.equal(result.status, 'enabled');
  assert.equal(result.messages.length, 0);
});

test('analyzeHermes - disabled on RN >=0.70 produces warning message', () => {
  const result = analyzeHermes({ enabled: false, detectedFrom: 'android-gradle-properties', reactNativeVersion: '0.72.0' });
  assert.equal(result.status, 'disabled');
  assert.equal(result.messages.length, 1);
  assert(result.messages[0].includes('disabled'));
});

test('analyzeHermes - disabled on RN <0.70 produces no warning', () => {
  const result = analyzeHermes({ enabled: false, detectedFrom: 'android-gradle-properties', reactNativeVersion: '0.65.0' });
  assert.equal(result.status, 'disabled');
  assert.equal(result.messages.length, 0);
});

test('analyzeHermes - unknown status', () => {
  const result = analyzeHermes({ enabled: null, detectedFrom: 'unknown', reactNativeVersion: null });
  assert.equal(result.status, 'unknown');
  assert.equal(result.messages.length, 0);
});
