export interface DeprecatedPackage {
  name: string;
  reason: string;
  replacement?: string;
  deprecatedSince?: string;
}

export const deprecatedPackages: DeprecatedPackage[] = [
  {
    name: 'react-native-gesture-handler-old',
    reason: 'Replaced by react-native-gesture-handler v2+',
    replacement: 'react-native-gesture-handler',
  },
  {
    name: 'react-native-vector-icons-old',
    reason: 'Superseded by newer icon libraries',
    replacement: 'react-native-vector-icons v10+',
  },
  {
    name: 'react-native-maps-old',
    reason: 'Outdated fork, use official react-native-maps',
    replacement: 'react-native-maps',
  },
  {
    name: 'react-navigation-deprecated',
    reason: 'Replaced by @react-navigation packages',
    replacement: '@react-navigation/native',
  },
  {
    name: 'react-native-cli',
    reason: 'Replaced by global React Native CLI',
    replacement: 'Use: npx react-native',
  },
  {
    name: 'react-native-firebase-old',
    reason: 'Use newer version of react-native-firebase',
    replacement: 'react-native-firebase v14+',
  },
  {
    name: 'react-redux-old',
    reason: 'Use modern react-redux with hooks support',
    replacement: 'react-redux v7.2+',
  },
  {
    name: 'redux-promise',
    reason: 'Deprecated middleware, use redux-thunk or redux-saga',
    replacement: 'redux-thunk or redux-saga',
  },
  {
    name: 'react-native-uuid',
    reason: 'Use cross-platform uuid library',
    replacement: 'uuid or nanoid',
  },
  {
    name: 'react-native-nav',
    reason: 'Replaced by react-navigation',
    replacement: '@react-navigation/native',
  },
];

export function isDeprecated(packageName: string): DeprecatedPackage | undefined {
  return deprecatedPackages.find(
    pkg => pkg.name === packageName || pkg.name === packageName.toLowerCase()
  );
}

export function checkDeprecatedPackages(
  packageNames: string[]
): Array<{ name: string; info: DeprecatedPackage }> {
  return packageNames
    .map(name => {
      const info = isDeprecated(name);
      return info ? { name, info } : null;
    })
    .filter((x): x is { name: string; info: DeprecatedPackage } => x !== null);
}
