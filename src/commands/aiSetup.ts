import { isRuntimeAvailable, isModelDownloaded, getModelPath, ensureModelDownloaded } from '../services/localModelClient.js';
import { loadConfig, resolveAiAgentConfig } from '../utils/config.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import type { AiSetupResult } from '../types/aiAgent.js';

export interface AiSetupOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Actually download the configured model now (a real, potentially several-hundred-MB
   *  download) instead of waiting for the first `check --ai` run to trigger it lazily. */
  download?: boolean;
}

/**
 * Checks (and, with `--download`, completes) local readiness for `check --ai`: can
 * `node-llama-cpp` load its native backend on this machine, and has the configured model
 * been downloaded. Phase 18: there is no external app/daemon to install — the native backend
 * is a normal transitive dependency fetched by `npm install rn-dep-scanner` itself; only the
 * model weights are a separate, lazy, one-time download, kept out of the npm package itself
 * so installing this CLI never costs every user a multi-hundred-MB download.
 */
export async function aiSetupCommand(options: AiSetupOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const { config } = loadConfig(cwd);
    const aiConfig = resolveAiAgentConfig(config);

    if (!jsonMode) printHeader('AI Agent Setup (embedded, local — no external app required)');

    const runtimeAvailable = await isRuntimeAvailable();
    let modelDownloaded = isModelDownloaded(aiConfig.model);

    let downloadAttempted: boolean | undefined;
    let downloadSucceeded: boolean | undefined;

    if (options.download && runtimeAvailable && !modelDownloaded) {
      downloadAttempted = true;
      if (!jsonMode) printInfo(`Downloading ${aiConfig.model} (this may take a while on first run)...`);
      const downloadResult = await ensureModelDownloaded(aiConfig.model);
      downloadSucceeded = downloadResult.ok;
      modelDownloaded = downloadResult.ok;
    }

    const nextSteps: string[] = [];
    if (!runtimeAvailable) {
      nextSteps.push(
        'The local AI runtime (node-llama-cpp) could not load on this machine — this usually means an unsupported platform/architecture, or a corrupted install. Try "npm install" again, or check for a node-llama-cpp release that supports your platform.'
      );
    }
    if (runtimeAvailable && !modelDownloaded) {
      nextSteps.push(`Download the configured model: rn-dep-scanner ai-setup --download (or it will download automatically on first "check --ai" run)`);
    }

    const ready = runtimeAvailable && modelDownloaded;

    const result: AiSetupResult = {
      model: aiConfig.model,
      runtimeAvailable,
      modelDownloaded,
      ...(modelDownloaded ? { modelPath: getModelPath(aiConfig.model) } : {}),
      ...(downloadAttempted !== undefined ? { downloadAttempted } : {}),
      ...(downloadSucceeded !== undefined ? { downloadSucceeded } : {}),
      ready,
      nextSteps,
    };

    if (jsonMode) {
      emitStructuredOutput(result, 'AI Agent Setup', options);
      return;
    }

    if (runtimeAvailable) {
      printSuccess('Local AI runtime (node-llama-cpp) is available on this machine');
    } else {
      printError('Local AI runtime (node-llama-cpp) could not be loaded on this machine');
    }

    if (modelDownloaded) {
      printSuccess(`Model "${aiConfig.model}" is downloaded and ready`);
    } else if (runtimeAvailable) {
      printWarning(`Model "${aiConfig.model}" has not been downloaded yet`);
    }

    if (ready) {
      console.log('\n✨ Ready — run any supporting command with --ai to use the local agent.');
    } else {
      console.log('\nNext steps:');
      nextSteps.forEach((step) => console.log(`  - ${step}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'AI Agent Setup', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
