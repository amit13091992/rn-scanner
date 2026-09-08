import { coerce, gte } from 'semver';
import type { HermesAnalysisResult, HermesInfo, HermesStatus } from '../types/hermes.js';

export function analyzeHermes(hermesInfo: HermesInfo): HermesAnalysisResult {
  const messages: string[] = [];

  let status: HermesStatus;
  if (hermesInfo.enabled === true) {
    status = 'enabled';
  } else if (hermesInfo.enabled === false) {
    status = 'disabled';
  } else {
    status = 'unknown';
  }

  if (hermesInfo.enabled === false) {
    const coerced = hermesInfo.reactNativeVersion ? coerce(hermesInfo.reactNativeVersion) : null;
    if (coerced && gte(coerced.version, '0.70.0')) {
      messages.push(
        'Hermes is explicitly disabled — this is unusual for RN >=0.70 and will use JSC instead, which has slower startup and higher memory use'
      );
    }
  }

  return {
    status,
    detectedFrom: hermesInfo.detectedFrom,
    messages,
  };
}
