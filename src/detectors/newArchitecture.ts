import { satisfies, coerce } from 'semver';
import type { NewArchProjectStatus } from '../types/newArchitecture.js';

export function detectNewArchitectureStatus(reactNativeVersion: string | null): NewArchProjectStatus {
  if (!reactNativeVersion) {
    return {
      reactNativeVersion: null,
      isNewArchDefault: false,
      isBridgeRemoved: false,
    };
  }

  const coerced = coerce(reactNativeVersion);
  const cleanVersion = coerced ? coerced.version : null;

  if (!cleanVersion) {
    return {
      reactNativeVersion,
      isNewArchDefault: false,
      isBridgeRemoved: false,
    };
  }

  return {
    reactNativeVersion,
    isNewArchDefault: satisfies(cleanVersion, '>=0.76.0'),
    isBridgeRemoved: satisfies(cleanVersion, '>=0.82.0'),
  };
}
