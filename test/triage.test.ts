import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { triageFinding } from '../src/agent/triage.js';
import { __setModuleLoaderForTests, __resetModuleLoaderForTests } from '../src/services/localModelClient.js';
import { DEFAULT_AI_AGENT_CONFIG } from '../src/types/aiAgent.js';

const FINDING = {
  kind: 'new-architecture-unknown' as const,
  packageName: 'some-unknown-native-module',
  context: 'no curated New Architecture entry; RN version is 0.76.0',
};

/**
 * A fake `node-llama-cpp` module mirroring the real two-pass flow in
 * `services/localModelClient.ts`: the first `session.prompt()` call is the tool-enabled pass
 * (`options.functions` is set — `toolPhase` can call tool handlers during it, same as a real
 * model deciding to use tools), the second is the grammar-constrained final pass
 * (`options.grammar` is set instead — this is where `finalContent` is "generated").
 */
function mockLlamaCppModule(
  toolPhase: (functions: Record<string, { handler: (args: unknown) => unknown }>) => Promise<void>,
  finalContent: string
) {
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
      async prompt(
        _userPrompt: string,
        options: { functions?: Record<string, { handler: (args: unknown) => unknown }>; grammar?: unknown }
      ) {
        if (options.functions) {
          await toolPhase(options.functions);
          return '';
        }
        return finalContent;
      }
    },
    defineChatSessionFunction: (spec: unknown) => spec,
  }) as never;
}

test('triageFinding - returns a verdict immediately when the model calls no tools', async () => {
  __setModuleLoaderForTests(
    mockLlamaCppModule(
      async () => {},
      JSON.stringify({ verdict: 'likely supported', confidence: 'low', reasoning: 'no data available' })
    )
  );
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('verdict' in result);
    if ('verdict' in result) {
      assert.equal(result.verdict.source, 'ai-inferred');
      assert.equal(result.verdict.packageName, 'some-unknown-native-module');
      assert.equal(result.verdict.confidence, 'low');
    }
    assert.equal(result.aiTrace.length, 1);
    assert.equal(result.aiTrace[0]?.type, 'final');
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('triageFinding - executes a tool call, records it in aiTrace, then returns a verdict', async () => {
  // getLatestPublishedVersion itself hits the real npm registry via fetch — stub it so this
  // stays offline/deterministic, same pattern as the rest of this suite.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ version: '19.0.0' }) })) as unknown as typeof fetch;
  __setModuleLoaderForTests(
    mockLlamaCppModule(
      async (functions) => {
        await functions.getLatestPublishedVersion?.handler({ packageName: 'react' });
      },
      JSON.stringify({ verdict: 'supported', confidence: 'medium', reasoning: 'checked latest version' })
    )
  );
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('verdict' in result);
    const toolCallSteps = result.aiTrace.filter((t) => t.type === 'tool_call');
    const toolResultSteps = result.aiTrace.filter((t) => t.type === 'tool_result');
    assert.equal(toolCallSteps.length, 1);
    assert.equal(toolResultSteps.length, 1);
    assert.equal((toolCallSteps[0] as { tool: string }).tool, 'getLatestPublishedVersion');
  } finally {
    __resetModuleLoaderForTests();
    globalThis.fetch = originalFetch;
  }
});

test('triageFinding - model/runtime failure degrades to an error with no trace, never throws', async () => {
  __setModuleLoaderForTests(async () => ({
    resolveModelFile: async () => {
      throw new Error('could not download model');
    },
  }) as never);
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('error' in result);
    assert.deepEqual(result.aiTrace, []);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('triageFinding - malformed verdict JSON degrades to an error instead of a guessed verdict', async () => {
  __setModuleLoaderForTests(mockLlamaCppModule(async () => {}, 'not json at all'));
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('error' in result);
    if ('error' in result) assert.match(result.error, /valid verdict JSON/);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('triageFinding - an invalid confidence value is rejected rather than accepted loosely', async () => {
  __setModuleLoaderForTests(
    mockLlamaCppModule(async () => {}, JSON.stringify({ verdict: 'x', confidence: 'extremely-high', reasoning: 'y' }))
  );
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('error' in result);
  } finally {
    __resetModuleLoaderForTests();
  }
});

test('triageFinding - exceeding the step cap reports an error, not an infinite loop', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ version: '19.0.0' }) })) as unknown as typeof fetch;
  __setModuleLoaderForTests(
    mockLlamaCppModule(async (functions) => {
      // Call the same tool 6 times in a row within one scripted prompt — the 6th call must
      // throw (MAX_STEPS = 5), which should propagate out of triageFinding as an error.
      for (let i = 0; i < 6; i++) {
        await functions.getLatestPublishedVersion?.handler({ packageName: 'react' });
      }
    }, 'unreachable')
  );
  try {
    const result = await triageFinding(DEFAULT_AI_AGENT_CONFIG, FINDING);
    assert.ok('error' in result);
    if ('error' in result) assert.match(result.error, /exceeded the 5-step limit/);
    // 5 successful steps, each with one tool_call + one tool_result entry = 10 trace entries.
    assert.equal(result.aiTrace.length, 10);
  } finally {
    __resetModuleLoaderForTests();
    globalThis.fetch = originalFetch;
  }
});
