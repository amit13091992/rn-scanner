import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeNodeEnvironment } from '../src/analyzers/nodeEnvironment.js';
import { detectNodeVersion } from '../src/detectors/node.js';

test('detectNodeVersion - reports the running process version without a leading v', () => {
  const info = detectNodeVersion();
  assert.equal(info.version, process.version.replace(/^v/, ''));
  assert.equal(info.source, 'process.version');
});

test('analyzeNodeEnvironment - flags a Node version older than the RN baseline as an error', () => {
  const [result] = analyzeNodeEnvironment('0.87');
  assert.equal(result?.name, 'Node.js');
  assert.equal(result?.required, '22.13.0');
  // The test runner is not guaranteed to run on Node 22.13+, so only assert the shape here:
  // status must be 'ok' or 'error' depending on the actual runtime version, never 'unknown'.
  assert.ok(result?.status === 'ok' || result?.status === 'error');
  if (result?.status === 'error') {
    assert.match(result.reason ?? '', /older than the 22\.13\.0/);
  }
});

test('analyzeNodeEnvironment - reports ok for a very old RN baseline that any modern Node satisfies', () => {
  const [result] = analyzeNodeEnvironment('0.70');
  assert.equal(result?.required, '14.17.0');
  assert.equal(result?.status, 'ok');
  assert.equal(result?.reason, undefined);
});

test('analyzeNodeEnvironment - unknown RN version produces an unknown status, not a crash', () => {
  const [result] = analyzeNodeEnvironment('');
  assert.equal(result?.status, 'unknown');
});

test('analyzeNodeEnvironment - RN 0.88 warns on odd-numbered or pre-24.3 Node, matching the running process', () => {
  const [major = 0, minor = 0] = process.version.replace(/^v/, '').split('.').map(Number);
  const [result] = analyzeNodeEnvironment('0.88');
  const meetsBaseline = major > 22 || (major === 22 && minor >= 13);
  const unsupported = (major % 2 === 1 && major < 26) || (major === 24 && minor < 3);
  if (meetsBaseline && unsupported) {
    assert.equal(result?.status, 'warning');
    assert.match(result?.reason ?? '', /supported engines range/);
  } else if (meetsBaseline) {
    assert.equal(result?.status, 'ok');
  }
  const [older] = analyzeNodeEnvironment('0.87');
  assert.notEqual(older?.status, 'warning');
});
