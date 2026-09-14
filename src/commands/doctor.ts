import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { detectHermes } from '../detectors/hermes.js';
import { analyzeHermes } from '../analyzers/hermes.js';
import { analyzeAndroidEnvironment } from '../analyzers/androidEnvironment.js';
import { analyzeIosEnvironment } from '../analyzers/iosEnvironment.js';
import { analyzeNodeEnvironment } from '../analyzers/nodeEnvironment.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { verdictFromRequirements, combineVerdicts } from '../utils/verdict.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printInfo,
  printError,
} from '../utils/terminal.js';

function printEnvironmentRequirements(requirements: EnvironmentRequirement[]): void {
  for (const req of requirements) {
    const current = req.current ?? 'not detected';
    const target = req.required ?? req.recommended;
    const label = target ? `${req.name}: ${current} (required: ${target})` : `${req.name}: ${current}`;
    if (req.status === 'ok') {
      printSuccess(label);
    } else if (req.status === 'warning') {
      printWarning(label);
    } else if (req.status === 'error') {
      printError(label);
    } else {
      printInfo(label);
    }
    if (req.reason) {
      printInfo(`  ${req.reason}`);
    }
  }
}

export interface DoctorOptions {
  json?: boolean;
  cwd?: string;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const rnInfo = detectReactNativeVersions(cwd);
    const hermesInfo = detectHermes(cwd, rnInfo.version);
    const hermes = analyzeHermes(hermesInfo);
    const rnVersionForEnv = rnInfo.version || '';
    const androidEnvironment = analyzeAndroidEnvironment(cwd, rnVersionForEnv);
    const iosEnvironment = analyzeIosEnvironment(cwd, rnVersionForEnv);
    const nodeEnvironment = analyzeNodeEnvironment(rnVersionForEnv);
    const verdict = combineVerdicts([
      verdictFromRequirements(nodeEnvironment),
      verdictFromRequirements(androidEnvironment),
      verdictFromRequirements(iosEnvironment),
    ]);

    if (jsonMode) {
      const result = {
        reactNative: {
          version: rnInfo.version,
          react: rnInfo.react,
        },
        hermes: {
          status: hermes.status,
          detectedFrom: hermes.detectedFrom,
          messages: hermes.messages,
        },
        verdict,
        nodeEnvironment,
        androidEnvironment,
        iosEnvironment,
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader('React Native Environment');

    const verdictLabel = verdict === 'BLOCKED' ? '🔴 BLOCKED' : verdict === 'WARN' ? '🟠 WARN' : '✓ READY';
    console.log(`Verdict: ${verdictLabel}\n`);

    printSection('React Native');
    if (rnInfo.version) {
      printSuccess(`React Native: ${rnInfo.version}`);
    } else {
      printWarning('React Native: not found');
    }
    if (rnInfo.react) {
      printSuccess(`React: ${rnInfo.react}`);
    } else {
      printWarning('React: not found');
    }

    printSection('Hermes');
    if (hermes.status === 'enabled') {
      printSuccess(`Hermes: enabled (detected from ${hermes.detectedFrom})`);
    } else if (hermes.status === 'disabled') {
      printWarning(`Hermes: disabled (detected from ${hermes.detectedFrom})`);
    } else {
      printInfo('Hermes: could not be determined');
    }
    hermes.messages.forEach((msg) => printWarning(msg));

    printSection('Node.js Environment');
    printEnvironmentRequirements(nodeEnvironment);

    printSection('Android Environment');
    printEnvironmentRequirements(androidEnvironment);

    printSection('iOS Environment');
    printEnvironmentRequirements(iosEnvironment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
