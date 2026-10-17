import { detectNodeVersion } from '../detectors/node.js';
import { getReactNativeRequirements } from '../data/reactNative/index.js';
import { coerce, gte } from 'semver';
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
  const rn = coerce(rnVersion);
  const nodeSemver = coerce(node.version);
  // RN 0.88's engines field is ^22.13 || ^24.3 || >=26: odd-numbered majors and 24.0-24.2 are
  // outside it even though they numerically exceed the 22.13 baseline.
  if (meetsRequirement && rn && gte(rn, '0.88.0') && nodeSemver) {
    const unsupportedLine =
      (nodeSemver.major % 2 === 1 && nodeSemver.major < 26) ||
      (nodeSemver.major === 24 && !gte(nodeSemver, '24.3.0'));
    if (unsupportedLine) {
      return [
        {
          name: 'Node.js',
          current: node.version,
          required: requirements.node,
          recommended: '22.13+, 24.3+ or 26+',
          source: node.source,
          status: 'warning',
          reason: `Node ${node.version} is outside React Native ${rnVersion}'s supported engines range (^22.13 || ^24.3 || >=26); odd-numbered and pre-24.3 releases are unsupported.`,
        },
      ];
    }
  }
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
