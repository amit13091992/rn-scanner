import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
