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

test('loadConfig - returns empty config and no warnings when .rn-dep-scanner.json does not exist', () => {
  const dir = makeTempDir();
  try {
    assert.deepEqual(loadConfig(dir), { config: {}, warnings: [] });
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - reads ignorePackages and ignoreVulnerabilities with no warnings', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.rn-dep-scanner.json'),
      JSON.stringify({ ignorePackages: ['noisy-pkg'], ignoreVulnerabilities: ['GHSA-aaaa-bbbb-cccc'] })
    );
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(config.ignorePackages, ['noisy-pkg']);
    assert.deepEqual(config.ignoreVulnerabilities, ['GHSA-aaaa-bbbb-cccc']);
    assert.deepEqual(warnings, []);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - malformed JSON degrades to empty config and reports why', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), '{ not valid json');
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /invalid JSON/);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - a field with the wrong type is dropped and reported, valid fields are kept', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.rn-dep-scanner.json'),
      JSON.stringify({ ignorePackages: 'not-an-array', ignoreVulnerabilities: ['GHSA-aaaa-bbbb-cccc'] })
    );
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.ignorePackages, undefined);
    assert.deepEqual(config.ignoreVulnerabilities, ['GHSA-aaaa-bbbb-cccc']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /"ignorePackages" must be an array of strings, got string/);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - an array containing a non-string element is dropped and reported', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ignoreVulnerabilities: [1, 2, 3] }));
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.ignoreVulnerabilities, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /"ignoreVulnerabilities"/);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - an unknown top-level key is reported, likely catching a typo', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), JSON.stringify({ ignorePackage: ['noisy-pkg'] }));
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unknown option "ignorePackage"/);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - a top-level non-object JSON value degrades to empty config and reports why', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), '"just a string"');
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /expected a JSON object/);
  } finally {
    cleanup(dir);
  }
});

test('loadConfig - a top-level array degrades to empty config and reports why', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '.rn-dep-scanner.json'), '[]');
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /expected a JSON object/);
  } finally {
    cleanup(dir);
  }
});
