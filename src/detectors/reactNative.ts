import { getSpecificDependency, readPackageJson } from '../utils/packageJson.js';

export interface ReactNativeInfo {
  version: string | null;
  react: string | null;
}

export function detectReactNativeVersions(
  cwd: string = process.cwd()
): ReactNativeInfo {
  try {
    const packageJson = readPackageJson(cwd);

    const reactNativeVersion = getSpecificDependency(
      packageJson,
      'react-native'
    );
    const reactVersion = getSpecificDependency(packageJson, 'react');

    return {
      version: reactNativeVersion || null,
      react: reactVersion || null,
    };
  } catch (error) {
    return {
      version: null,
      react: null,
    };
  }
}

export function cleanVersion(version: string): string {
  return version.replace(/^[\^~>=<]/, '').split(' ')[0];
}
