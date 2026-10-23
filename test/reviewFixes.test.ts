import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NPMLockParser } from '../src/parsers/npmLockParser.js';
import { versionInRange } from '../src/utils/versionComparison.js';
import { computeHealthScore } from '../src/utils/healthScore.js';
import { highestFixedVersion, meetsFailThreshold, parseFailOn } from '../src/utils/securityFormat.js';
import { analyzeUnusedDependencies } from '../src/analyzers/unusedDependencies.js';
import { assessUpgradeReadiness } from '../src/analyzers/upgradeReadiness.js';
import { policyCommand } from '../src/commands/policy.js';
import { isOffline, fetchWithTimeout } from '../src/utils/network.js';
import type { PackageVulnerabilityResult } from '../src/types/vulnerability.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'review-fix-'));
}

test('npm lock: resolvedVersion is the version number, never the tarball URL', () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'app' },
      'node_modules/react-native-appwrite': {
        version: '0.10.0',
        resolved: 'https://registry.npmjs.org/react-native-appwrite/-/react-native-appwrite-0.10.0.tgz',
      },
      'node_modules/foo': { version: '2.0.0' },
      'node_modules/bar/node_modules/foo': { version: '1.0.0' },
    },
  };
  const parsed = new NPMLockParser().parse(JSON.stringify(lock));
  assert.equal(parsed.dependencies.get('react-native-appwrite')?.resolvedVersion, '0.10.0');
  assert.equal(parsed.dependencies.get('foo')?.resolvedVersion, '2.0.0');
});

test('a prerelease version satisfies the identical prerelease range', () => {
  assert.equal(versionInRange('8.0.0-3', '8.0.0-3'), true);
  assert.equal(versionInRange('8.0.0', '8.0.0-3'), false);
  assert.equal(versionInRange('1.2.3', '^1.0.0'), true);
});

test('health score reports insufficient data when few dependencies have rules', () => {
  const sparse = computeHealthScore({ compatible: 4, warnings: 0, errors: 0, notChecked: 37, total: 41 });
  assert.equal(sparse.insufficientData, true);
  const dense = computeHealthScore({ compatible: 30, warnings: 2, errors: 0, notChecked: 9, total: 41 });
  assert.equal(dense.insufficientData, false);
});

test('security helpers: highest fixed version and --fail-on thresholds', () => {
  const pkg: PackageVulnerabilityResult = {
    package: 'tar', version: '7.4.3', direct: false, paths: [['expo', 'tar']],
    vulnerabilities: [
      { id: 'A', summary: '', severity: 'high', fixedVersion: '7.5.7', references: [] },
      { id: 'B', summary: '', severity: 'critical', fixedVersion: '7.5.21', references: [] },
      { id: 'C', summary: '', severity: 'low', fixedVersion: '7.5.3', references: [] },
    ],
  };
  assert.equal(highestFixedVersion(pkg), '7.5.21');
  const summary = { critical: 0, high: 2, moderate: 1, low: 0, unknown: 0 };
  assert.equal(meetsFailThreshold(summary, 'high'), true);
  assert.equal(meetsFailThreshold(summary, 'critical'), false);
  assert.equal(meetsFailThreshold(summary, 'none'), false);
  assert.equal(parseFailOn(undefined), 'high');
  assert.throws(() => parseFailOn('bogus'));
});

