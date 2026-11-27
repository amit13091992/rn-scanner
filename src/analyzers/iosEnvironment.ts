import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerce, gte, lt } from 'semver';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type { IosNativeRequirements } from '../types/reactNativeRequirements.js';
import { detectXcodeHints, detectSwiftVersionHint, detectInstalledXcodeVersion } from '../detectors/ios/xcode.js';
import { detectDeploymentTarget } from '../detectors/ios/deploymentTarget.js';
import { detectCocoaPodsVersion } from '../detectors/ios/cocoapods.js';
import { detectRubyVersion } from '../detectors/ios/ruby.js';
import { detectIosDependencyManagers } from '../detectors/ios/dependencyManager.js';

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

function hasSceneLifecycle(cwd: string): boolean {
  try {
    const iosDir = join(cwd, 'ios');
    for (const entry of readdirSync(iosDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const plist = join(iosDir, entry.name, 'Info.plist');
      if (existsSync(plist) && readFileSync(plist, 'utf8').includes('UIApplicationSceneManifest')) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
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

  // Apple requires the UIScene lifecycle for apps built with the iOS 27 SDK; RN 0.88 adds
  // SceneDelegate support (the AppDelegate path keeps working until then).
  const rnCoerced = coerce(rnVersion);
  if (hasIosDir && rnCoerced && gte(rnCoerced, '0.88.0')) {
    const migrated = hasSceneLifecycle(cwd);
    results.push({
      name: 'iOS UIScene lifecycle',
      current: migrated ? 'UIApplicationSceneManifest present' : 'not configured',
      required: 'UIApplicationSceneManifest in Info.plist',
      status: migrated ? 'ok' : 'warning',
      source: 'ios/*/Info.plist',
      reason: migrated
        ? undefined
        : 'Apps built with Xcode 27 / the iOS 27 SDK fail to launch without the UIScene lifecycle; move the RN entry point from AppDelegate to SceneDelegate (RN 0.88 migration).',
    });
  }

  // CocoaPods trunk goes read-only 2026-12-02, so pods published after that are SwiftPM-only.
  // Informational (never a warning): a working CocoaPods project is not broken today.
  if (hasIosDir && rnCoerced && gte(rnCoerced, '0.87.0')) {
    const managers = detectIosDependencyManagers(cwd);
    if (managers.cocoapods || managers.swiftPackageManager) {
      const current = managers.cocoapods && managers.swiftPackageManager
        ? 'CocoaPods + Swift Package Manager'
        : managers.swiftPackageManager
          ? 'Swift Package Manager'
          : 'CocoaPods';
      results.push({
        name: 'iOS dependency manager',
        current,
        status: 'ok',
        source: 'ios/Podfile, ios/*.xcodeproj/project.pbxproj',
        reason: managers.swiftPackageManager
          ? undefined
          : 'CocoaPods trunk becomes read-only on 2026-12-02; new versions of native dependencies may ship via Swift Package Manager only. React Native has an opt-in SwiftPM mode (planned default in 0.89) — check each native module for SwiftPM support before migrating.',
      });
    }
  }

  return results;
}
