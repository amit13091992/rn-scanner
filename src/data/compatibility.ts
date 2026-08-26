import type { CompatibilityRule } from '../types/dependency.js';

export const compatibilityRules: CompatibilityRule[] = [
  // react-native-reanimated
  {
    package: 'react-native-reanimated',
    version: '4.x',
    reactNative: '>=0.78',
    react: '>=18.0.0',
  },
  {
    package: 'react-native-reanimated',
    version: '3.x',
    reactNative: '>=0.72 <0.80',
    react: '>=18.0.0',
  },

  // react-native-screens
  {
    package: 'react-native-screens',
    version: '4.x',
    reactNative: '>=0.72',
    react: '>=18.0.0',
  },
  {
    package: 'react-native-screens',
    version: '3.x',
    reactNative: '>=0.64.0',
    react: '>=16.8.0',
  },

  // react-native-gesture-handler
  {
    package: 'react-native-gesture-handler',
    version: '2.x',
    reactNative: '>=0.60.0',
    react: '>=16.8.0',
  },

  // react-native-safe-area-context
  {
    package: 'react-native-safe-area-context',
    version: '4.x',
    reactNative: '>=0.64.0',
    react: '>=16.3.0',
  },

  // react-native-vector-icons
  {
    package: 'react-native-vector-icons',
    version: '10.x',
    reactNative: '>=0.60.0',
    react: '>=16.8.0',
  },

  // react-navigation
  {
    package: '@react-navigation/native',
    version: '6.x',
    reactNative: '>=0.63.0',
    react: '>=16.8.0',
  },
  {
    package: '@react-navigation/native',
    version: '7.x',
    reactNative: '>=0.72.0',
    react: '>=18.0.0',
  },

  // react-native-async-storage
  {
    package: '@react-native-async-storage/async-storage',
    version: '1.x',
    reactNative: '>=0.60.0',
    react: '>=16.8.0',
  },

  // react-native-vision-camera
  {
    package: 'react-native-vision-camera',
    version: '4.x',
    reactNative: '>=0.70.0',
    react: '>=18.0.0',
  },
  {
    package: 'react-native-vision-camera',
    version: '3.x',
    reactNative: '>=0.64.0',
    react: '>=16.8.0',
  },

  // react-native-worklets
  {
    package: 'react-native-worklets-core',
    version: '0.x',
    reactNative: '>=0.76.0',
  },
];

export function getCompatibilityRules(packageName: string): CompatibilityRule[] {
  return compatibilityRules.filter((rule) => rule.package === packageName);
}
