export interface ExpoSdkRequirements {
  /** Expo SDK major version, e.g. 52 */
  sdk: number;
  /** React Native minor version this SDK pins, e.g. "0.76" */
  reactNative: string;
  /** Whether this SDK requires the New Architecture (no legacy-bridge opt-out) */
  newArchRequired: boolean;
  /** Whether this row is sourced from a shipped Expo release or extrapolated */
  confidence: 'confirmed' | 'estimated';
}

export interface ExpoDetectionResult {
  isExpo: boolean;
  /** Parsed SDK major version, e.g. 52 for "~52.0.11" */
  sdkVersion: number | null;
  source?: string;
}

export interface ExpoCompatibilityResult {
  isExpoProject: boolean;
  sdkVersion: number | null;
  expectedReactNative?: string;
  actualReactNative: string | null;
  reactNativeMismatch: boolean;
  newArchRequired: boolean;
  messages: string[];
}
