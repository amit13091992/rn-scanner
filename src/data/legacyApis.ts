export interface LegacyApiEntry {
  /** The named export as it used to be imported from `fromPackage` (e.g. "WebView"). */
  symbol: string;
  /** The package this symbol used to be exported from. */
  fromPackage: string;
  reason: string;
  /** Package name or short instruction for what to use instead. */
  replacement: string;
  /** React Native version this was removed in, when known — informational, not used to gate detection. */
  removedInVersion?: string;
  /** Regex source matched against file content instead of the named-import form — for deep
   *  imports, style keys and JSX props, where there is no named export to destructure. */
  matchPattern?: string;
}

/**
 * Core React Native APIs that were removed from the `react-native` package itself and split
 * out into community packages, plus a couple of long-dead React APIs that occasionally still
 * turn up in older codebases. Same curated, hand-maintained shape as `data/deprecatedPackages.ts`
 * — expect to extend this list as real-world cases are reported, not treat it as exhaustive.
 * Scoped to APIs detectable via a static import/require of a named export — this doesn't cover
 * every deprecated *prop* or *method* on an API that's otherwise still present (e.g. a specific
 * deprecated prop on a component that itself still exists), which would need real usage
 * analysis, not just an import check.
 */
export const LEGACY_APIS: LegacyApiEntry[] = [
  {
    symbol: 'WebView',
    fromPackage: 'react-native',
    reason: 'WebView was removed from react-native core',
    replacement: 'react-native-webview',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'AsyncStorage',
    fromPackage: 'react-native',
    reason: 'AsyncStorage was removed from react-native core',
    replacement: '@react-native-async-storage/async-storage',
    removedInVersion: '0.59.0',
  },
  {
    symbol: 'Clipboard',
    fromPackage: 'react-native',
    reason: 'Clipboard was removed from react-native core',
    replacement: '@react-native-clipboard/clipboard',
    removedInVersion: '0.65.0',
  },
  {
    symbol: 'NetInfo',
    fromPackage: 'react-native',
    reason: 'NetInfo was removed from react-native core',
    replacement: '@react-native-community/netinfo',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'CameraRoll',
    fromPackage: 'react-native',
    reason: 'CameraRoll was removed from react-native core',
    replacement: '@react-native-camera-roll/camera-roll',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'Slider',
    fromPackage: 'react-native',
    reason: 'Slider was removed from react-native core',
    replacement: '@react-native-community/slider',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'ProgressBarAndroid',
    fromPackage: 'react-native',
    reason: 'ProgressBarAndroid was removed from react-native core',
    replacement: '@react-native-community/progress-bar-android',
    removedInVersion: '0.62.0',
  },
  {
    symbol: 'ProgressViewIOS',
    fromPackage: 'react-native',
    reason: 'ProgressViewIOS was removed from react-native core',
    replacement: '@react-native-community/progress-view',
    removedInVersion: '0.62.0',
  },
  {
    symbol: 'DatePickerIOS',
    fromPackage: 'react-native',
    reason: 'DatePickerIOS was removed from react-native core',
    replacement: '@react-native-community/datetimepicker',
    removedInVersion: '0.62.0',
  },
  {
    symbol: 'TimePickerAndroid',
    fromPackage: 'react-native',
    reason: 'TimePickerAndroid was removed from react-native core',
    replacement: '@react-native-community/datetimepicker',
    removedInVersion: '0.62.0',
  },
  {
    symbol: 'MaskedViewIOS',
    fromPackage: 'react-native',
    reason: 'MaskedViewIOS was removed from react-native core',
    replacement: '@react-native-masked-view/masked-view',
    removedInVersion: '0.62.0',
  },
  {
    symbol: 'ViewPagerAndroid',
    fromPackage: 'react-native',
    reason: 'ViewPagerAndroid was removed from react-native core',
    replacement: 'react-native-pager-view',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'ListView',
    fromPackage: 'react-native',
    reason: 'ListView was removed from react-native core — it was already deprecated in favor of FlatList/SectionList for years before removal',
    replacement: 'FlatList or SectionList',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'ImageStore',
    fromPackage: 'react-native',
    reason: 'ImageStore was removed from react-native core',
    replacement: 'Image.getSize or a caching library',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'ImageEditor',
    fromPackage: 'react-native',
    reason: 'ImageEditor was removed from react-native core',
    replacement: '@react-native-community/image-editor',
    removedInVersion: '0.60.0',
  },
  {
    symbol: 'PropTypes',
    fromPackage: 'react-native',
    reason: 'PropTypes was never a real react-native export — this only worked by accident via a transitive re-export that no longer exists',
    replacement: "the 'prop-types' package directly, or TypeScript types",
  },
  {
    symbol: 'InteractionManager',
    fromPackage: 'react-native',
    reason: 'InteractionManager was removed from react-native in 0.87',
    replacement: 'requestIdleCallback',
    removedInVersion: '0.87.0',
  },
  {
    symbol: 'Touchable',
    fromPackage: 'react-native',
    reason: 'The undocumented Touchable root export was removed in 0.87',
    replacement: 'ViewProps (as a type), or Pressable',
    removedInVersion: '0.87.0',
  },
  {
    symbol: 'InputAccessoryView',
    fromPackage: 'react-native',
    reason: 'InputAccessoryView (iOS-only) is deprecated in 0.88',
    replacement: 'react-native-keyboard-controller (KeyboardStickyView)',
    removedInVersion: '0.88.0',
  },
  {
    symbol: 'ImageBackground',
    fromPackage: 'react-native',
    reason: 'ImageBackground is deprecated as of 0.87',
    replacement: 'View with an absolutely positioned Image',
  },
  {
    symbol: 'react-native/Libraries/Core/InitializeCore',
    fromPackage: 'react-native',
    reason: 'InitializeCore deep import is deprecated in 0.88',
    replacement: "react-native/setup-env",
    removedInVersion: '0.88.0',
    matchPattern: "['\"]react-native/Libraries/Core/InitializeCore['\"]",
  },
  {
    symbol: 'react-native/Libraries/*',
    fromPackage: 'react-native',
    reason: 'Deep imports from react-native/Libraries are type errors under the strict TypeScript API (default since 0.87)',
    replacement: "the public 'react-native' export",
    removedInVersion: '0.87.0',
    matchPattern: "(?:from|require\\(|import\\()\\s*['\"]react-native/Libraries/",
  },
  {
    symbol: 'experimental_background*',
    fromPackage: 'react-native',
    reason: 'experimental_backgroundSize/Position/Repeat are deprecated aliases as of 0.88',
    replacement: 'backgroundSize / backgroundPosition / backgroundRepeat',
    removedInVersion: '0.88.0',
    matchPattern: '\\bexperimental_background(?:Size|Position|Repeat)\\b',
  },
  {
    symbol: 'Modal animated prop',
    fromPackage: 'react-native',
    reason: "The deprecated Modal 'animated' prop was removed in 0.87 (heuristic JSX match — confirm the Modal is react-native's)",
    replacement: "animationType",
    removedInVersion: '0.87.0',
    matchPattern: '<Modal\\b[^>]*\\banimated\\b',
  },
];
