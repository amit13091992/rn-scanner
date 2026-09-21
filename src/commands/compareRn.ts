import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type {
  AndroidNativeRequirements,
  IosNativeRequirements,
} from '../types/reactNativeRequirements.js';
import { printHeader, printSection, printError, printInfo } from '../utils/terminal.js';
import chalk from 'chalk';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface CompareRnOptions {
  json?: boolean;
  html?: HtmlOption;
}

interface FieldDiff {
  name: string;
  from?: string;
  to?: string;
  changed: boolean;
}

function diffFields<T extends object>(from: T | undefined, to: T | undefined, labels: Record<keyof T, string>): FieldDiff[] {
  const keys = Object.keys(labels) as Array<keyof T>;
  return keys.map((key) => {
    const fromVal = from?.[key] as unknown as string | undefined;
    const toVal = to?.[key] as unknown as string | undefined;
    return {
      name: labels[key],
      from: fromVal,
      to: toVal,
      changed: fromVal !== toVal,
    };
  });
}

const ANDROID_LABELS: Record<keyof AndroidNativeRequirements, string> = {
  jdk: 'JDK',
  kotlin: 'Kotlin',
  agp: 'AGP',
  gradle: 'Gradle',
  compileSdk: 'compileSdk',
  targetSdk: 'targetSdk',
  minSdk: 'minSdk',
  ndk: 'NDK',
  buildToolsVersion: 'buildToolsVersion',
};

const IOS_LABELS: Record<keyof IosNativeRequirements, string> = {
  xcode: 'Xcode',
  deploymentTarget: 'iOS Deployment Target',
  cocoapods: 'CocoaPods',
  ruby: 'Ruby',
  swift: 'Swift',
};

function printDiffTable(diffs: FieldDiff[]): void {
  diffs.forEach((diff) => {
    const from = diff.from ?? 'unknown';
    const to = diff.to ?? 'unknown';
    if (!diff.changed) {
      console.log(`  ${diff.name}: ${chalk.gray(from)} (unchanged)`);
    } else {
      console.log(`  ${diff.name}: ${chalk.yellow(from)} → ${chalk.green(to)}`);
    }
  });
}

export async function compareRnCommand(
  fromVersion: string,
  toVersion: string,
  options: CompareRnOptions = {}
): Promise<void> {
  const jsonMode = !!options.json || !!options.html;

  const fromReq = getReactNativeRequirements(fromVersion);
  const toReq = getReactNativeRequirements(toVersion);

  if (!fromReq || !toReq) {
    const missing = !fromReq ? fromVersion : toVersion;
    const message = `No native requirement baseline found for React Native version "${missing}"`;
    if (jsonMode) {
      emitStructuredOutput({ error: message }, 'RN Version Comparison', options);
    } else {
      printError(message);
    }
    process.exit(1);
  }

  const androidDiffs = diffFields(fromReq.android, toReq.android, ANDROID_LABELS);
  const iosDiffs = diffFields(fromReq.ios, toReq.ios, IOS_LABELS);
  const nodeDiff: FieldDiff = {
    name: 'Node.js',
    from: fromReq.node,
    to: toReq.node,
    changed: fromReq.node !== toReq.node,
  };

  if (jsonMode) {
    emitStructuredOutput(
      { from: fromReq.version, to: toReq.version, node: nodeDiff, android: androidDiffs, ios: iosDiffs },
      'RN Version Comparison',
      options
    );
    return;
  }

  printHeader(`React Native ${fromReq.version} → ${toReq.version}`);

  printSection('Node.js');
  printDiffTable([nodeDiff]);

  printSection('Android');
  printDiffTable(androidDiffs);

  printSection('iOS');
  printDiffTable(iosDiffs);

  const anyChanged = [nodeDiff, ...androidDiffs, ...iosDiffs].some((d) => d.changed);
  if (!anyChanged) {
    printInfo('\nNo native toolchain baseline changes between these versions.');
  }
}
