import { readIpaListing, findAppName, hasDsymForApp } from '../detectors/ios/ipaPackage.js';
import type { IosPackageCheckResult } from '../types/iosPackage.js';

/**
 * Checks a built .ipa/.xcarchive for dSYM presence — a missing dSYM means crash reports from
 * that build can't be symbolicated. Static zip-listing only, no extraction/execution.
 */
export function analyzeIosPackage(ipaPath: string): IosPackageCheckResult {
  const listing = readIpaListing(ipaPath);

  if (!listing) {
    return {
      appName: null,
      hasDsym: false,
      notes: [`Could not read ${ipaPath} as a zip archive — verify the path points to a valid .ipa or .xcarchive`],
    };
  }

  const appName = findAppName(listing.entries);
  if (!appName) {
    return {
      appName: null,
      hasDsym: false,
      notes: ['Could not find a Payload/<App>.app entry — this may not be a valid .ipa'],
    };
  }

  const hasDsym = hasDsymForApp(listing.entries, appName);

  return {
    appName,
    hasDsym,
    notes: hasDsym
      ? []
      : [`No dSYM found for ${appName}.app — crash reports from this build cannot be symbolicated`],
  };
}
