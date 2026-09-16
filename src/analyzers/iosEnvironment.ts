import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { coerce, lt } from 'semver';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type { IosNativeRequirements } from '../types/reactNativeRequirements.js';
import { detectXcodeHints, detectSwiftVersionHint, detectInstalledXcodeVersion } from '../detectors/ios/xcode.js';
import { detectDeploymentTarget } from '../detectors/ios/deploymentTarget.js';
import { detectCocoaPodsVersion } from '../detectors/ios/cocoapods.js';
import { detectRubyVersion } from '../detectors/ios/ruby.js';

function resolveStatus(
  current: string | null,
  required: string | undefined
): { status: EnvironmentRequirement['status']; required?: string } {
  if (!current) {
    return { status: 'unknown', required };
  }

  const coercedCurrent = coerce(current);
  if (!coercedCurrent) {
    return { status: 'unknown', required };
  }

  if (required) {
    const coercedRequired = coerce(required);
    if (coercedRequired && lt(coercedCurrent, coercedRequired)) {
      return { status: 'error', required };
    }
  }

  return { status: 'ok', required };
}

/**
 * Analyzes the iOS native toolchain environment against the baseline
 * requirements for the detected React Native version. Detection is entirely
 * static-file-based (Podfile, Podfile.lock, .xcodeproj, Gemfile, etc.) — no
 * shelling out to check installed toolchains. Never throws: missing files or
 * an absent ios/ directory simply produce 'unknown' statuses.
 */
export function analyzeIosEnvironment(cwd: string, rnVersion: string): EnvironmentRequirement[] {
  const hasIosDir = existsSync(join(cwd, 'ios'));

  let iosRequirements: IosNativeRequirements | undefined;
  try {
    iosRequirements = getReactNativeRequirements(rnVersion)?.ios;
  } catch {
    iosRequirements = undefined;
  }

  const results: EnvironmentRequirement[] = [];

  // Xcode — prefer the actually-installed version (ground truth, like Node detection);
  // fall back to the indirect project-file hint only when xcodebuild isn't available.
  const installedXcode = detectInstalledXcodeVersion();
  const xcodeHints = hasIosDir ? detectXcodeHints(cwd) : { version: null, deploymentTarget: null };

  if (installedXcode) {
    const xcodeResolved = resolveStatus(installedXcode, iosRequirements?.xcode);
    results.push({
      name: 'Xcode',
      current: installedXcode,
      required: xcodeResolved.required,
      status: xcodeResolved.status,
      source: 'xcodebuild -version (installed)',
    });
  } else {
    const xcodeResolved = resolveStatus(xcodeHints.version, iosRequirements?.xcode);
    results.push({
      name: 'Xcode',
      current: xcodeHints.version ?? undefined,
      required: xcodeResolved.required,
      // This heuristic is a low-confidence, indirect signal (what last touched the
      // project file, not what's installed) — never let it hard-block a verdict, only warn.
      status: !xcodeHints.version ? 'unknown' : xcodeResolved.status === 'error' ? 'warning' : xcodeResolved.status,
      source: xcodeHints.version ? 'ios/*.xcodeproj/project.pbxproj (LastUpgradeCheck)' : undefined,
      reason: !hasIosDir
        ? 'No ios/ directory found'
        : !xcodeHints.version
          ? 'Xcode version cannot be confidently derived from project files (indirect signal only), and `xcodebuild` was not available to check the installed version'
          : 'xcodebuild was not available to check the installed version — derived from LastUpgradeCheck in project.pbxproj instead, which only reflects what last touched the project file, not what is actually installed; downgraded to a warning rather than blocking',
    });
  }

  // iOS deployment target
  const deploymentTarget = hasIosDir ? detectDeploymentTarget(cwd) : { version: null, source: 'unknown' as const };
  const deploymentResolved = resolveStatus(deploymentTarget.version, iosRequirements?.deploymentTarget);
  results.push({
    name: 'iOS Deployment Target',
    current: deploymentTarget.version ?? undefined,
    required: deploymentResolved.required,
    status: deploymentTarget.version ? deploymentResolved.status : 'unknown',
    source: deploymentTarget.version ? deploymentTarget.source : undefined,
    reason: !hasIosDir
      ? 'No ios/ directory found'
      : !deploymentTarget.version
        ? 'No deployment target found in Podfile, .xcconfig files, or project.pbxproj'
        : undefined,
  });

  // CocoaPods
  const cocoapodsVersion = hasIosDir ? detectCocoaPodsVersion(cwd) : null;
  const cocoapodsResolved = resolveStatus(cocoapodsVersion, iosRequirements?.cocoapods);
  results.push({
    name: 'CocoaPods',
    current: cocoapodsVersion ?? undefined,
    required: cocoapodsResolved.required,
    status: cocoapodsVersion ? cocoapodsResolved.status : 'unknown',
    source: cocoapodsVersion ? 'ios/Podfile.lock' : undefined,
    reason: !hasIosDir
      ? 'No ios/ directory found'
      : !cocoapodsVersion
        ? 'No Podfile.lock found, or it has no COCOAPODS version line (run `pod install`)'
        : undefined,
  });

  // Ruby
  const ruby = detectRubyVersion(cwd);
  const rubyResolved = resolveStatus(ruby.version, iosRequirements?.ruby);
  results.push({
    name: 'Ruby',
    current: ruby.version ?? undefined,
    required: rubyResolved.required,
    status: ruby.version ? rubyResolved.status : 'unknown',
    source: ruby.version ? ruby.source : undefined,
    reason: !ruby.version
      ? 'No .ruby-version file or Gemfile ruby declaration found'
      : undefined,
  });

  // Swift — always unknown; Xcode-provided, rarely declared explicitly
  const swiftHint = detectSwiftVersionHint();
  results.push({
    name: 'Swift',
    required: iosRequirements?.swift,
    status: swiftHint.status,
    reason: swiftHint.reason,
  });

  return results;
}
