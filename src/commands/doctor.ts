import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { detectHermes } from '../detectors/hermes.js';
import { analyzeHermes } from '../analyzers/hermes.js';
import { analyzeAndroidEnvironment } from '../analyzers/androidEnvironment.js';
import { analyzeIosEnvironment } from '../analyzers/iosEnvironment.js';
import { analyzeNodeEnvironment } from '../analyzers/nodeEnvironment.js';
import { analyzePageSize } from '../analyzers/pageSize.js';
import { analyzePageSizeBuildConfig, describePageSizeDeadline, formatPageSizeDeadline } from '../analyzers/pageSizeReadiness.js';
import { analyzeIosPackage } from '../analyzers/iosPackage.js';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import type { PageSizeCheckResult } from '../types/pageSize.js';
import { verdictFromRequirements, combineVerdicts } from '../utils/verdict.js';
import { Profiler } from '../utils/profiler.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printInfo,
  printError,
  printProfile,
} from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { listWorkspaceTargets, runCapturingExit } from '../utils/workspaceRun.js';

function noNativeLibrariesMessage(cwd: string, count: number): string {
  const base = `No prebuilt native (.so) libraries found across ${count} dependenc${count === 1 ? 'y' : 'ies'} — either no native modules are installed, or their .so files haven't been generated yet (some compile from source during the Android build)`;
  return existsSync(join(cwd, 'android'))
    ? base
    : `${base}. There is no android/ directory, so nothing has been built: generate or restore it (\`npx expo prebuild --platform android\` for Expo projects), build the app, then re-run this check against the generated .so files or your APK/AAB.`;
}

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
  html?: HtmlOption;
  cwd?: string;
  ipa?: string;
  profile?: boolean;
  /** Run the environment check against every workspace package in the monorepo, not just
   *  `cwd`, and aggregate the results into one report. */
  allWorkspaces?: boolean;
}

async function runAcrossWorkspaces(cwd: string, options: DoctorOptions): Promise<void> {
  const jsonMode = !!options.json || !!options.html;
  const targets = listWorkspaceTargets(cwd);

  if (targets.length === 0) {
    return doctorCommand({ ...options, allWorkspaces: false });
  }

  if (!jsonMode) {
    printHeader('React Native Environment (all workspaces)');
  }

  let anyExit = false;
  const perPackageResults: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (!jsonMode) {
      printSection(`Workspace package: ${target.name}`);
    }
    const { output, exitCode } = await runCapturingExit(() =>
      doctorCommand({ ...options, cwd: target.dir, allWorkspaces: false, json: jsonMode, html: false })
    );
    if (exitCode) anyExit = true;

    if (jsonMode) {
      try {
        perPackageResults.push({ ...JSON.parse(output), package: target.name, dir: target.dir });
      } catch {
        perPackageResults.push({ package: target.name, dir: target.dir, error: 'Could not parse result' });
      }
    } else {
      console.log(output.replace(/\n$/, ''));
    }
  }

  if (jsonMode) {
    emitStructuredOutput({ workspaces: perPackageResults }, 'Doctor Report (all workspaces)', options);
  }

  if (anyExit) {
    process.exit(1);
  }
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  if (options.allWorkspaces) {
    return runAcrossWorkspaces(cwd, options);
  }

  const profiler = new Profiler(!!options.profile);

  try {
    const rnInfo = await profiler.time('detectReactNativeVersions', () => detectReactNativeVersions(cwd));
    const hermesInfo = await profiler.time('detectHermes', () => detectHermes(cwd, rnInfo.version));
    const hermes = analyzeHermes(hermesInfo);
    const rnVersionForEnv = rnInfo.version || '';
    const androidEnvironment = await profiler.time('analyzeAndroidEnvironment', () =>
      analyzeAndroidEnvironment(cwd, rnVersionForEnv)
    );
    const iosEnvironment = await profiler.time('analyzeIosEnvironment', () =>
      analyzeIosEnvironment(cwd, rnVersionForEnv)
    );
    const nodeEnvironment = analyzeNodeEnvironment(rnVersionForEnv);

    let pageSize: PageSizeCheckResult[] = [];
    try {
      await profiler.time('analyzePageSize (node_modules walk)', async () => {
        const packageJson = readPackageJson(cwd);
        const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
        pageSize = analyzePageSize(cwd, dependencies);
      });
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

    const pageSizeBuildConfig = analyzePageSizeBuildConfig(cwd);
    const pageSizeDeadline = describePageSizeDeadline();

    const iosPackage = options.ipa ? analyzeIosPackage(options.ipa) : null;

    const verdict = combineVerdicts([
      verdictFromRequirements(nodeEnvironment),
      verdictFromRequirements(androidEnvironment),
      verdictFromRequirements(iosEnvironment),
      verdictFromRequirements(pageSizeRequirements),
      verdictFromRequirements(pageSizeBuildConfig),
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
        pageSize16kBuild: pageSizeBuildConfig,
        pageSize16kDeadline: pageSizeDeadline,
        ...(iosPackage ? { iosPackage } : {}),
        ...(options.profile ? { profile: { steps: profiler.report(), totalMs: profiler.totalMs() } } : {}),
      };
      emitStructuredOutput(result, 'Doctor Report', options);
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
    printSection('16KB Page-Size Alignment (Android)');
    if (pageSize.length === 0) {
      printInfo('No dependencies to check — no readable package.json, or no dependencies declared');
    } else if (pageSizeChecked.length === 0) {
      printInfo(noNativeLibrariesMessage(cwd, pageSize.length));
    } else if (pageSizeUnaligned.length === 0) {
      printSuccess(`All ${pageSizeChecked.length} checked native librar${pageSizeChecked.length === 1 ? 'y is' : 'ies are'} 16KB-page-size aligned`);
    } else {
      pageSizeUnaligned.forEach((r) => {
        printWarning(`${r.package}@${r.version} ships a native library that is not 16KB-page-size aligned`);
        r.libraries
          .filter((l) => !l.is16kAligned)
          .forEach((l) => console.log(`  └─ ${l.path} (${l.abi}, max PT_LOAD align: ${l.maxLoadAlign} bytes)`));
      });
    }
    const pageSizeUnreadable = pageSize.filter((r) => r.notCheckedReason === 'unreadable_library');
    if (pageSizeUnreadable.length > 0) {
      printWarning(`${pageSizeUnreadable.length} package(s) shipped .so files that could not be read or parsed — alignment could not be determined`);
    }
    printEnvironmentRequirements(pageSizeBuildConfig);
    printInfo(formatPageSizeDeadline(pageSizeDeadline));

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

    if (options.profile) {
      printProfile(profiler.report(), profiler.totalMs());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Doctor Report', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
