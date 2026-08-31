import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readPackageJson } from '../src/utils/packageJson.js';
import { detectPackageManager, parseLockfile } from '../src/utils/lockfile.js';
import { detectReactNativeVersions } from '../src/detectors/reactNative.js';
import { analyzeAllDependencies } from '../src/analyzers/compatibility.js';
import { analyzeBreakingChanges } from '../src/analyzers/breakingChanges.js';

describe('Integration Tests - Package Manager Detection', () => {
  test('detects npm as default package manager', () => {
    const tmpDir = join(tmpdir(), `npm-detect-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');

    const result = detectPackageManager(tmpDir);
    strictEqual(result.manager, 'npm');
  });

  test('detects yarn when yarn.lock exists', () => {
    const tmpDir = join(tmpdir(), `yarn-detect-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    const result = detectPackageManager(tmpDir);
    strictEqual(result.manager, 'yarn');
  });

  test('detects pnpm when pnpm-lock.yaml exists', () => {
    const tmpDir = join(tmpdir(), `pnpm-detect-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    const result = detectPackageManager(tmpDir);
    strictEqual(result.manager, 'pnpm');
  });
});

describe('Integration Tests - Full Analysis Pipeline', () => {
  test('analyzes simple npm project correctly', () => {
    const tmpDir = join(tmpdir(), `analyze-npm-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const packageJson = {
      name: 'test-project',
      dependencies: {
        react: '18.2.0',
        'react-native': '0.72.0',
      },
    };

    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    writeFileSync(
      join(tmpDir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/react': { version: '18.2.0' },
          'node_modules/react-native': { version: '0.72.0' },
        },
      })
    );

    const pkg = readPackageJson(tmpDir);
    strictEqual(pkg.name, 'test-project');
    strictEqual(pkg.dependencies.react, '18.2.0');

    const manager = detectPackageManager(tmpDir);
    strictEqual(manager.manager, 'npm');

    const rn = detectReactNativeVersions(tmpDir);
    strictEqual(rn.version, '0.72.0');
    strictEqual(rn.react, '18.2.0');
  });

  test('detects breaking changes in project dependencies', () => {
    const tmpDir = join(tmpdir(), `breaking-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const packageJson = {
      name: 'test-breaking',
      dependencies: {
        'react-native': '0.72.0',
        redux: '5.0.0',
      },
    };

    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    writeFileSync(
      join(tmpDir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {},
      })
    );

    const pkg = readPackageJson(tmpDir);
    const deps = [
      {
        name: 'react-native',
        type: 'dependency' as const,
        requestedVersion: '0.72.0',
        resolvedVersion: '0.72.0',
      },
      {
        name: 'redux',
        type: 'dependency' as const,
        requestedVersion: '5.0.0',
        resolvedVersion: '5.0.0',
      },
    ];

    const breakingResults = analyzeBreakingChanges(deps);
    const detected = breakingResults.filter(r => r.detected);

    ok(detected.length > 0, 'Should detect breaking changes');
    ok(detected.some(d => d.issue?.package === 'react-native'), 'Should detect RN breaking change');
    ok(detected.some(d => d.issue?.package === 'redux'), 'Should detect Redux breaking change');
  });

  test('compatibility analysis works correctly', () => {
    const deps = [
      {
        name: 'react',
        type: 'dependency' as const,
        requestedVersion: '18.2.0',
        resolvedVersion: '18.2.0',
      },
      {
        name: 'react-native-reanimated',
        type: 'dependency' as const,
        requestedVersion: '4.1.7',
        resolvedVersion: '4.1.7',
      },
    ];

    const results = analyzeAllDependencies(deps, '0.72.0', '18.2.0');
    ok(results.length > 0, 'Should return compatibility results');

    const reanimated = results.find(r => r.package === 'react-native-reanimated');
    ok(reanimated, 'Should include reanimated in results');
    strictEqual(reanimated?.status, 'error', 'Should mark incompatible version as error');
  });
});

describe('Integration Tests - React Native Compatibility', () => {
  test('detects React/RN version mismatch', () => {
    const tmpDir = join(tmpdir(), `compat-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: {
        'react-native': '0.72.0',
        react: '19.0.0',
      },
    }));

    const pkg = readPackageJson(tmpDir);
    const rn = detectReactNativeVersions(tmpDir);

    strictEqual(rn.version, '0.72.0');
    strictEqual(rn.react, '19.0.0');
  });
});
