import type { ExpoSdkRequirements } from '../../types/expo.js';

/**
 * Expo SDK -> React Native version pinning, hand-maintained like
 * `src/data/reactNative/registry.ts` (same staleness caveat applies: this goes stale every
 * time Expo ships a new SDK, and nothing detects that automatically).
 *
 * MAINTENANCE: when a new Expo SDK ships, check its release notes
 * (https://expo.dev/changelog) for the exact React Native version it pins and whether the
 * New Architecture is mandatory (no more legacy-bridge opt-out), then append one entry here.
 *
 * Confirmed vs. estimated:
 *  - SDK 50-53: confirmed from public Expo release notes at authoring time.
 *  - SDK 55 and 57: confirmed — explicitly noted in this project's own roadmap research
 *    (SDK 55+ requires the New Architecture; SDK 57 pins React Native 0.86).
 *  - SDK 54 and 56: estimated, interpolated from the surrounding confirmed entries' cadence
 *    (roughly one RN minor per SDK release) — replace with confirmed values once verified
 *    against that SDK's actual release notes.
 */
export const EXPO_SDK_REGISTRY: ExpoSdkRequirements[] = [
  { sdk: 50, reactNative: '0.73', newArchRequired: false, confidence: 'confirmed' },
  { sdk: 51, reactNative: '0.74', newArchRequired: false, confidence: 'confirmed' },
  { sdk: 52, reactNative: '0.76', newArchRequired: false, confidence: 'confirmed' },
  { sdk: 53, reactNative: '0.79', newArchRequired: false, confidence: 'confirmed' },
  { sdk: 54, reactNative: '0.81', newArchRequired: true, confidence: 'estimated' },
  { sdk: 55, reactNative: '0.83', newArchRequired: true, confidence: 'confirmed' },
  { sdk: 56, reactNative: '0.84', newArchRequired: true, confidence: 'estimated' },
  { sdk: 57, reactNative: '0.86', newArchRequired: true, confidence: 'confirmed' },
];

export function getExpoSdkRequirements(sdk: number): ExpoSdkRequirements | undefined {
  return EXPO_SDK_REGISTRY.find((entry) => entry.sdk === sdk);
}
