import { getKnownReactNativeVersions } from '../data/reactNative/index.js';

function parseMinor(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function compareMinor(a: { major: number; minor: number }, b: { major: number; minor: number }): number {
  return a.major - b.major || a.minor - b.minor;
}

/**
 * Plans an incremental upgrade path from `fromVersion` to `toVersion`, landing each hop on a
 * minor version this project's registry actually has a baseline for — jumping several RN
 * minors in one go compounds breaking-change risk non-linearly, so a step-by-step path is
 * often lower-risk overall even though it's more commits. Returns just `[toVersion]` (a single
 * direct hop) when either version can't be parsed, there's no known minor strictly between
 * them, or `fromVersion` is already at or past `toVersion` — a path only adds value when there
 * are real intermediate versions to route through.
 */
export function planUpgradePath(fromVersion: string | null | undefined, toVersion: string): string[] {
  if (!fromVersion) return [toVersion];

  const from = parseMinor(fromVersion);
  const to = parseMinor(toVersion);
  if (!from || !to || compareMinor(from, to) >= 0) return [toVersion];

  const known = getKnownReactNativeVersions()
    .map((v) => ({ raw: v, parsed: parseMinor(v) }))
    .filter((v): v is { raw: string; parsed: { major: number; minor: number } } => v.parsed !== null)
    .filter((v) => compareMinor(v.parsed, from) > 0 && compareMinor(v.parsed, to) < 0)
    .sort((a, b) => compareMinor(a.parsed, b.parsed))
    .map((v) => v.raw);

  return [...known, toVersion];
}
