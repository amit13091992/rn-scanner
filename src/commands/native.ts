import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeAndroidEnvironment } from '../analyzers/androidEnvironment.js';
import { analyzeIosEnvironment } from '../analyzers/iosEnvironment.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { verdictFromRequirements, combineVerdicts } from '../utils/verdict.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface NativeOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

function printRequirements(requirements: EnvironmentRequirement[]): void {
  for (const req of requirements) {
    const current = req.current ?? 'not detected';
    const target = req.required ?? req.recommended;
    const label = target ? `${req.name}: ${current} (required: ${target})` : `${req.name}: ${current}`;
    if (req.status === 'ok') printSuccess(label);
    else if (req.status === 'warning') printWarning(label);
    else if (req.status === 'error') printError(label);
    else printInfo(label);
    if (req.reason) printInfo(`  ${req.reason}`);
  }
}

/**
 * Standalone Android + iOS native toolchain report — the same `analyzeAndroidEnvironment`/
 * `analyzeIosEnvironment` data `doctor` already surfaces, exposed on its own for a user who
 * only wants the native-toolchain slice (e.g. debugging a build-environment issue) without
 * `doctor`'s Hermes/Node/page-size checks.
 */
export async function nativeCommand(options: NativeOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let versionMissing = false;

  try {
    const rnInfo = await detectReactNativeVersions(cwd);

    if (!rnInfo.version) {
      const error = 'React Native version not detected — cannot check native toolchain requirements';
      if (jsonMode) {
        emitStructuredOutput({ error }, 'Native Environment Report', options);
      } else {
        printError(error);
      }
      versionMissing = true;
    } else {
      const android = analyzeAndroidEnvironment(cwd, rnInfo.version);
      const ios = analyzeIosEnvironment(cwd, rnInfo.version);
      const verdict = combineVerdicts([verdictFromRequirements(android), verdictFromRequirements(ios)]);

      if (jsonMode) {
        emitStructuredOutput({ reactNative: rnInfo.version, android, ios, verdict }, 'Native Environment Report', options);
      } else {
        printHeader('Native Toolchain');
        printInfo(`React Native: ${rnInfo.version}`);

        printSection('Android');
        printRequirements(android);

        printSection('iOS');
        printRequirements(ios);

        printSection('Verdict');
        if (verdict === 'READY') printSuccess('READY');
        else if (verdict === 'WARN') printWarning('WARN');
        else printError('BLOCKED');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Native Environment Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (versionMissing) {
    process.exit(1);
  }
}
