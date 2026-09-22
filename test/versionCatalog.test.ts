import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAgpVersion } from '../src/detectors/android/agp.js';
import { detectKotlinVersion } from '../src/detectors/android/kotlin.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'version-catalog-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('detectAgpVersion - falls back to gradle/libs.versions.toml when no build.gradle has a literal version', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'gradle'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'settings.gradle'),
      `
pluginManagement {
    includeBuild("../node_modules/@react-native/gradle-plugin")
    plugins {
        id("com.facebook.react.settings")
    }
}
plugins {
    id("com.android.application") apply false
}
`,
    );
    writeFileSync(
      join(dir, 'android', 'gradle', 'libs.versions.toml'),
      `
[versions]
agp = "8.6.0"
kotlin = "1.9.24"

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
`,
    );

    const result = detectAgpVersion(dir);
    assert.equal(result.version, '8.6.0');
    assert.match(result.source ?? '', /libs\.versions\.toml$/);
  } finally {
    cleanup(dir);
  }
});

test('detectKotlinVersion - falls back to gradle/libs.versions.toml', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'gradle'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'gradle', 'libs.versions.toml'),
      `
[versions]
agp = "8.6.0"
kotlin = "1.9.24"
`,
    );

    const result = detectKotlinVersion(dir);
    assert.equal(result.version, '1.9.24');
  } finally {
    cleanup(dir);
  }
});

test('detectAgpVersion - a literal version in build.gradle still takes precedence over the catalog', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android', 'gradle'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'build.gradle'),
      `classpath("com.android.tools.build:gradle:8.3.1")`,
    );
    writeFileSync(
      join(dir, 'android', 'gradle', 'libs.versions.toml'),
      `[versions]\nagp = "8.6.0"\n`,
    );

    const result = detectAgpVersion(dir);
    assert.equal(result.version, '8.3.1');
  } finally {
    cleanup(dir);
  }
});

test('detectAgpVersion - plugin DSL version declared in settings.gradle is detected', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'android'), { recursive: true });
    writeFileSync(
      join(dir, 'android', 'settings.gradle'),
      `
pluginManagement {
    plugins {
        id("com.android.application") version "8.6.0" apply false
    }
}
`,
    );

    const result = detectAgpVersion(dir);
    assert.equal(result.version, '8.6.0');
    assert.match(result.source ?? '', /settings\.gradle$/);
  } finally {
    cleanup(dir);
  }
});

test('detectAgpVersion - no build.gradle, no settings.gradle, no catalog reports nothing', () => {
  const dir = makeTempDir();
  try {
    const result = detectAgpVersion(dir);
    assert.equal(result.version, undefined);
  } finally {
    cleanup(dir);
  }
});
