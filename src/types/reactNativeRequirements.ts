export interface AndroidNativeRequirements {
  jdk: string;
  kotlin: string;
  agp: string;
  gradle: string;
  compileSdk: string;
  targetSdk: string;
  minSdk: string;
  ndk: string;
  buildToolsVersion: string;
}

export interface IosNativeRequirements {
  xcode: string;
  deploymentTarget: string;
  cocoapods: string;
  ruby: string;
  swift: string;
}

export interface ReactNativeNativeRequirements {
  /** Minor version this baseline applies to, e.g. "0.75" */
  version: string;
  /** Minimum Node.js version required to build/run this React Native version, e.g. "18.18.0" */
  node: string;
  android: AndroidNativeRequirements;
  ios: IosNativeRequirements;
}
