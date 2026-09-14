import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeAndroidEnvironment } from '../src/analyzers/androidEnvironment.js';
import { detectGradleVersion } from '../src/detectors/android/gradle.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'android-env-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('analyzeAndroidEnvironment - old-syntax build.gradle', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'build.gradle'),
      `
buildscript {
    ext {
        kotlinVersion = "1.9.24"
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.3.1")
    }
}
`,
    );
    writeFileSync(
      join(dir, 'android', 'app', 'build.gradle'),
      `
android {
    compileSdkVersion 34
    ndkVersion "26.1.10909125"
    buildToolsVersion "34.0.0"

    defaultConfig {
        targetSdkVersion 34
        minSdkVersion 23
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}
`,
    );

    const results = analyzeAndroidEnvironment(dir, '0.74.0');
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    assert.equal(byName['JDK']?.current, '17');
    assert.equal(byName['JDK']?.status, 'ok');
    assert.equal(byName['Kotlin']?.current, '1.9.24');
    assert.equal(byName['Android Gradle Plugin (AGP)']?.current, '8.3.1');
    assert.equal(byName['compileSdk']?.current, '34');
    assert.equal(byName['targetSdk']?.current, '34');
    assert.equal(byName['minSdk']?.current, '23');
    assert.equal(byName['NDK']?.current, '26.1.10909125');
    assert.equal(byName['Build Tools']?.current, '34.0.0');
  } finally {
    cleanup(dir);
  }
});

test('analyzeAndroidEnvironment - new-syntax build.gradle.kts', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'build.gradle.kts'),
      `
plugins {
    id("com.android.application") version "8.6.0" apply false
    kotlin("android") version "2.0.21" apply false
}
`,
    );
    writeFileSync(
      join(dir, 'android', 'app', 'build.gradle.kts'),
      `
android {
    compileSdk = 35
    ndkVersion = "27.1.12297006"

    defaultConfig {
        targetSdk = 35
        minSdk = 24
    }
}
`,
    );

    const results = analyzeAndroidEnvironment(dir, '0.77.0');
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    assert.equal(byName['Kotlin']?.current, '2.0.21');
    assert.equal(byName['Android Gradle Plugin (AGP)']?.current, '8.6.0');
    assert.equal(byName['compileSdk']?.current, '35');
    assert.equal(byName['targetSdk']?.current, '35');
    assert.equal(byName['minSdk']?.current, '24');
    assert.equal(byName['NDK']?.current, '27.1.12297006');
  } finally {
    cleanup(dir);
  }
});

test('analyzeAndroidEnvironment - missing android/ directory returns unknown, does not throw', () => {
  const dir = makeTempDir();
  try {
    assert.doesNotThrow(() => analyzeAndroidEnvironment(dir, '0.75.0'));
    const results = analyzeAndroidEnvironment(dir, '0.75.0');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, 'unknown');
    assert.match(results[0]?.reason ?? '', /No android\/ directory/);
  } finally {
    cleanup(dir);
  }
});

test('analyzeAndroidEnvironment - android/ present but no gradle files yields unknown statuses, not throw', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android'), { recursive: true });
    assert.doesNotThrow(() => analyzeAndroidEnvironment(dir, '0.76.0'));
    const results = analyzeAndroidEnvironment(dir, '0.76.0');
    for (const r of results) {
      assert.ok(r.status === 'unknown' || r.name === 'Build Tools');
    }
  } finally {
    cleanup(dir);
  }
});

test('detectGradleVersion - parses distributionUrl from gradle-wrapper.properties', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'gradle', 'wrapper'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      `distributionBase=GRADLE_USER_HOME
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-all.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
    );

    const result = detectGradleVersion(dir);
    assert.equal(result.version, '8.10.2');
  } finally {
    cleanup(dir);
  }
});

test('detectGradleVersion - missing wrapper file returns empty result, not throw', () => {
  const dir = makeTempDir();
  try {
    assert.doesNotThrow(() => detectGradleVersion(dir));
    const result = detectGradleVersion(dir);
    assert.equal(result.version, undefined);
  } finally {
    cleanup(dir);
  }
});
