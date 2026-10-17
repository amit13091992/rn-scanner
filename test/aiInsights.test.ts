import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeAiInsights } from '../src/analyzers/aiInsights.js';
import { __setModuleLoaderForTests, __resetModuleLoaderForTests } from '../src/services/localModelClient.js';
import { DEFAULT_AI_AGENT_CONFIG } from '../src/types/aiAgent.js';
import type { NewArchCheckResult } from '../src/types/newArchitecture.js';

const DATA_UNAVAILABLE: NewArchCheckResult[] = Array.from({ length: 8 }, (_, i) => ({
  package: `pkg-${i}`,
  version: '1.0.0',
  support: 'data_unavailable' as const,
  reason: 'no curated entry',
}));

function mockLlamaCppModule(promptResult: string) {
  return async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
        dispose: async () => {},
      }),
      createGrammarForJsonSchema: async () => ({}),
    }),
    LlamaChatSession: class {
      async prompt() {
        return promptResult;
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never;
}

test('analyzeAiInsights - unavailable runtime degrades to scanned: false with no findings', async () => {
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => {
      throw new Error('unsupported platform');
    },
  }) as never);
  try {
    const result = await analyzeAiInsights({ ...DEFAULT_AI_AGENT_CONFIG, enabled: true }, DATA_UNAVAILABLE);
    assert.equal(result.scanned, false);
    assert.ok(result.error);
    assert.deepEqual(result.findings, []);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('analyzeAiInsights - caps the number of findings triaged per run', async () => {
  __setModuleLoaderForTests(
    mockLlamaCppModule(JSON.stringify({ verdict: 'unknown', confidence: 'low', reasoning: 'no data' }))
  );
  try {
    const result = await analyzeAiInsights({ ...DEFAULT_AI_AGENT_CONFIG, enabled: true }, DATA_UNAVAILABLE);
    assert.equal(result.scanned, true);
    assert.equal(result.findings.length, 5);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('analyzeAiInsights - empty input returns scanned: true with no findings', async () => {
  __setModuleLoaderForTests(mockLlamaCppModule(JSON.stringify({ verdict: 'x', confidence: 'low', reasoning: 'y' })));
  try {
    const result = await analyzeAiInsights({ ...DEFAULT_AI_AGENT_CONFIG, enabled: true }, []);
    assert.equal(result.scanned, true);
    assert.deepEqual(result.findings, []);
  } finally {
    __resetModuleLoaderForTests();
  }
});
