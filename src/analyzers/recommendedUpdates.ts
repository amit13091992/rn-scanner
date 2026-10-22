import { satisfies, major, rsort, coerce } from 'semver';
import { getCompatibilityRules } from '../data/compatibility.js';
import { fetchAllVersions } from '../utils/npmRegistry.js';
import type { OutdatedPackage } from '../types/outdated.js';
import type { RecommendedUpdate } from '../types/recommendedUpdate.js';

/**
 * Turns a version-line pattern like "4.x"/"3.*" (as used in `data/compatibility.ts`) into a
 * regex the way `analyzers/compatibility.ts` already does, so both stay consistent about what
 * "matches this line" means. Plain semver ranges (no `x`/`*`) are matched via `satisfies`.
 */
function matchesVersionLine(version: string, linePattern: string): boolean {
  if (linePattern.includes('x') || linePattern.includes('*')) {
    const pattern = linePattern.replace(/\*/g, '\\d+').replace(/x/g, '\\d+').replace(/\./g, '\\.');
    return new RegExp(`^${pattern}`).test(version);
  }
  return satisfies(version, linePattern);
}

/**
 * For each outdated package with known compatibility rules, recommends the highest *published*
 * version within the highest major line this project's React Native version actually supports
 * — rather than npm's absolute latest, which may require a newer React Native than this project
 * has. Packages with no compatibility data fall back to the absolute latest (no constraint to
 * check against), consistent with ADR-0004: an unverified recommendation is reported as "no
 * compatibility data", never silently upgraded to "latest is fine".
 */
export async function analyzeRecommendedUpdates(
  outdated: OutdatedPackage[],
  reactNativeVersion: string | null
): Promise<RecommendedUpdate[]> {
  const coercedRn = reactNativeVersion ? coerce(reactNativeVersion) : null;
  const results: RecommendedUpdate[] = [];

  for (const pkg of outdated) {
    const rules = getCompatibilityRules(pkg.name);
    if (rules.length === 0 || !coercedRn) {
      results.push({
        package: pkg.name,
        current: pkg.current,
        latest: pkg.latest,
        recommended: pkg.latest,
        reason: rules.length === 0
          ? 'No compatibility rules defined for this package — recommending the latest published version'
          : 'React Native version not detected — cannot verify compatibility, recommending the latest published version',
      });
      continue;
    }

    const compatibleRules = rules.filter(
      (rule) => !rule.reactNative || satisfies(coercedRn.version, rule.reactNative)
    );

    if (compatibleRules.length === 0) {
      results.push({
        package: pkg.name,
        current: pkg.current,
        latest: pkg.latest,
        recommended: null,
        reason: `No known version of ${pkg.name} declares compatibility with React Native ${reactNativeVersion}`,
      });
      continue;
    }

    const bestRule = compatibleRules.reduce((best, rule) => {
      const ruleMajor = major(coerce(rule.version) ?? '0.0.0');
      const bestMajor = major(coerce(best.version) ?? '0.0.0');
      return ruleMajor > bestMajor ? rule : best;
    });

    const latestMajor = major(coerce(pkg.latest) ?? '0.0.0');
    const bestRuleMajor = major(coerce(bestRule.version) ?? '0.0.0');
    const installedMajor = major(coerce(pkg.current) ?? '0.0.0');

    // The curated rules lag the registry: if the installed version is already past the newest
    // line a rule covers, "the newest rule line" would be a downgrade, not a recommendation.
    if (installedMajor > bestRuleMajor) {
      results.push({
        package: pkg.name,
        current: pkg.current,
        latest: pkg.latest,
        recommended: pkg.latest,
        reason: `Installed ${pkg.current} is already newer than the newest ${bestRule.version} line this tool has compatibility data for — no downgrade suggested`,
      });
      continue;
    }

    if (bestRuleMajor >= latestMajor) {
      results.push({
        package: pkg.name,
        current: pkg.current,
        latest: pkg.latest,
        recommended: pkg.latest,
        reason: `Latest version is within the ${bestRule.version} line, already compatible with React Native ${reactNativeVersion}`,
      });
      continue;
    }

    const allVersions = await fetchAllVersions(pkg.name);
    const matchingVersions = (allVersions ?? []).filter((v) => matchesVersionLine(v, bestRule.version));
    const recommended = matchingVersions.length > 0 ? rsort(matchingVersions)[0] ?? null : null;

    results.push({
      package: pkg.name,
      current: pkg.current,
      latest: pkg.latest,
      recommended,
      reason: recommended
        ? `Latest (${pkg.latest}) requires a newer React Native than ${reactNativeVersion} supports — recommending the newest ${bestRule.version} release instead`
        : `No published version found in the ${bestRule.version} line compatible with React Native ${reactNativeVersion}`,
    });
  }

  return results;
}
