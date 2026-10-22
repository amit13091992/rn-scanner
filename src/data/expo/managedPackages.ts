/**
 * Packages whose versions an Expo SDK pins (`npx expo install` resolves them to the SDK's
 * bundled-native-modules versions). Bumping these by hand — as a plain "outdated" suggestion
 * would — typically breaks the SDK's native build, so they are reported as SDK-managed instead.
 * Hand-maintained like the other `data/expo/*` files: `expo-*` packages are matched by prefix,
 * the rest by name.
 */
const EXPO_BUNDLED_PACKAGES = new Set([
  'react',
  'react-dom',
  'react-native',
  'react-native-web',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
  'react-native-gesture-handler',
  'react-native-pager-view',
  'react-native-webview',
  'react-native-maps',
  '@react-native-async-storage/async-storage',
  '@react-native-community/datetimepicker',
  '@react-native-community/slider',
  '@react-native-picker/picker',
  '@shopify/react-native-skia',
  'lottie-react-native',
]);

export function isExpoManagedPackage(name: string): boolean {
  return name === 'expo' || name.startsWith('expo-') || name.startsWith('@expo/') || EXPO_BUNDLED_PACKAGES.has(name);
}
