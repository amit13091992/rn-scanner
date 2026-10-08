import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeRecommendedUpdates } from '../src/analyzers/recommendedUpdates.js';
import type { OutdatedPackage } from '../src/types/outdated.js';

test('analyzeRecommendedUpdates - a package with no compatibility data recommends the absolute latest', async () => {
  const outdated: OutdatedPackage[] = [{ name: 'left-pad', current: '1.0.0', latest: '1.3.0', type: 'minor' }];
  const [result] = await analyzeRecommendedUpdates(outdated, '0.75.0');
  assert.equal(result!.recommended, '1.3.0');
  assert.match(result!.reason, /No compatibility rules/);
});

test('analyzeRecommendedUpdates - react-native-reanimated latest requires a newer RN, recommends the older compatible major instead', async () => {
  const outdated: OutdatedPackage[] = [
    { name: 'react-native-reanimated', current: '2.0.0', latest: '4.1.0', type: 'major' },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    assert.ok(url.toString().includes('react-native-reanimated'));
    return {
      ok: true,
      json: async () => ({
        versions: {
          '2.0.0': {},
          '3.0.0': {},
          '3.5.0': {},
          '3.16.1': {},
          '4.0.0': {},
          '4.1.0': {},
        },
      }),
    } as Response;
  }) as typeof fetch;

  try {
    // RN 0.75 satisfies the 3.x rule (>=0.72 <0.80) but not the 4.x rule (>=0.78).
    const [result] = await analyzeRecommendedUpdates(outdated, '0.75.0');
    assert.equal(result!.recommended, '3.16.1');
    assert.match(result!.reason, /requires a newer React Native/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzeRecommendedUpdates - when the project RN version supports the latest major, recommended equals latest', async () => {
  const outdated: OutdatedPackage[] = [
    { name: 'react-native-reanimated', current: '3.0.0', latest: '4.1.0', type: 'major' },
  ];
  const [result] = await analyzeRecommendedUpdates(outdated, '0.80.0');
  assert.equal(result!.recommended, '4.1.0');
});

test('analyzeRecommendedUpdates - no React Native version detected falls back to latest with an explanatory reason', async () => {
  const outdated: OutdatedPackage[] = [
    { name: 'react-native-reanimated', current: '3.0.0', latest: '4.1.0', type: 'major' },
  ];
  const [result] = await analyzeRecommendedUpdates(outdated, null);
  assert.equal(result!.recommended, '4.1.0');
  assert.match(result!.reason, /not detected/);
});
