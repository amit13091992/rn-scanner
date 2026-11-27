import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeSwiftPmSupport } from '../src/analyzers/swiftPmSupport.js';
import { detectIosPackagingFiles } from '../src/detectors/ios/swiftPackage.js';
import { doctorCommand } from '../src/commands/doctor.js';
import type { DependencyInfo } from '../src/types/dependency.js';

function dep(name: string): DependencyInfo {
  return { name, requestedVersion: '1.0.0', resolvedVersion: '1.0.0' } as DependencyInfo;
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swiftpm-'));
  const install = (name: string, files: string[]): void => {
    for (const f of files) {
      mkdirSync(join(dir, 'node_modules', name, f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, f), '');
    }
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'js-only': '1.0.0', 'pods-only': '1.0.0', 'has-spm': '1.0.0', 'spm-in-ios': '1.0.0' } }));
  install('js-only', ['index.js']);
  install('pods-only', ['pods-only.podspec']);
  install('has-spm', ['has-spm.podspec', 'Package.swift']);
  install('spm-in-ios', ['ios/Package.swift']);
  return dir;
}

test('detectIosPackagingFiles - reports podspec and Package.swift at root or ios/, null when not installed', () => {
  const dir = project();
  try {
    assert.deepEqual(detectIosPackagingFiles(dir, 'pods-only'), { podspec: true, packageSwift: false });
    assert.deepEqual(detectIosPackagingFiles(dir, 'spm-in-ios'), { podspec: false, packageSwift: true });
    assert.deepEqual(detectIosPackagingFiles(dir, 'js-only'), { podspec: false, packageSwift: false });
    assert.equal(detectIosPackagingFiles(dir, 'missing'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeSwiftPmSupport - lists native packages, skips JS-only, reports uninstalled separately', () => {
  const dir = project();
  try {
    const result = analyzeSwiftPmSupport(dir, [dep('js-only'), dep('pods-only'), dep('has-spm'), dep('spm-in-ios'), dep('ghost')]);
    assert.deepEqual(result.packages.map((p) => [p.package, p.status]), [
      ['has-spm', 'ships-package-swift'],
      ['pods-only', 'cocoapods-only'],
      ['spm-in-ios', 'ships-package-swift'],
    ]);
    assert.deepEqual(result.notInstalled, ['ghost']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function doctorJson(dir: string): Promise<Record<string, unknown>> {
  const original = console.log;
  let out = '';
  console.log = (m?: unknown) => {
    out += `${String(m)}\n`;
  };
  try {
    await doctorCommand({ cwd: dir, json: true });
  } finally {
    console.log = original;
  }
  return JSON.parse(out);
}

test('doctor - includes swiftPmSupport for an RN 0.87+ CocoaPods project, omits it otherwise', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'react-native': '0.88.0', 'pods-only': '1.0.0' } }));
    mkdirSync(join(dir, 'node_modules', 'react-native'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'react-native', 'package.json'), JSON.stringify({ name: 'react-native', version: '0.88.0' }));
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(join(dir, 'ios', 'Podfile'), '');
    const withIos = await doctorJson(dir) as { swiftPmSupport?: { packages: Array<{ package: string }> } };
    assert.deepEqual(withIos.swiftPmSupport?.packages.map((p) => p.package), ['pods-only']);

    rmSync(join(dir, 'ios'), { recursive: true });
    assert.equal('swiftPmSupport' in (await doctorJson(dir)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
