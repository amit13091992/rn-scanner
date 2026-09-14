import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { coerce, lt } from 'semver';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type { IosNativeRequirements } from '../types/reactNativeRequirements.js';
import { detectXcodeHints, detectSwiftVersionHint } from '../detectors/ios/xcode.js';
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

  // Xcode (best-effort — indirect signal only)
  const xcodeHints = hasIosDir ? detectXcodeHints(cwd) : { version: null, deploymentTarget: null };
  const xcodeResolved = resolveStatus(xcodeHints.version, iosRequirements?.xcode);
  results.push({
    name: 'Xcode',
    current: xcodeHints.version ?? undefined,
    required: xcodeResolved.required,
    status: xcodeHints.version ? xcodeResolved.status : 'unknown',
    source: xcodeHints.version ? 'ios/*.xcodeproj/project.pbxproj (LastUpgradeCheck)' : undefined,
    reason: !hasIosDir
      ? 'No ios/ directory found'
      : !xcodeHints.version
        ? 'Xcode version cannot be confidently derived from project files (indirect signal only)'
        : 'Derived from LastUpgradeCheck in project.pbxproj — best-effort, not a guaranteed installed version',
  });

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
