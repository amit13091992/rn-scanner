import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeDependencyCompleteness } from '../src/analyzers/dependencyCompleteness.js';
import type { DependencyInfo } from '../src/types/dependency.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureCwd = join(__dirname, '..', 'test-fixtures', 'dependency-completeness');

function makeDep(name: string): DependencyInfo {
  return { name, requestedVersion: '^1.0.0', type: 'dependency' };
}

test('analyzeDependencyCompleteness - flags a fully missing dependency', () => {
  const { missing } = analyzeDependencyCompleteness(fixtureCwd, [makeDep('parent-pkg')]);

  const missingEntry = missing.find((m) => m.dependency === 'missing-dep');
  assert.ok(missingEntry);
  assert.equal(missingEntry!.installedVersion, null);
  assert.equal(missingEntry!.kind, 'dependency');
  assert.equal(missingEntry!.optional, false);
});

test('analyzeDependencyCompleteness - flags an installed but out-of-range dependency', () => {
  const { missing } = analyzeDependencyCompleteness(fixtureCwd, [makeDep('parent-pkg')]);

  const outdated = missing.find((m) => m.dependency === 'outdated-dep');
  assert.ok(outdated);
  assert.equal(outdated!.installedVersion, '1.0.0');
  assert.equal(outdated!.requiredRange, '^3.0.0');
});

test('analyzeDependencyCompleteness - does not flag a satisfied dependency', () => {
  const { missing } = analyzeDependencyCompleteness(fixtureCwd, [makeDep('parent-pkg')]);

  assert.equal(missing.some((m) => m.dependency === 'present-dep'), false);
});

test('analyzeDependencyCompleteness - marks an unsatisfied optional peer as optional, not a hard miss', () => {
  const { missing } = analyzeDependencyCompleteness(fixtureCwd, [makeDep('parent-pkg')]);

  const peer = missing.find((m) => m.dependency === 'optional-peer');
  assert.ok(peer);
  assert.equal(peer!.kind, 'peerDependency');
  assert.equal(peer!.optional, true);
});

test('analyzeDependencyCompleteness - reports notChecked for a parent with an unparseable manifest', () => {
  const { notChecked } = analyzeDependencyCompleteness(fixtureCwd, [makeDep('broken-pkg')]);

  assert.equal(notChecked.length, 1);
  assert.equal(notChecked[0]!.parent, 'broken-pkg');
});

test('analyzeDependencyCompleteness - skips a dependency that is not installed at all', () => {
  const result = analyzeDependencyCompleteness(fixtureCwd, [makeDep('never-installed-pkg')]);

  assert.equal(result.missing.length, 0);
  assert.equal(result.notChecked.length, 0);
});
