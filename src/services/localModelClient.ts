import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { AgentToolDefinition } from '../types/aiAgent.js';

/** Where `resolveModelFile` caches downloaded GGUF model files — a local cache dir, not
 *  bundled into the npm package itself, so `npm install rn-dep-scanner` stays small and only
 *  users who actually run `--ai` ever pay the one-time download cost. */
export const MODELS_DIR = join(homedir(), '.cache', 'rn-dep-scanner', 'models');

/** `node-llama-cpp` otherwise prints native-load diagnostics (e.g. a GGUF metadata warning)
 *  straight to stdout — which corrupts `check --json`'s output the moment `--ai` loads a
 *  model, since that stdout is no longer valid JSON. `'error'` keeps genuine failures visible
 *  while silencing routine load chatter. A plain string, not `LlamaLogLevel.error`, so this
 *  file doesn't need a static import of the module it otherwise only ever loads dynamically. */
const LOG_LEVEL = 'error';

type LlamaCppModule = typeof import('node-llama-cpp');

let moduleLoader: () => Promise<LlamaCppModule> = () => import('node-llama-cpp');

/**
 * Test-only seam: `node-llama-cpp` loads a real platform-specific native binary and, on
 * first use, downloads a multi-hundred-MB model file — neither is feasible to exercise in a
 * unit test, and Node has no clean hook for mocking a dynamic `import()`. Tests substitute a
 * fake module here instead. Never called from production code.
 */
export function __setModuleLoaderForTests(loader: () => Promise<LlamaCppModule>): void {
  moduleLoader = loader;
}

export function __resetModuleLoaderForTests(): void {
  moduleLoader = () => import('node-llama-cpp');
}

/** The filename segment from an `hf:org/repo/file.gguf` URI — used only to match against
 *  whatever `resolveModelFile` actually cached it as, never to reconstruct the exact cached
 *  filename ourselves. `resolveModelFile`'s own cache naming (confirmed in practice: it
 *  prefixes with `hf_<org>_` and drops the repo segment, e.g. `hf:Qwen/Qwen2.5-.../file.gguf`
 *  → `hf_Qwen_file.gguf`) is an internal implementation detail that could change across
 *  `node-llama-cpp` versions, so matching by suffix is the only check that stays correct
 *  without re-deriving that scheme ourselves and silently drifting out of sync with it. */
function modelFilenameSegment(model: string): string {
  return model.split('/').pop() ?? model;
}

/** Finds the actual cached file for `model` by suffix match against whatever's in
 *  `MODELS_DIR`, without guessing the exact cache filename scheme. Returns `undefined` when
 *  the directory doesn't exist yet or nothing matches — never throws. */
function findCachedModelFile(model: string): string | undefined {
  const suffix = modelFilenameSegment(model).toLowerCase();
  let entries: string[];
  try {
    entries = readdirSync(MODELS_DIR);
  } catch {
    return undefined;
  }
  const match = entries.find((entry) => entry.toLowerCase().endsWith(suffix));
  return match ? join(MODELS_DIR, match) : undefined;
}

export function isModelDownloaded(model: string): boolean {
  return findCachedModelFile(model) !== undefined;
}

/** The actual on-disk path if already cached, otherwise a best-guess path for display only —
 *  never used to load the model (that always goes through `resolveModelFile`'s own return
 *  value, which knows the real scheme). */
export function getModelPath(model: string): string {
  return findCachedModelFile(model) ?? join(MODELS_DIR, modelFilenameSegment(model));
}

/**
 * Checks whether `node-llama-cpp` can load its native backend on this machine. This is the
 * one check that can't avoid loading the real module — there's no file to check for existence
 * the way there is for the model — so it degrades to `false` on any failure (unsupported
 * platform/architecture, a corrupted native build) rather than throwing.
 */
