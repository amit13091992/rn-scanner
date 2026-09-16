import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/utils/config.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'config-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('loadConfig - returns empty config when .rn-dep-scanner.json does not exist', () => {
  const dir = makeTempDir();
  try {
    assert.deepEqual(loadConfig(dir), {});
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - reads ignorePackages and ignoreVulnerabilities', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.rn-dep-scanner.json'),
      JSON.stringify({ ignorePackages: ['noisy-pkg'], ignoreVulnerabilities: ['GHSA-aaaa-bbbb-cccc'] })
    );
    const config = loadConfig(dir);
    assert.deepEqual(config.ignorePackages, ['noisy-pkg']);
    assert.deepEqual(config.ignoreVulnerabilities, ['GHSA-aaaa-bbbb-cccc']);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - malformed JSON degrades to empty config instead of throwing', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), '{ not valid json');
    assert.deepEqual(loadConfig(dir), {});
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - ignores fields with the wrong type instead of throwing', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.rn-dep-scanner.json'),
      JSON.stringify({ ignorePackages: 'not-an-array', ignoreVulnerabilities: [1, 2, 3] })
    );
    assert.deepEqual(loadConfig(dir), {});
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - a top-level non-object JSON value degrades to empty config', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), '"just a string"');
    assert.deepEqual(loadConfig(dir), {});
  } finally {
    cleanup(dir);
  }
});
