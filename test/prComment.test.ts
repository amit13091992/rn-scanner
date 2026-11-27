import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatVerdictComment, formatAggregatedVerdictComment, worstVerdict, PR_COMMENT_MARKER } from '../src/utils/prComment.js';
import type { EnvironmentRequirement } from '../src/types/environmentRequirement.js';

const okReq: EnvironmentRequirement = { name: 'JDK', current: '17', required: '17', status: 'ok' };
const warnReq: EnvironmentRequirement = {
  name: 'Kotlin',
  current: '1.8.0',
  required: '2.0.21',
  status: 'warning',
  reason: 'Kotlin 1.8.0 is older than the 2.0.21 React Native 0.87 expects.',
};
const errorReq: EnvironmentRequirement = {
  name: 'Node.js',
  current: '18.0.0',
  required: '22.13.0',
  status: 'error',
  reason: 'Node 18.0.0 is older than the 22.13.0 React Native 0.87 requires.',
};

test('formatVerdictComment - starts with the marker so re-runs can find and update it', () => {
  const body = formatVerdictComment({
    kind: 'doctor',
    reactNativeVersion: '0.87',
    verdict: 'READY',
    nodeEnvironment: [okReq],
    androidEnvironment: [],
    iosEnvironment: [],
  });
  assert.ok(body.startsWith(PR_COMMENT_MARKER));
});

test('formatVerdictComment - doctor heading includes the RN version', () => {
  const body = formatVerdictComment({
    kind: 'doctor',
    reactNativeVersion: '0.87',
    verdict: 'READY',
    nodeEnvironment: [okReq],
    androidEnvironment: [],
    iosEnvironment: [],
  });
  assert.match(body, /React Native Environment Preflight \(RN 0\.87\)/);
  assert.match(body, /READY/);
});

test('formatVerdictComment - upgrade heading includes from and to versions', () => {
  const body = formatVerdictComment({
    kind: 'upgrade',
    from: '0.79',
    to: '0.87',
    verdict: 'BLOCKED',
    nodeEnvironment: [errorReq],
    androidEnvironment: [],
    iosEnvironment: [],
  });
  assert.match(body, /Upgrade Readiness: 0\.79 → 0\.87/);
  assert.match(body, /BLOCKED/);
});

test('formatVerdictComment - a section with no issues reports all-clear, not the ok requirement', () => {
  const body = formatVerdictComment({
    kind: 'doctor',
    verdict: 'READY',
    nodeEnvironment: [okReq],
    androidEnvironment: [],
    iosEnvironment: [],
  });
  assert.match(body, /Node\.js.*all checks passed/);
  assert.doesNotMatch(body, /JDK/);
});

test('formatVerdictComment - warning and error requirements are both listed with their reasons', () => {
  const body = formatVerdictComment({
    kind: 'doctor',
    verdict: 'BLOCKED',
    nodeEnvironment: [errorReq],
    androidEnvironment: [warnReq],
    iosEnvironment: [],
  });
  assert.match(body, /Node\.js/);
  assert.match(body, /Node 18\.0\.0 is older than/);
  assert.match(body, /Kotlin 1\.8\.0 is older than/);
});

test('formatVerdictComment - empty sections are omitted, not printed as empty', () => {
  const body = formatVerdictComment({
    kind: 'doctor',
    verdict: 'READY',
    nodeEnvironment: [],
    androidEnvironment: [],
    iosEnvironment: [],
  });
  assert.match(body, /No environment requirements were checked\./);
});

test('formatAggregatedVerdictComment - rolls up the worst verdict across packages and keeps the same marker', () => {
  const body = formatAggregatedVerdictComment({
    kind: 'doctor',
    packages: [
      { package: '@acme/shared', verdict: 'READY', nodeEnvironment: [okReq], androidEnvironment: [], iosEnvironment: [] },
      { package: 'mobile-app', verdict: 'BLOCKED', reactNativeVersion: '0.87', nodeEnvironment: [errorReq], androidEnvironment: [], iosEnvironment: [] },
    ],
  });

  assert.ok(body.startsWith(PR_COMMENT_MARKER));
  assert.match(body, /Overall verdict:\*\* 🔴 BLOCKED \(worst of 2 workspace package\(s\)\)/);
  assert.match(body, /<summary>✅ READY <strong>@acme\/shared<\/strong><\/summary>/);
  assert.match(body, /<summary>🔴 BLOCKED <strong>mobile-app<\/strong> \(RN 0\.87\)<\/summary>/);
});

test('worstVerdict - BLOCKED beats WARN beats READY regardless of order', () => {
  assert.equal(worstVerdict(['READY', 'WARN']), 'WARN');
  assert.equal(worstVerdict(['BLOCKED', 'READY']), 'BLOCKED');
  assert.equal(worstVerdict(['WARN', 'BLOCKED', 'READY']), 'BLOCKED');
  assert.equal(worstVerdict(['READY', 'READY']), 'READY');
});

test('formatAggregatedVerdictComment - an upgrade heading includes the target version', () => {
  const body = formatAggregatedVerdictComment({
    kind: 'upgrade',
    to: '0.87',
    packages: [
      { package: 'mobile-app', verdict: 'WARN', nodeEnvironment: [warnReq], androidEnvironment: [], iosEnvironment: [] },
    ],
  });

  assert.match(body, /Upgrade Readiness \(all workspaces\) → 0\.87/);
});

import { formatSizeComment, SIZE_COMMENT_MARKER } from '../src/utils/prComment.js';
import { diffBundleSnapshots } from '../src/analyzers/bundleSizeDiff.js';
import { BUNDLE_SNAPSHOT_SCHEMA_VERSION, type BundleSnapshot } from '../src/types/bundleSize.js';

function sizeSnap(modules: { id: string; bytes: number }[], metro: string | null = '0.83.0'): BundleSnapshot {
  return {
    schemaVersion: BUNDLE_SNAPSHOT_SCHEMA_VERSION,
    platform: 'ios',
    commitSha: null,
    toolchain: { metroVersion: metro, hermesVersion: null },
    totals: { jsBytes: modules.reduce((n, m) => n + m.bytes, 0), hbcBytes: null, unmappedBytes: 0 },
    modules,
  };
}

test('formatSizeComment - over budget shows violation, table, and its own marker', () => {
  const diff = diffBundleSnapshots(sizeSnap([]), sizeSnap([{ id: 'node_modules/big/i.js', bytes: 500 * 1024 }]), { perModuleGrowthKb: 100 });
  const body = formatSizeComment(diff);
  assert.ok(body.includes(SIZE_COMMENT_MARKER));
  assert.ok(!body.includes(PR_COMMENT_MARKER));
  assert.match(body, /Over budget/);
  assert.match(body, /node_modules\/big\/i\.js/);
  assert.match(body, /\+500\.0 KiB/);
  assert.match(body, /not measured on both sides/);
});

test('formatSizeComment - not-comparable explains why instead of showing numbers', () => {
  const body = formatSizeComment(diffBundleSnapshots(sizeSnap([], '0.83.0'), sizeSnap([], '0.84.0')));
  assert.match(body, /Not comparable/);
  assert.match(body, /Metro version differs/);
  assert.ok(!body.includes('| JS bundle'));
});
