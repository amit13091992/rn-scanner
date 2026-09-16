import { test, describe } from 'node:test';
import { strictEqual } from 'node:assert';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseBunLock } from '../src/parsers/bunLockParser.js';

describe('Bun Lock Parser', () => {
  test('parses bun.lock packages section', () => {
    const tmpDir = join(tmpdir(), `bun-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      packages: {
        react: ['react@18.2.0', '', {}, 'sha512-abc'],
        'react-native': ['react-native@0.83.0', '', {}, 'sha512-def'],
      },
    });

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.manager, 'bun');
    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
    strictEqual(result.dependencies.get('react-native')?.resolvedVersion, '0.83.0');
  });

  test('handles scoped packages correctly', () => {
    const tmpDir = join(tmpdir(), `bun-scoped-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      packages: {
        '@react-navigation/native': ['@react-navigation/native@7.1.5', '', {}, 'sha512-abc'],
        '@react-native-async-storage/async-storage': [
          '@react-native-async-storage/async-storage@1.24.0',
          '',
          {},
          'sha512-def',
        ],
      },
    });

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.get('@react-navigation/native')?.resolvedVersion, '7.1.5');
    strictEqual(
      result.dependencies.get('@react-native-async-storage/async-storage')?.resolvedVersion,
      '1.24.0'
    );
  });

  test('tolerates a trailing comma in bun.lock (JSONC-lite format)', () => {
    const tmpDir = join(tmpdir(), `bun-trailing-comma-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = `{
      "lockfileVersion": 0,
      "packages": {
        "react": ["react@18.2.0", "", {}, "sha512-abc"],
      },
    }`;

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.dependencies.size, 1);
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
  });

  test('returns empty map for missing bun.lock', () => {
    const tmpDir = join(tmpdir(), `bun-missing-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const result = parseBunLock(tmpDir);
    strictEqual(result.manager, 'bun');
    strictEqual(result.dependencies.size, 0);
  });

  test('returns empty map instead of throwing for a legacy binary bun.lockb-style unparsable file', () => {
    const tmpDir = join(tmpdir(), `bun-legacy-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Simulate content that isn't valid JSON (e.g. a stray binary lockfile misnamed bun.lock).
    writeFileSync(join(tmpDir, 'bun.lock'), Buffer.from([0x00, 0x01, 0x02, 0xff]));

    const result = parseBunLock(tmpDir);
    strictEqual(result.manager, 'bun');
    strictEqual(result.dependencies.size, 0);
  });

  test('parses correctly in a workspace-style monorepo layout, ignoring the workspaces map', () => {
    const tmpDir = join(tmpdir(), `bun-workspace-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        '': { name: 'root', dependencies: { react: '^18.2.0' } },
        'packages/mobile': { name: 'mobile', dependencies: { 'react-native': '^0.83.0' } },
      },
      packages: {
        react: ['react@18.2.0', '', {}, 'sha512-abc'],
        'react-native': ['react-native@0.83.0', '', {}, 'sha512-def'],
      },
    });

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.dependencies.size, 2);
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
    strictEqual(result.dependencies.get('react-native')?.resolvedVersion, '0.83.0');
  });

  test('excludes internal workspace:-linked sibling packages as phantom dependencies', () => {
    const tmpDir = join(tmpdir(), `bun-workspace-link-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        '': { name: 'root' },
        'packages/mobile': { name: 'mobile' },
      },
      packages: {
        mobile: ['mobile@workspace:packages/mobile'],
        react: ['react@18.2.0', '', {}, 'sha512-abc'],
      },
    });

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.dependencies.size, 1);
    strictEqual(result.dependencies.has('mobile'), false);
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
  });

  test('skips malformed package entries without throwing', () => {
    const tmpDir = join(tmpdir(), `bun-malformed-entry-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const bunLockContent = JSON.stringify({
      lockfileVersion: 0,
      packages: {
        react: ['react@18.2.0', '', {}, 'sha512-abc'],
        broken: [],
        alsoBroken: [12345],
      },
    });

    writeFileSync(join(tmpDir, 'bun.lock'), bunLockContent);
    const result = parseBunLock(tmpDir);

    strictEqual(result.dependencies.size, 1);
    strictEqual(result.dependencies.get('react')?.resolvedVersion, '18.2.0');
  });
});