test('unused: main entry, Expo plugins, scripts and peers count as used', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'app', main: 'expo-router/entry', scripts: { start: 'expo start' },
      dependencies: { expo: '~53.0.0', 'expo-router': '~5.0.0', 'expo-splash-screen': '~0.30.0', 'react-dom': '19.0.0', 'left-over': '1.0.0' },
    }));
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { plugins: ['expo-router', ['expo-splash-screen', {}]] } }));
    mkdirSync(join(dir, 'node_modules', 'expo-router'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'expo-router', 'package.json'), JSON.stringify({ name: 'expo-router', version: '5.0.0', peerDependencies: { 'react-dom': '*' } }));
    const deps = ['expo', 'expo-router', 'expo-splash-screen', 'react-dom', 'left-over'].map((name) => ({
      name, requestedVersion: '1.0.0', resolvedVersion: '1.0.0', type: 'dependency' as const,
    }));
    const result = analyzeUnusedDependencies(dir, deps as never);
    assert.deepEqual(result.unused.map((u) => u.name), ['left-over']);
    assert.ok(result.implicitlyUsed.some((u) => u.name === 'expo-splash-screen'));
    assert.ok(result.implicitlyUsed.some((u) => u.name === 'react-dom'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade: a nine-minor jump is never LOW risk, and a missing android/ dir is "not verified"', () => {
  const dir = tmp();
  try {
    const deps = [{ name: 'react-native', requestedVersion: '0.79.4', resolvedVersion: '0.79.4', type: 'dependency' as const }];
    const result = assessUpgradeReadiness(deps as never, dir, '0.88.0', '0.79.4');
    assert.equal(result.minorsSpanned, 9);
    assert.equal(result.risk, 'high');
    assert.ok(result.riskReasons.some((r) => r.includes('9 React Native minor')));
    assert.equal(result.environmentVerified.android, false);
    const adjacent = assessUpgradeReadiness(deps as never, dir, '0.80.0', '0.79.4');
    assert.notEqual(adjacent.minorsSpanned, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('policy --init writes a starter config once and never overwrites', async () => {
  const dir = tmp();
  const log = console.log;
  console.log = () => {};
  try {
    await policyCommand({ cwd: dir, init: true });
    const target = join(dir, '.rn-preflight.json');
    assert.ok(existsSync(target));
    const first = readFileSync(target, 'utf-8');
    writeFileSync(target, '{"bannedPackages":["x"]}');
    await policyCommand({ cwd: dir, init: true });
    assert.equal(readFileSync(target, 'utf-8'), '{"bannedPackages":["x"]}');
    assert.ok(JSON.parse(first).maxVulnerabilitySeverity);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('offline mode makes no network call and resolves null', async () => {
  process.env.RN_PREFLIGHT_OFFLINE = '1';
  try {
    assert.equal(isOffline(), true);
    assert.equal(await fetchWithTimeout('http://127.0.0.1:1/never'), null);
  } finally {
    delete process.env.RN_PREFLIGHT_OFFLINE;
  }
});

test('unused: an optional peer of another package does not count as implicit use', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { expo: '1.0.0', 'react-native-webview': '1.0.0' } }));
    mkdirSync(join(dir, 'node_modules', 'expo'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'expo', 'package.json'), JSON.stringify({
      name: 'expo', version: '1.0.0',
      peerDependencies: { 'react-native-webview': '*' },
      peerDependenciesMeta: { 'react-native-webview': { optional: true } },
    }));
    const deps = ['expo', 'react-native-webview'].map((name) => ({ name, requestedVersion: '1.0.0', resolvedVersion: '1.0.0', type: 'dependency' as const }));
    const result = analyzeUnusedDependencies(dir, deps as never);
    assert.ok(result.unused.some((u) => u.name === 'react-native-webview'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade: verdict scope is javascript-only without native folders', () => {
  const dir = tmp();
  try {
    const deps = [{ name: 'react-native', requestedVersion: '0.79.4', resolvedVersion: '0.79.4', type: 'dependency' as const }];
    const r = assessUpgradeReadiness(deps as never, dir, '0.80.0', '0.79.4');
    assert.equal(r.environmentVerified.android && r.environmentVerified.ios, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('security sort is deterministic for equal severity and advisory counts', async () => {
  const { printGroupedVulnerabilities } = await import('../src/utils/securityFormat.js');
  const mk = (name: string): PackageVulnerabilityResult => ({
    package: name, version: '1.0.0', direct: false, paths: [[name]],
    vulnerabilities: [{ id: name, summary: '', severity: 'high', references: [] }],
  });
  const capture = (items: PackageVulnerabilityResult[]) => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (m?: unknown) => { lines.push(String(m)); };
    try { printGroupedVulnerabilities(items, { appName: 'app', summaryOnly: true }); } finally { console.log = log; }
    return lines.join('\n');
  };
  assert.equal(capture([mk('b'), mk('a')]), capture([mk('a'), mk('b')]));
});

import { detectBreakingChanges as detectBc58 } from '../src/analyzers/breakingChanges.js';
test('expo SDK 58 breaking changes are reported for expo >=58 only', () => {
  const dep = (v: string) => ({ name: 'expo', requestedVersion: v, resolvedVersion: v }) as never;
  const r58 = detectBc58(dep('58.0.0'));
  assert.ok(r58.issue?.changes.some((c) => c.includes('expo-sqlite')));
  assert.ok(!detectBc58(dep('57.0.0')).issue?.changes.some((c) => c.includes('expo-sqlite')));
});
