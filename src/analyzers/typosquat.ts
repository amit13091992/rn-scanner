import { POPULAR_PACKAGES } from '../data/popularPackages.js';

export type LookalikeReason = 'separator_variant' | 'near_miss';

export interface Lookalike {
  /** The well-known package this name resembles. */
  resembles: string;
  reason: LookalikeReason;
}

// Below this a single edit is a different short word, not a typo (`ms` vs `mz`, `ky` vs `kx`).
const MIN_POPULAR_LENGTH_FOR_EDITS = 6;
// Longer names tolerate two edits; shorter ones one.
const TWO_EDIT_MIN_LENGTH = 14;

/**
 * Optimal-string-alignment distance: insertions, deletions, substitutions, and a swap of two
 * adjacent characters (the most common keyboard typo) each cost 1.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

function squash(name: string): string {
  return name.replace(/[-_.]/g, '');
}

/**
 * Well-known packages this name could be impersonating: a separator variant (`reactnative`,
 * `react_native`, `react.native`) or a name within one or two edits (`react-natve`,
 * `reakt-native`). Pure string comparison against `data/popularPackages.ts` — it says "this
 * looks like X", never "this is malicious"; a legitimate package can sit close to a popular one,
 * so callers weigh it against real usage. An exact match to a popular package is the real thing
 * and returns nothing.
 */
export function findLookalikes(name: string, popular: readonly string[] = POPULAR_PACKAGES): Lookalike[] {
  const candidate = name.toLowerCase();
  if (popular.includes(candidate)) return [];

  const matches: Lookalike[] = [];
  for (const known of popular) {
    if (squash(known) === squash(candidate)) {
      matches.push({ resembles: known, reason: 'separator_variant' });
      continue;
    }
    if (known.length < MIN_POPULAR_LENGTH_FOR_EDITS) continue;
    const allowed = known.length >= TWO_EDIT_MIN_LENGTH ? 2 : 1;
    if (Math.abs(known.length - candidate.length) > allowed) continue;
    if (editDistance(candidate, known) <= allowed) {
      matches.push({ resembles: known, reason: 'near_miss' });
    }
  }
  return matches;
}
