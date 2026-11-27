import { detectIosPackagingFiles } from '../detectors/ios/swiftPackage.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { SwiftPmPackageSupport, SwiftPmSupportResult } from '../types/swiftPm.js';

/**
 * Per installed dependency with iOS native code: does it ship a `Package.swift` (so a move off
 * CocoaPods is at least possible) or only a podspec? Based on the files a package actually
 * ships, not a curated list. A manifest's presence does not prove React Native's SwiftPM mode
 * can consume the module, so a `ships-package-swift` result is a necessary signal, not a
 * guarantee; `cocoapods-only` is a definite "no SwiftPM manifest in this version".
 */
export function analyzeSwiftPmSupport(cwd: string, dependencies: DependencyInfo[]): SwiftPmSupportResult {
  const packages: SwiftPmPackageSupport[] = [];
  const notInstalled: string[] = [];

  for (const dep of dependencies) {
    if (dep.name === 'rn-dep-scanner') continue;
    const files = detectIosPackagingFiles(cwd, dep.name);
    if (!files) {
      notInstalled.push(dep.name);
      continue;
    }
    if (!files.podspec && !files.packageSwift) continue;
    packages.push({
      package: dep.name,
      version: dep.resolvedVersion || dep.requestedVersion,
      status: files.packageSwift ? 'ships-package-swift' : 'cocoapods-only',
    });
  }

  const byName = (a: string, b: string): number => a.localeCompare(b);
  return {
    packages: packages.sort((a, b) => byName(a.package, b.package)),
    notInstalled: notInstalled.sort(byName),
  };
}
