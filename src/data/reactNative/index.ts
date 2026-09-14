import type { ReactNativeNativeRequirements } from '../../types/reactNativeRequirements.js';
import { REACT_NATIVE_REQUIREMENTS_REGISTRY as REGISTRY } from './registry.js';

function parseMinor(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Resolves the closest matching native-requirements baseline for a given React Native version
 * string (e.g. "0.75.3" or "^0.74.0"). Matches by minor version — an exact patch match is not
 * required. Returns `undefined` if the version can't be parsed or falls outside the registry's
 * known range (in which case the caller should fall back to the nearest known version, e.g. the
 * newest entry for versions newer than anything in the registry).
 */
export function getReactNativeRequirements(version: string): ReactNativeNativeRequirements | undefined {
  const parsed = parseMinor(version);
  if (!parsed) return undefined;

  const exact = REGISTRY.find((entry) => {
    const entryParsed = parseMinor(entry.version);
    return entryParsed && entryParsed.major === parsed.major && entryParsed.minor === parsed.minor;
  });
  if (exact) return exact;

  // Fall back to the closest known version by minor-version distance (same major only),
  // clamping to the nearest edge of the registry for versions outside its known range.
  const sameMajor = REGISTRY.filter((entry) => {
    const entryParsed = parseMinor(entry.version);
    return entryParsed && entryParsed.major === parsed.major;
  });
  if (sameMajor.length === 0) return undefined;

  let closest = sameMajor[0]!;
  let closestDistance = Math.abs((parseMinor(closest.version)?.minor ?? 0) - parsed.minor);
  for (const entry of sameMajor) {
    const entryMinor = parseMinor(entry.version)?.minor ?? 0;
    const distance = Math.abs(entryMinor - parsed.minor);
    if (distance < closestDistance) {
      closest = entry;
      closestDistance = distance;
    }
  }
  return closest;
}
