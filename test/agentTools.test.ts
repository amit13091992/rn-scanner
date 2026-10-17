import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AGENT_TOOL_DEFINITIONS, runAgentTool } from '../src/agent/tools.js';

test('AGENT_TOOL_DEFINITIONS - every entry is a well-formed function tool definition', () => {
  assert.ok(AGENT_TOOL_DEFINITIONS.length > 0);
  for (const def of AGENT_TOOL_DEFINITIONS) {
    assert.equal(def.type, 'function');
    assert.ok(def.function.name.length > 0);
    assert.ok(def.function.description.length > 0);
    assert.equal(def.function.parameters.type, 'object');
  }
});

test('runAgentTool - getNewArchitectureStatus returns the curated entry for a known package', async () => {
  const result = await runAgentTool('getNewArchitectureStatus', { packageName: 'react-native-reanimated' });
  assert.deepEqual(result, { package: 'react-native-reanimated', support: 'supported', minVersion: '3.0.0' });
});

test('runAgentTool - getNewArchitectureStatus reports an error for an unknown package, not a crash', async () => {
  const result = await runAgentTool('getNewArchitectureStatus', { packageName: 'totally-unknown-package-xyz' });
  assert.ok((result as { error: string }).error);
});

test('runAgentTool - getCompatibilityRules returns curated rules for a known package', async () => {
  const result = await runAgentTool('getCompatibilityRules', { packageName: 'react-native-reanimated' });
  assert.ok(Array.isArray(result));
  assert.ok((result as unknown[]).length > 0);
});

test('runAgentTool - missing packageName degrades to an error instead of throwing', async () => {
  const result = await runAgentTool('getNewArchitectureStatus', {});
  assert.deepEqual(result, { error: 'packageName is required' });
});

test('runAgentTool - unknown tool name degrades to an error instead of throwing', async () => {
  const result = await runAgentTool('deleteEverything', { packageName: 'x' });
  assert.deepEqual(result, { error: 'unknown tool "deleteEverything"' });
});

test('runAgentTool - getLatestPublishedVersion degrades gracefully on network failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network unreachable');
  }) as unknown as typeof fetch;
  try {
    const result = await runAgentTool('getLatestPublishedVersion', { packageName: 'react' });
    assert.ok((result as { error: string }).error);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
