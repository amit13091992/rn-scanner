import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assessUpgradeReadiness } from '../src/analyzers/upgradeReadiness.js';
import { analyzeRecommendedUpdates } from '../src/analyzers/recommendedUpdates.js';
import { analyzeImpact } from '../src/analyzers/impact.js';
import { isExpoManagedPackage } from '../src/data/expo/managedPackages.js';
import type { DependencyInfo } from '../src/types/dependency.js';

const dep = (name: string, v: string): DependencyInfo => ({ name, requestedVersion: v, resolvedVersion: v, type: 'dependency' });

test('upgrade: moving React Native past what the installed Expo SDK pins raises risk to high and names the SDK to move to', () => {
  const deps = [dep('expo', '57.0.30'), dep('react-native', '0.86.3')];
  const result = assessUpgradeReadiness(deps, '/nonexistent-project', '0.88.0', '0.86.3');
  assert.equal(result.risk, 'high');
  assert.ok(result.riskReasons.some((r) => r.includes('Expo SDK 57 pins React Native 0.86') && r.includes('Expo SDK 58')));
  const sameMinor = assessUpgradeReadiness(deps, '/nonexistent-project', '0.86.5', '0.86.3');
  assert.ok(!sameMinor.riskReasons.some((r) => r.includes('Expo SDK')));
});

test('outdated --recommend never suggests a downgrade when the installed major is newer than the rule data', async () => {
  const [rec] = await analyzeRecommendedUpdates(
    [{ name: 'react-native-safe-area-context', current: '5.7.0', latest: '5.10.1', type: 'minor' }],
    '0.86.3'
  );
  assert.equal(rec!.recommended, '5.10.1');
  assert.match(rec!.reason, /no downgrade/);
});

test('impact: reports every applicable breaking-change note between installed and target, not just the newest', () => {
  const deps = [dep('react-native', '0.86.3')];
  const result = analyzeImpact('/nonexistent-project', deps, 'react-native', '0.88.0');
  const introduced = result.breakingChanges.map((c) => c.introducedInVersion);
  assert.ok(introduced.includes('0.88.0') && introduced.includes('0.87.0'));
});

test('isExpoManagedPackage: SDK-pinned packages are managed, arbitrary libraries are not', () => {
  for (const n of ['react-native', 'react', 'expo', 'expo-file-system', '@expo/vector-icons', 'react-native-reanimated']) assert.equal(isExpoManagedPackage(n), true, n);
  for (const n of ['zustand', '@tanstack/react-query', 'react-native-mmkv']) assert.equal(isExpoManagedPackage(n), false, n);
});