export async function isRuntimeAvailable(): Promise<boolean> {
  try {
    const { getLlama } = await moduleLoader();
    await getLlama({ logLevel: LOG_LEVEL } as unknown as Parameters<typeof getLlama>[0]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads (or confirms already-cached) the configured model file. Never throws: a network
 * failure, an invalid model URI, or a disk error all resolve to `{ ok: false }` so `--ai`/
 * `ai-setup --download` can report why, rather than crashing.
 */
export async function ensureModelDownloaded(
  model: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const { resolveModelFile } = await moduleLoader();
    const path = await resolveModelFile(model, MODELS_DIR);
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error downloading the model' };
  }
}

export interface LocalAgentTool {
  definition: AgentToolDefinition;
  /** Wrapped by the caller (`agent/triage.ts`) so it can enforce its own step cap and record
   *  a trace entry per call — this client only translates the schema, it has no opinion on
   *  how many times a tool may be called. */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** A plain JSON-schema object (object type, string-typed properties, optional `enum`) used
 *  to grammar-constrain a model's final answer. Deliberately a small, generic local type
 *  rather than importing `node-llama-cpp`'s own `GbnfJsonSchema` type everywhere — the same
 *  boundary-cast approach already used for tool parameter schemas below. */
export interface ResponseJsonSchema {
  type: 'object';
  properties: Record<string, { type: 'string'; enum?: string[] }>;
  required?: string[];
}

/**
 * Loads the model (downloading it first if needed) and runs one prompt with the given tools
 * available for the model to call, via `node-llama-cpp`'s own in-process function-calling —
 * no HTTP, no daemon. Never throws: any failure (model load, inference, a tool handler
 * throwing because a step cap was exceeded) resolves to `{ ok: false, error }`.
 *
 * When `responseSchema` is given, a second prompt runs in the same session (so it keeps the
 * context gathered from any tool calls above) with `functions` dropped and a grammar built
 * from `responseSchema` applied instead — this *structurally* constrains the model to only
 * generate tokens that form valid JSON matching the schema, rather than relying on a prompt
 * instruction ("respond with ONLY JSON") the model might ignore. In practice, asking nicely in
 * the system prompt was unreliable even on a larger (1.5B) instruct model — this is the fix,
 * same "enforce in code, not the prompt" principle already applied to the `MAX_STEPS` cap.
 */
export async function runLocalChatWithTools(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  tools: LocalAgentTool[],
  responseSchema?: ResponseJsonSchema
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    const { getLlama, LlamaChatSession, defineChatSessionFunction } = await moduleLoader();
    const downloaded = await ensureModelDownloaded(model);
    if (!downloaded.ok) return downloaded;

    const llama = await getLlama({ logLevel: LOG_LEVEL } as unknown as Parameters<typeof getLlama>[0]);
    const llamaModel = await llama.loadModel({ modelPath: downloaded.path });
    const context = await llamaModel.createContext();
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt });

      const functions: Record<string, ReturnType<typeof defineChatSessionFunction>> = {};
      for (const tool of tools) {
        // `node-llama-cpp`'s GBNF-JSON-schema type (and the handler param type it derives
        // from it) is stricter — literal type unions — than this project's own generic
        // `AgentToolDefinition` schema shape. Every tool this project defines uses only plain
        // string properties, so this boundary cast is safe in practice even though it isn't
        // structurally provable to the type checker across the two schema representations.
        functions[tool.definition.function.name] = defineChatSessionFunction({
          description: tool.definition.function.description,
          params: tool.definition.function.parameters,
          handler: tool.handler,
        } as unknown as Parameters<typeof defineChatSessionFunction>[0]);
      }

      const firstPassContent = await session.prompt(userPrompt, { functions });
      if (!responseSchema) {
        return { ok: true, content: firstPassContent };
      }

      const grammar = await llama.createGrammarForJsonSchema(
        responseSchema as unknown as Parameters<typeof llama.createGrammarForJsonSchema>[0]
      );
      const structuredContent = await session.prompt(
        'Respond with ONLY the final verdict as a JSON object matching the required schema.',
        { grammar }
      );
      return { ok: true, content: structuredContent };
    } finally {
      await context.dispose();
      await llamaModel.dispose();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown local model error' };
  }
}
