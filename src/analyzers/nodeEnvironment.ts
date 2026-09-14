import { detectNodeVersion } from '../detectors/node.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';

function compareVersionStrings(a: string, b: string): number {
  const aParts = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Analyzes the Node.js version running this process against the baseline React Native
 * `rnVersion` expects. Returns a single-element array to match the shape of
 * analyzeAndroidEnvironment/analyzeIosEnvironment for uniform handling in doctor/upgrade.
 */
export function analyzeNodeEnvironment(rnVersion: string): EnvironmentRequirement[] {
  const requirements = getReactNativeRequirements(rnVersion);
  const node = detectNodeVersion();

  if (!node.version) {
    return [
      {
        name: 'Node.js',
        status: 'unknown',
        reason: 'Could not detect the running Node.js version.',
      },
    ];
  }

  if (!requirements?.node) {
    return [
      {
        name: 'Node.js',
        current: node.version,
        source: node.source,
        status: 'unknown',
        reason: 'No baseline Node.js requirement known for this React Native version.',
      },
    ];
  }

  const meetsRequirement = compareVersionStrings(node.version, requirements.node) >= 0;
  return [
    {
      name: 'Node.js',
      current: node.version,
      required: requirements.node,
      source: node.source,
      status: meetsRequirement ? 'ok' : 'error',
      reason: meetsRequirement
        ? undefined
        : `Node ${node.version} is older than the ${requirements.node} React Native ${rnVersion} requires.`,
    },
  ];
}
