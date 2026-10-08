import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzeAiSdkExposure } from '../analyzers/aiSdkExposure.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface AiExposureOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

export async function aiExposureCommand(options: AiExposureOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const result = analyzeAiSdkExposure(cwd, dependencies);

    if (jsonMode) {
      emitStructuredOutput(result, 'AI SDK Exposure', options);
      return;
    }

    printHeader('AI SDK Exposure');
    printInfo(`Scanned ${result.filesScanned} source file(s)`);

    printSection('Direct AI SDK Calls');
    if (result.sdksDetected.length === 0) {
      printSuccess('No client-side AI provider SDKs detected');
    } else {
      result.sdksDetected.forEach((sdk) => {
        printWarning(`${sdk.packageName} (${sdk.provider}) — called directly from the app`);
      });
      console.log('  └─ Proxy AI provider calls through your own backend; embedding a provider key in the client ships it inside the app bundle.');
    }

    printSection('API Key Literals');
    if (result.keyExposures.length === 0) {
      printSuccess('No AI-provider-key-shaped literals found in source');
    } else {
      result.keyExposures.forEach((exp) => {
        printError(`Possible ${exp.label} in ${exp.file}:${exp.line}`);
      });
      console.log('  └─ Move this value out of source (env/secret manager) and rotate the key.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'AI SDK Exposure', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
