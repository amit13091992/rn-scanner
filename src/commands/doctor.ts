import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { detectHermes } from '../detectors/hermes.js';
import { analyzeHermes } from '../analyzers/hermes.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printInfo,
  printError,
} from '../utils/terminal.js';

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
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader('React Native Environment');

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

    printInfo(
      '\nAndroid and iOS native toolchain checks (Kotlin, AGP, Gradle, Xcode, CocoaPods) are planned for a future release.'
    );
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
