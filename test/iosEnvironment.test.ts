import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDeploymentTarget } from '../src/detectors/ios/deploymentTarget.js';
import { detectCocoaPodsVersion } from '../src/detectors/ios/cocoapods.js';
import { detectRubyVersion } from '../src/detectors/ios/ruby.js';
import { detectXcodeHints, detectSwiftVersionHint } from '../src/detectors/ios/xcode.js';
import { analyzeIosEnvironment } from '../src/analyzers/iosEnvironment.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ios-env-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('detectDeploymentTarget - normal Podfile with deployment target', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(
      join(dir, 'ios', 'Podfile'),
      "platform :ios, '13.4'\n\ntarget 'MyApp' do\nend\n"
    );

    const result = detectDeploymentTarget(dir);
    assert.equal(result.version, '13.4');
    assert.equal(result.source, 'podfile');
  } finally {
    cleanup(dir);
  }
});

test('detectDeploymentTarget - falls back to xcconfig when no Podfile', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'ios', 'MyApp.xcodeproj'), { recursive: true });
    writeFileSync(
      join(dir, 'ios', 'MyApp.xcodeproj', 'Config.xcconfig'),
      'IPHONEOS_DEPLOYMENT_TARGET = 12.0\n'
    );

    const result = detectDeploymentTarget(dir);
    assert.equal(result.version, '12.0');
    assert.equal(result.source, 'xcconfig');
  } finally {
    cleanup(dir);
  }
});

test('detectDeploymentTarget - missing ios directory returns null/unknown', () => {
  const dir = makeTempDir();
  try {
    const result = detectDeploymentTarget(dir);
    assert.equal(result.version, null);
    assert.equal(result.source, 'unknown');
  } finally {
    cleanup(dir);
  }
});

test('detectCocoaPodsVersion - Podfile.lock with COCOAPODS version line', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(
      join(dir, 'ios', 'Podfile.lock'),
      'PODFILE CHECKSUM: abc123\n\nCOCOAPODS: 1.14.3\n'
    );

    const version = detectCocoaPodsVersion(dir);
    assert.equal(version, '1.14.3');
  } finally {
    cleanup(dir);
  }
});

test('detectCocoaPodsVersion - missing Podfile.lock returns null', () => {
  const dir = makeTempDir();
  try {
    const version = detectCocoaPodsVersion(dir);
    assert.equal(version, null);
  } finally {
    cleanup(dir);
  }
});

test('detectRubyVersion - .ruby-version present takes priority', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.ruby-version'), '3.2.2\n');
    writeFileSync(join(dir, 'Gemfile'), 'ruby "2.7.6"\n');

    const result = detectRubyVersion(dir);
    assert.equal(result.version, '3.2.2');
    assert.equal(result.source, '.ruby-version');
  } finally {
    cleanup(dir);
  }
});

test('detectRubyVersion - falls back to Gemfile when .ruby-version absent', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'Gemfile'), 'source "https://rubygems.org"\nruby "2.7.6"\n');

    const result = detectRubyVersion(dir);
    assert.equal(result.version, '2.7.6');
    assert.equal(result.source, 'Gemfile');
  } finally {
    cleanup(dir);
  }
});

test('detectRubyVersion - absent both files reports unknown, not a guess', () => {
  const dir = makeTempDir();
  try {
    const result = detectRubyVersion(dir);
    assert.equal(result.version, null);
    assert.equal(result.source, 'unknown');
  } finally {
    cleanup(dir);
  }
});

test('detectXcodeHints - missing ios directory returns nulls, does not throw', () => {
  const dir = makeTempDir();
  try {
    const result = detectXcodeHints(dir);
    assert.equal(result.version, null);
    assert.equal(result.deploymentTarget, null);
  } finally {
    cleanup(dir);
  }
});

test('detectSwiftVersionHint - always unknown with an explanatory reason', () => {
  const hint = detectSwiftVersionHint();
  assert.equal(hint.status, 'unknown');
  assert.ok(hint.reason.length > 0);
});

test('analyzeIosEnvironment - missing ios/ directory produces unknown statuses, does not throw', () => {
  const dir = makeTempDir();
  try {
    const results = analyzeIosEnvironment(dir, '0.72.0');
    assert.ok(results.length > 0);
    for (const result of results) {
      assert.equal(result.status, 'unknown');
    }
  } finally {
    cleanup(dir);
  }
});

test('analyzeIosEnvironment - full ios project produces detected values without throwing', () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(join(dir, 'ios', 'Podfile'), "platform :ios, '13.4'\n");
    writeFileSync(join(dir, 'ios', 'Podfile.lock'), 'COCOAPODS: 1.14.3\n');
    writeFileSync(join(dir, '.ruby-version'), '3.2.2\n');

    const results = analyzeIosEnvironment(dir, '0.72.0');
    const deploymentTarget = results.find((r) => r.name === 'iOS Deployment Target');
    const cocoapods = results.find((r) => r.name === 'CocoaPods');
    const ruby = results.find((r) => r.name === 'Ruby');
    const swift = results.find((r) => r.name === 'Swift');

    assert.equal(deploymentTarget?.current, '13.4');
    assert.equal(cocoapods?.current, '1.14.3');
    assert.equal(ruby?.current, '3.2.2');
    assert.equal(swift?.status, 'unknown');
  } finally {
    cleanup(dir);
  }
});
