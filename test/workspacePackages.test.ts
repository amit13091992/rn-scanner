import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorkspacePackages } from '../src/utils/workspacePackages.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'workspace-packages-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('findWorkspacePackages - expands a "packages/*" glob from package.json workspaces (npm/yarn/bun convention)', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: '@acme/a', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({ name: '@acme/b', version: '2.0.0' }));

    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 2);
    assert.deepEqual(result.get('@acme/a')?.dependencies, { lodash: '^4.0.0' });
    assert.equal(result.get('@acme/b')?.version, '2.0.0');
  } finally {
    cleanup(dir);
  }
});

test('findWorkspacePackages - workspaces as { packages: [...] } object form is supported', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: { packages: ['apps/*'] } }));
    mkdirSync(join(dir, 'apps', 'mobile'), { recursive: true });
    writeFileSync(join(dir, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: 'mobile', version: '0.1.0' }));

    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 1);
    assert.ok(result.has('mobile'));
  } finally {
    cleanup(dir);
  }
});

test('findWorkspacePackages - pnpm-workspace.yaml takes precedence over package.json workspaces', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['wrong/*'] }));
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - 'packages/*'\n`);
    mkdirSync(join(dir, 'packages', 'shared'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@acme/shared', version: '1.0.0' }));

    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 1);
    assert.ok(result.has('@acme/shared'));
  } finally {
    cleanup(dir);
  }
});

test('findWorkspacePackages - an exact (non-glob) path entry is also supported', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['tools/cli'] }));
    mkdirSync(join(dir, 'tools', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'cli', 'package.json'), JSON.stringify({ name: 'cli-tool', version: '1.0.0' }));

    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 1);
    assert.ok(result.has('cli-tool'));
  } finally {
    cleanup(dir);
  }
});

test('findWorkspacePackages - no workspaces field returns an empty map', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'single-package' }));
    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 0);
  } finally {
    cleanup(dir);
  }
});

test('findWorkspacePackages - a workspace directory with no package.json is skipped, not thrown', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    mkdirSync(join(dir, 'packages', 'empty-dir'), { recursive: true });

    const result = findWorkspacePackages(dir);
    assert.equal(result.size, 0);
  } finally {
    cleanup(dir);
  }
});
