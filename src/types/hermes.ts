export type HermesSource =
  | 'android-gradle-properties'
  | 'android-build-gradle'
  | 'ios-podfile'
  | 'expo-config'
  | 'default'
  | 'unknown';

export interface HermesInfo {
  enabled: boolean | null; // null = could not determine
  detectedFrom: HermesSource;
  reactNativeVersion: string | null;
}

export type HermesStatus = 'enabled' | 'disabled' | 'unknown';

export interface HermesAnalysisResult {
  status: HermesStatus;
  detectedFrom: HermesSource;
  messages: string[];
}
