export type SwiftPmSupportStatus = 'ships-package-swift' | 'cocoapods-only';

export interface SwiftPmPackageSupport {
  package: string;
  version: string;
  /** A manifest file was found in the package; whether React Native's SwiftPM mode can consume it is not verified. */
  status: SwiftPmSupportStatus;
}

export interface SwiftPmSupportResult {
  /** Installed dependencies with iOS native code (a podspec or Package.swift). JS-only packages are not listed. */
  packages: SwiftPmPackageSupport[];
  /** Direct dependencies that could not be inspected because they are not installed at `node_modules/<name>`. */
  notInstalled: string[];
}
