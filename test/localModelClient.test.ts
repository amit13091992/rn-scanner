import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  isModelDownloaded,
  getModelPath,
  isRuntimeAvailable,
  ensureModelDownloaded,
  runLocalChatWithTools,
  MODELS_DIR,
  __setModuleLoaderForTests,
  __resetModuleLoaderForTests,
} from '../src/services/localModelClient.js';

const TEST_MODEL = 'hf:Org/Repo/tiny-test-model.gguf';

test('isModelDownloaded / getModelPath - false until the expected cache file exists', () => {
  const path = getModelPath(TEST_MODEL);
  assert.equal(path, join(MODELS_DIR, 'tiny-test-model.gguf'));
  assert.equal(isModelDownloaded(TEST_MODEL), false);
});

test('isModelDownloaded - true once the expected cache file is present', () => {
  const path = getModelPath(TEST_MODEL);
  mkdirSync(MODELS_DIR, { recursive: true });
  writeFileSync(path, 'fake-gguf-bytes');
  try {
    assert.equal(isModelDownloaded(TEST_MODEL), true);
  } finally {
    rmSync(path, { force: true });
  }
});

test('isRuntimeAvailable - true when getLlama() succeeds', async () => {
  __setModuleLoaderForTests(async () => ({ getLlama: async () => ({}) }) as never);
  try {
    assert.equal(await isRuntimeAvailable(), true);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('isRuntimeAvailable - false (never throws) when getLlama() rejects', async () => {
  __setModuleLoaderForTests(async () => ({
    getLlama: async () => {
      throw new Error('unsupported platform');
    },
  }) as never);
  try {
    assert.equal(await isRuntimeAvailable(), false);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('ensureModelDownloaded - degrades to an error instead of throwing on failure', async () => {
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => {
      throw new Error('network unreachable');
    },
  }) as never);
  try {
    const result = await ensureModelDownloaded(TEST_MODEL);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /network unreachable/);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - returns the final content when the model calls no tools', async () => {
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
        dispose: async () => {},
      }),
    }),
    LlamaChatSession: class {
      async prompt() {
        return 'final answer text';
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', []);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.content, 'final answer text');
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - invokes a tool handler via the translated function definition', async () => {
  let calledWith: unknown;
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
        dispose: async () => {},
      }),
    }),
    LlamaChatSession: class {
      async prompt(_userPrompt: string, options: { functions: Record<string, { handler: (args: unknown) => unknown }> }) {
        calledWith = await options.functions.testTool.handler({ packageName: 'x' });
        return 'done';
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', [
      {
        definition: {
          type: 'function',
          function: { name: 'testTool', description: 'test', parameters: { type: 'object', properties: {} } },
        },
        handler: async (args) => ({ echoed: args }),
      },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(calledWith, { echoed: { packageName: 'x' } });
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - degrades to an error instead of throwing on model-load failure', async () => {
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => {
      throw new Error('native backend failed to load');
    },
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', []);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /native backend failed to load/);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - a handler that throws (step cap exceeded) surfaces as an error, not a crash', async () => {
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
        dispose: async () => {},
      }),
    }),
    LlamaChatSession: class {
      async prompt(_userPrompt: string, options: { functions: Record<string, { handler: (args: unknown) => unknown }> }) {
        await options.functions.testTool.handler({});
        return 'unreachable';
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', [
      {
        definition: {
          type: 'function',
          function: { name: 'testTool', description: 'test', parameters: { type: 'object', properties: {} } },
        },
        handler: async () => {
          throw new Error('exceeded the 5-step limit');
        },
      },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /exceeded the 5-step limit/);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - with a responseSchema, runs a second grammar-constrained prompt and returns its content', async () => {
  const calls: Array<{ hasFunctions: boolean; hasGrammar: boolean }> = [];
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => '/fake/path/model.gguf',
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
        dispose: async () => {},
      }),
      createGrammarForJsonSchema: async (schema: unknown) => ({ schema }),
    }),
    LlamaChatSession: class {
      async prompt(_userPrompt: string, options: { functions?: unknown; grammar?: unknown }) {
        calls.push({ hasFunctions: !!options.functions, hasGrammar: !!options.grammar });
        return options.grammar ? '{"verdict":"x","confidence":"low","reasoning":"y"}' : 'ignored first-pass prose';
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', [], {
      type: 'object',
      properties: { verdict: { type: 'string' }, confidence: { type: 'string' }, reasoning: { type: 'string' } },
      required: ['verdict', 'confidence', 'reasoning'],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.content, '{"verdict":"x","confidence":"low","reasoning":"y"}');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.hasFunctions, true);
    assert.equal(calls[1]?.hasGrammar, true);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('runLocalChatWithTools - without a responseSchema, only runs the single tool-enabled prompt', async () => {
  let callCount = 0;
  __setModuleLoaderForTests(async () => ({
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
        callCount++;
        return 'plain text answer';
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never);
  try {
    const result = await runLocalChatWithTools(TEST_MODEL, 'system', 'user', []);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.content, 'plain text answer');
    assert.equal(callCount, 1);
  } finally {
    __resetModuleLoaderForTests();
  }
});
