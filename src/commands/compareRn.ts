import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type {
  AndroidNativeRequirements,
  IosNativeRequirements,
} from '../types/reactNativeRequirements.js';
import { printHeader, printSection, printError, printInfo } from '../utils/terminal.js';
import chalk from 'chalk';

export interface CompareRnOptions {
  json?: boolean;
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
  const jsonMode = !!options.json;

  const fromReq = getReactNativeRequirements(fromVersion);
  const toReq = getReactNativeRequirements(toVersion);

  if (!fromReq || !toReq) {
    const missing = !fromReq ? fromVersion : toVersion;
    const message = `No native requirement baseline found for React Native version "${missing}"`;
    if (jsonMode) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      printError(message);
    }
    process.exit(1);
  }

  const androidDiffs = diffFields(fromReq.android, toReq.android, ANDROID_LABELS);
  const iosDiffs = diffFields(fromReq.ios, toReq.ios, IOS_LABELS);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          from: fromReq.version,
          to: toReq.version,
          android: androidDiffs,
          ios: iosDiffs,
        },
        null,
        2
      )
    );
    return;
  }

  printHeader(`React Native ${fromReq.version} → ${toReq.version}`);

  printSection('Android');
  printDiffTable(androidDiffs);

  printSection('iOS');
  printDiffTable(iosDiffs);

  const anyChanged = [...androidDiffs, ...iosDiffs].some((d) => d.changed);
  if (!anyChanged) {
    printInfo('\nNo native toolchain baseline changes between these versions.');
  }
}
