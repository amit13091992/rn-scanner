import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { detectHermes } from '../detectors/hermes.js';
import { analyzeHermes } from '../analyzers/hermes.js';
import { analyzeAndroidEnvironment } from '../analyzers/androidEnvironment.js';
import { analyzeIosEnvironment } from '../analyzers/iosEnvironment.js';
import { analyzeNodeEnvironment } from '../analyzers/nodeEnvironment.js';
import { analyzePageSize } from '../analyzers/pageSize.js';
import { analyzeIosPackage } from '../analyzers/iosPackage.js';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import type { PageSizeCheckResult } from '../types/pageSize.js';
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
  ipa?: string;
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

    let pageSize: PageSizeCheckResult[] = [];
    try {
      const packageJson = readPackageJson(cwd);
      const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
      pageSize = analyzePageSize(cwd, dependencies);
    } catch {
      // No readable package.json here — page-size check simply has nothing to scan.
    }
    const pageSizeUnaligned = pageSize.filter((r) => r.status === 'unaligned');
    const pageSizeRequirements: EnvironmentRequirement[] = pageSizeUnaligned.map((r) => ({
      name: `16KB page-size alignment: ${r.package}`,
      current: 'unaligned',
      required: '16KB-aligned PT_LOAD segments',
      status: 'warning',
      reason: `${r.libraries.filter((l) => !l.is16kAligned).length} native librar${r.libraries.filter((l) => !l.is16kAligned).length === 1 ? 'y is' : 'ies are'} not 16KB-page-size safe`,
    }));

    const iosPackage = options.ipa ? analyzeIosPackage(options.ipa) : null;

    const verdict = combineVerdicts([
      verdictFromRequirements(nodeEnvironment),
      verdictFromRequirements(androidEnvironment),
      verdictFromRequirements(iosEnvironment),
      verdictFromRequirements(pageSizeRequirements),
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
        pageSize16k: pageSize,
        ...(iosPackage ? { iosPackage } : {}),
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

    const pageSizeChecked = pageSize.filter((r) => r.status !== 'not-checked');
    if (pageSizeChecked.length > 0) {
      printSection('16KB Page-Size Alignment (Android)');
      if (pageSizeUnaligned.length === 0) {
        printSuccess(`All ${pageSizeChecked.length} checked native librar${pageSizeChecked.length === 1 ? 'y is' : 'ies are'} 16KB-page-size aligned`);
      } else {
        pageSizeUnaligned.forEach((r) => {
          printWarning(`${r.package}@${r.version} ships a native library that is not 16KB-page-size aligned`);
          r.libraries
            .filter((l) => !l.is16kAligned)
            .forEach((l) => console.log(`  └─ ${l.path} (${l.abi}, max PT_LOAD align: ${l.maxLoadAlign} bytes)`));
        });
      }
    }

    if (iosPackage) {
      printSection('iOS Package (--ipa)');
      if (iosPackage.appName && iosPackage.hasDsym) {
        printSuccess(`dSYM found for ${iosPackage.appName}.app`);
      } else if (iosPackage.appName) {
        printWarning(`No dSYM found for ${iosPackage.appName}.app`);
      } else {
        printWarning(`Could not inspect ${options.ipa}`);
      }
      iosPackage.notes.forEach((note) => printInfo(note));
    }
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
