export interface AiSdkDetected {
  packageName: string;
  provider: string;
}

/**
 * Location only — never the matched key text — so a real secret can't end up in `--json`/`--html`
 * output or in captured logs.
 */
export interface AiKeyExposure {
  provider: string;
  label: string;
  file: string;
  line: number;
}

export interface AiSdkExposureResult {
  sdksDetected: AiSdkDetected[];
  directCallWarning: boolean;
  keyExposures: AiKeyExposure[];
  filesScanned: number;
}
