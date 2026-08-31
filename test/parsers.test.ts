import { test, describe } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseYarnLock } from '../src/parsers/yarnLockParser.js';
import { parsePnpmLock } from '../src/parsers/pnpmLockParser.js';
import { NPMLockParser } from '../src/parsers/npmLockParser.js';

describe('Yarn Lock Parser', () => {
  test('parses simple yarn.lock v2 format', () => {
    const tmpDir = join(tmpdir(), `yarn-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const yarnLockContent = `"@react-navigation/native@^7.0.0":
  version "7.1.5"
  resolved "https://registry.yarnpkg.com/@react-navigation/native/-/native-7.1.5.tgz#abc123"

"react@18.2.0":
  version "18.2.0"
  resolved "https://registry.yarnpkg.com/react/-/react-18.2.0.tgz#def456"
`;

    writeFileSync(join(tmpDir, 'yarn.lock'), yarnLockContent);
    const result = parseYarnLock(tmpDir);

    strictEqual(result.manager, 'yarn');
    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.get('@react-navigation/native')?.resolvedVersion, '7.1.5');
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
  });

  test('handles scoped packages correctly', () => {
    const tmpDir = join(tmpdir(), `yarn-scoped-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const yarnLockContent = `"@babel/core@^7.20.0":
  version "7.21.0"

"@react-native/normalize-color@*":
  version "2.1.0"
`;

    writeFileSync(join(tmpDir, 'yarn.lock'), yarnLockContent);
    const result = parseYarnLock(tmpDir);

    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.has('@babel/core'), true);
    strictEqual(result.dependencies.has('@react-native/normalize-color'), true);
  });

  test('returns empty map for missing file', () => {
    const tmpDir = join(tmpdir(), `yarn-missing-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const result = parseYarnLock(tmpDir);
    strictEqual(result.manager, 'yarn');
    strictEqual(result.dependencies.size, 0);
  });
});

describe('PNPM Lock Parser', () => {
  test('parses pnpm-lock.yaml dependencies section', () => {
    const tmpDir = join(tmpdir(), `pnpm-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const pnpmLockContent = `lockfileVersion: 5.4

dependencies:
  '@react-navigation/native': 7.1.5
  react: 18.2.0
  react-native: 0.72.0

packages:
  /@react-navigation/native@7.1.5:
    version: 7.1.5
`;

    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), pnpmLockContent);
    const result = parsePnpmLock(tmpDir);

    strictEqual(result.manager, 'pnpm');
    strictEqual(result.dependencies.size, 3);
    strictEqual(result.dependencies.get('@react-navigation/native')?.resolvedVersion, '7.1.5');
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
  });

  test('handles scoped packages in pnpm', () => {
    const tmpDir = join(tmpdir(), `pnpm-scoped-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const pnpmLockContent = `lockfileVersion: 5.4

dependencies:
  '@babel/core': 7.21.0
  '@react-native/normalize-color': 2.1.0
`;

    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), pnpmLockContent);
    const result = parsePnpmLock(tmpDir);

    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.has('@babel/core'), true);
  });

  test('returns empty map for missing pnpm-lock.yaml', () => {
    const tmpDir = join(tmpdir(), `pnpm-missing-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const result = parsePnpmLock(tmpDir);
    strictEqual(result.manager, 'pnpm');
    strictEqual(result.dependencies.size, 0);
  });
});

describe('NPM Lock Parser', () => {
  test('parses npm package-lock.json', () => {
    const tmpDir = join(tmpdir(), `npm-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const npmLockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/react': {
          version: '18.2.0',
        },
        'node_modules/react-native': {
          version: '0.72.0',
        },
      },
    });

    writeFileSync(join(tmpDir, 'package-lock.json'), npmLockContent);
    const parser = new NPMLockParser();
    const result = parser.parse(npmLockContent);

    strictEqual(result.manager, 'npm');
    strictEqual(result.dependencies.size > 0, true);
  });
});
