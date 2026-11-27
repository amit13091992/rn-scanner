import { coerce, lt } from 'semver';
import { detectAgpVersion } from '../detectors/android/agp.js';
import { detectNdkVersion } from '../detectors/android/ndk.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Google Play stops accepting app updates without 16KB page-size support on this date
 * (https://developer.android.com/16kb-page-size). Sourced from Google's docs as of 2026-11-27;
 * re-check there if the date matters to a decision.
 */
export const PLAY_16KB_DEADLINE = '2027-02-01';

const MIN_AGP = '8.5.1';
const MIN_NDK_MAJOR = 27;
const MS_PER_DAY = 86_400_000;

export interface PageSizeDeadline {
  deadline: string;
  daysRemaining: number;
  passed: boolean;
}

export function describePageSizeDeadline(now: Date = new Date()): PageSizeDeadline {
  const daysRemaining = Math.ceil((Date.parse(`${PLAY_16KB_DEADLINE}T00:00:00Z`) - now.getTime()) / MS_PER_DAY);
  return { deadline: PLAY_16KB_DEADLINE, daysRemaining, passed: daysRemaining <= 0 };
}

export function formatPageSizeDeadline(deadline: PageSizeDeadline): string {
  return deadline.passed
    ? `Google Play's 16KB page-size requirement took effect on ${deadline.deadline}: updates without 16KB support are rejected`
    : `Google Play rejects app updates without 16KB page-size support from ${deadline.deadline} (${deadline.daysRemaining} day${deadline.daysRemaining === 1 ? '' : 's'} left)`;
}

/**
 * Build-toolchain prerequisites for producing 16KB-aligned native code from source — the part
 * `analyzePageSize` can't see, since it only inspects prebuilt `.so` files already on disk. A
 * version that can't be detected is omitted rather than reported (ADR-0004: no guessed
 * verdict); `android/` absent means there's no build config to read at all.
 */
export function analyzePageSizeBuildConfig(cwd: string): EnvironmentRequirement[] {
  if (!existsSync(join(cwd, 'android'))) return [];

  const results: EnvironmentRequirement[] = [];

  const agp = detectAgpVersion(cwd);
  const agpVersion = agp.version ? coerce(agp.version) : null;
  if (agp.version && agpVersion) {
    const tooOld = lt(agpVersion, MIN_AGP);
    results.push({
      name: '16KB page-size: Android Gradle Plugin',
      current: agp.version,
      required: `>= ${MIN_AGP}`,
      status: tooOld ? 'warning' : 'ok',
      source: agp.source,
      reason: tooOld ? 'Google recommends AGP 8.5.1+ to package native libraries for 16KB page sizes' : undefined,
    });
  }

  const ndk = detectNdkVersion(cwd);
  const ndkMajor = ndk.version ? Number(ndk.version.split('.')[0]) : NaN;
  if (ndk.version && Number.isFinite(ndkMajor)) {
    const tooOld = ndkMajor < MIN_NDK_MAJOR;
    results.push({
      name: '16KB page-size: Android NDK',
      current: ndk.version,
      required: `r${MIN_NDK_MAJOR}+`,
      status: tooOld ? 'warning' : 'ok',
      source: ndk.source,
      reason: tooOld
        ? 'NDK r26 and lower need the linker flag -Wl,-z,max-page-size=16384 on every native target; r27+ use the flexible-page-size option instead'
        : undefined,
    });
  }

  return results;
}
