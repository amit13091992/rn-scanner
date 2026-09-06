import type { NewArchPackageInfo } from '../types/newArchitecture.js';

export const newArchPackages: NewArchPackageInfo[] = [
  { package: 'react-native-reanimated', support: 'supported', minVersion: '3.0.0' },
  { package: 'react-native-screens', support: 'supported', minVersion: '3.18.0' },
  { package: 'react-native-gesture-handler', support: 'supported', minVersion: '2.9.0' },
  { package: 'react-native-safe-area-context', support: 'supported', minVersion: '4.4.0' },
  { package: '@react-navigation/native', support: 'supported', minVersion: '6.0.0' },
  { package: 'react-native-vision-camera', support: 'supported', minVersion: '3.0.0' },
  { package: 'react-native-worklets-core', support: 'supported', minVersion: '0.1.0' },
  { package: '@react-native-async-storage/async-storage', support: 'supported', minVersion: '1.18.0' },
  { package: 'react-native-svg', support: 'supported', minVersion: '13.6.0' },

  { package: '@react-native-community/async-storage', support: 'unsupported', notes: 'Deprecated, replaced by @react-native-async-storage/async-storage' },
  { package: 'react-native-vector-icons', support: 'partial', notes: 'Works but not fully Fabric-optimized in all versions' },
  { package: 'react-native-webview', support: 'supported', minVersion: '13.2.0' },
  { package: 'react-native-maps', support: 'partial', notes: 'New Architecture support varies by platform' },
];

export function getNewArchInfo(packageName: string): NewArchPackageInfo | undefined {
  return newArchPackages.find((entry) => entry.package === packageName);
}
