import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveDependencyRoot } from '../src/utils/projectRoot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(__dirname, '..', 'test-fixtures', 'monorepo');
const workspacePackage = join(monorepoRoot, 'packages', 'mobile-app');

test('resolveDependencyRoot - a single-package project resolves to itself', () => {
  const fixtureCwd = join(__dirname, '..', 'test-fixtures', 'dependency-completeness');
  assert.equal(resolveDependencyRoot(fixtureCwd), fixtureCwd);
});

test('resolveDependencyRoot - a workspace package with no lockfile of its own resolves to the monorepo root', () => {
  assert.equal(resolveDependencyRoot(workspacePackage), monorepoRoot);
});

test('resolveDependencyRoot - the monorepo root itself resolves to itself', () => {
  assert.equal(resolveDependencyRoot(monorepoRoot), monorepoRoot);
});

test('resolveDependencyRoot - a directory with no lockfile of its own walks up to the nearest ancestor that has one', () => {
  // test-fixtures/elf has no lockfile itself, but this repo checkout does at its root —
  // walking up to find it is the correct behavior, not just a fallback to cwd.
  const repoRoot = join(__dirname, '..');
  const nowhereDir = join(repoRoot, 'test-fixtures', 'elf');
  assert.equal(resolveDependencyRoot(nowhereDir), repoRoot);
});

test('resolveDependencyRoot - a workspace package with its own node_modules (pnpm/bun isolated install) still resolves to the monorepo root when declared as a workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'isolated-nm-test-'));
  try {
    const pkgDir = join(root, 'packages', 'mobile-app');
    mkdirSync(join(pkgDir, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root-app', private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n');
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'mobile-app', version: '1.0.0' }));

    assert.equal(resolveDependencyRoot(pkgDir), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDependencyRoot - a directory with its own node_modules that is NOT a declared workspace of an ancestor lockfile resolves to itself', () => {
  const root = mkdtempSync(join(tmpdir(), 'unrelated-nm-test-'));
  try {
    const nestedDir = join(root, 'some-unrelated-dir');
    mkdirSync(join(nestedDir, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root-app' }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));

    assert.equal(resolveDependencyRoot(nestedDir), nestedDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
