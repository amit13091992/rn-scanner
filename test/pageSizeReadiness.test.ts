import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzePageSizeBuildConfig,
  describePageSizeDeadline,
  formatPageSizeDeadline,
} from '../src/analyzers/pageSizeReadiness.js';

function withAndroidProject(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'page-size-readiness-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('describePageSizeDeadline - counts days before the Play cutoff and flags it once passed', () => {
  const before = describePageSizeDeadline(new Date('2027-01-22T00:00:00Z'));
  assert.equal(before.daysRemaining, 10);
  assert.equal(before.passed, false);
  assert.match(formatPageSizeDeadline(before), /10 days left/);

  const after = describePageSizeDeadline(new Date('2027-02-02T00:00:00Z'));
  assert.equal(after.passed, true);
  assert.match(formatPageSizeDeadline(after), /took effect on 2027-02-01/);
});

test('analyzePageSizeBuildConfig - warns on AGP < 8.5.1 and NDK < r27', () => {
  withAndroidProject(
    {
      'android/build.gradle': "buildscript { dependencies { classpath('com.android.tools.build:gradle:8.1.0') } }\n",
      'android/app/build.gradle': 'android { ndkVersion "25.1.8937393" }\n',
    },
    (dir) => {
      const results = analyzePageSizeBuildConfig(dir);
      assert.equal(results.find((r) => r.name.endsWith('Gradle Plugin'))?.status, 'warning');
      const ndk = results.find((r) => r.name.endsWith('NDK'));
      assert.equal(ndk?.status, 'warning');
      assert.match(ndk?.reason ?? '', /max-page-size=16384/);
    }
  );
});

test('analyzePageSizeBuildConfig - passes on AGP 8.5.1+ and NDK r27+', () => {
  withAndroidProject(
    {
      'android/build.gradle': "buildscript { dependencies { classpath('com.android.tools.build:gradle:8.5.1') } }\n",
      'android/app/build.gradle': 'android { ndkVersion "27.1.12297006" }\n',
    },
    (dir) => {
      const results = analyzePageSizeBuildConfig(dir);
      assert.equal(results.length, 2);
      assert.ok(results.every((r) => r.status === 'ok'));
    }
  );
});

test('analyzePageSizeBuildConfig - omits an undetectable version and returns nothing without android/', () => {
  withAndroidProject({ 'android/build.gradle': '// no versions declared\n' }, (dir) => {
    assert.deepEqual(analyzePageSizeBuildConfig(dir), []);
  });
  const empty = mkdtempSync(join(tmpdir(), 'page-size-readiness-empty-'));
  try {
    assert.deepEqual(analyzePageSizeBuildConfig(empty), []);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
