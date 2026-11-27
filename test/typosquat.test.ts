import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { editDistance, findLookalikes } from '../src/analyzers/typosquat.js';
import { POPULAR_PACKAGES } from '../src/data/popularPackages.js';
import { analyzePackageSafety, type PackageSafetyDeps } from '../src/analyzers/packageSafety.js';

test('editDistance - counts an adjacent swap as one edit', () => {
  assert.equal(editDistance('react-native', 'raect-native'), 1);
  assert.equal(editDistance('lodash', 'lodahs'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('findLookalikes - flags typos and separator variants of well-known packages', () => {
  assert.deepEqual(findLookalikes('react-natve'), [{ resembles: 'react-native', reason: 'near_miss' }]);
  assert.deepEqual(findLookalikes('reactnative'), [{ resembles: 'react-native', reason: 'separator_variant' }]);
  assert.deepEqual(findLookalikes('react_native_reanimated'), [{ resembles: 'react-native-reanimated', reason: 'separator_variant' }]);
  assert.equal(findLookalikes('react-native-reanimatd')[0]?.resembles, 'react-native-reanimated');
  assert.equal(findLookalikes('@react-navigation/nativ')[0]?.resembles, '@react-navigation/native');
});

test('findLookalikes - the real package, unrelated names and short names are not flagged', () => {
  assert.deepEqual(findLookalikes('react-native'), []);
  assert.deepEqual(findLookalikes('React-Native'), []);
  assert.deepEqual(findLookalikes('my-company-internal-lib'), []);
  assert.deepEqual(findLookalikes('react-native-svg-transformer'), []);
  // 'zod' (3 chars) and 'jest' (4) are below the edit-distance floor: 'zid' is not flagged.
  assert.deepEqual(findLookalikes('zid'), []);
});

test('popular package list - no duplicates, all lowercase and valid-looking npm names', () => {
  assert.equal(new Set(POPULAR_PACKAGES).size, POPULAR_PACKAGES.length);
  for (const name of POPULAR_PACKAGES) {
    assert.match(name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, name);
  }
});

const NOW = new Date('2026-11-27T00:00:00Z');
function deps(overrides: Partial<PackageSafetyDeps> = {}): PackageSafetyDeps {
  return {
    lookupPackument: async () => ({
      status: 'found',
      packument: { 'dist-tags': { latest: '1.0.0' }, time: { created: '2019-01-01T00:00:00Z', '1.0.0': '2025-01-01T00:00:00Z' }, versions: { '1.0.0': {} } },
    }),
    fetchWeeklyDownloads: async () => 40,
    queryVulnerabilities: async () => ({ scanned: true, results: [] }),
    now: () => NOW,
    ...overrides,
  };
}

test('analyzePackageSafety - a registered lookalike with little traffic needs review', async () => {
  const r = await analyzePackageSafety('react-natve', undefined, deps());
  assert.equal(r.verdict, 'review');
  assert.ok(r.signals.some((s) => s.code === 'lookalike_name' && /react-native/.test(s.message)));
  assert.equal(r.details.lookalikes[0]?.resembles, 'react-native');
});

test('analyzePackageSafety - a lookalike name with established traffic is not accused', async () => {
  const r = await analyzePackageSafety('react-natve', undefined, deps({ fetchWeeklyDownloads: async () => 2_000_000 }));
  assert.equal(r.signals.some((s) => s.code === 'lookalike_name'), false);
  assert.equal(r.verdict, 'ok');
});

test('analyzePackageSafety - a missing name that resembles a real package suggests it', async () => {
  const r = await analyzePackageSafety('react-natve', undefined, deps({ lookupPackument: async () => ({ status: 'not_found' }) }));
  assert.equal(r.verdict, 'avoid');
  assert.ok(r.signals.some((s) => s.code === 'did_you_mean' && /react-native/.test(s.message)));
});

test('analyzePackageSafety - with the registry unreachable a lookalike still warns (cannot rule it out)', async () => {
  const r = await analyzePackageSafety('react-natve', undefined, deps({ lookupPackument: async () => ({ status: 'unavailable' }) }));
  assert.equal(r.verdict, 'review');
  assert.equal(r.notChecked.length, 1);
});
