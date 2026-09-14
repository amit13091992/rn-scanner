import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatVerdictComment, PR_COMMENT_MARKER } from '../src/utils/prComment.js';
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
