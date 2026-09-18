import type { ExpoGoPackageInfo } from '../../types/expoGo.js';

/**
 * Per-package Expo Go support, hand-maintained like `data/newArchitecture.ts` (same
 * staleness caveat: Expo Go's bundled native modules change per SDK release, and nothing
 * here detects that automatically — verify against https://docs.expo.dev/workflow/expo-go
 * when a new SDK ships).
 *
 * `supported` = works inside the Expo Go sandbox app as-is (bundled or pure-JS).
 * `unsupported` = ships native code Expo Go doesn't include; requires a custom dev client
 * (`expo prebuild` / EAS Build) instead of Expo Go.
 */
export const expoGoPackages: ExpoGoPackageInfo[] = [
  { package: 'react-native-reanimated', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: 'react-native-screens', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: 'react-native-gesture-handler', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: 'react-native-safe-area-context', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: '@react-navigation/native', support: 'supported', notes: 'Pure JS, no native code' },
  { package: 'react-native-svg', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: '@react-native-async-storage/async-storage', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: 'react-native-webview', support: 'supported', notes: 'Bundled in Expo Go' },
  { package: 'react-native-maps', support: 'supported', notes: 'Bundled in Expo Go' },

  { package: 'react-native-vision-camera', support: 'unsupported', reason: 'Requires custom native code not included in Expo Go' },
  { package: 'react-native-ble-plx', support: 'unsupported', reason: 'Bluetooth native module not included in Expo Go' },
  { package: 'react-native-vector-icons', support: 'unsupported', reason: 'Native font linking not supported in Expo Go — use @expo/vector-icons instead' },
  { package: '@react-native-firebase/app', support: 'unsupported', reason: 'Requires native Firebase SDK linking not available in Expo Go' },
  { package: 'react-native-mmkv', support: 'unsupported', reason: 'JSI native module not included in Expo Go' },
  { package: 'react-native-worklets-core', support: 'unsupported', reason: 'Native JSI module not included in Expo Go' },
  { package: 'react-native-ble-manager', support: 'unsupported', reason: 'Bluetooth native module not included in Expo Go' },
];

export function getExpoGoInfo(packageName: string): ExpoGoPackageInfo | undefined {
  return expoGoPackages.find((entry) => entry.package === packageName);
}
