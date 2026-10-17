import { coerce, gt } from 'semver';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { fetchLatestVersions } from '../utils/npmRegistry.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeRecommendedUpdates } from '../analyzers/recommendedUpdates.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
  printInfo,
} from '../utils/terminal.js';
import { isOffline, networkFailureCount } from '../utils/network.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import type { OutdatedPackage } from '../types/outdated.js';

export interface OutdatedOptions {
  cwd?: string;
  json?: boolean;
  html?: HtmlOption;
  majorOnly?: boolean;
  /** Resolve a React-Native-compatible recommended version per package (an extra npm registry
   *  call per outdated package with compatibility data) — opt-in since it's slower than a
   *  plain outdated check. */
  recommend?: boolean;
}

function compareVersions(current: string, latest: string): 'major' | 'minor' | 'patch' | null {
  const curr = coerce(current);
  const latestVersion = coerce(latest);
  if (!curr || !latestVersion || !gt(latestVersion, curr)) return null;

  if (latestVersion.major !== curr.major) return 'major';
  if (latestVersion.minor !== curr.minor) return 'minor';
  return 'patch';
}

export async function outdatedCommand(options: OutdatedOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    if (!jsonMode) {
      printHeader('RN Deps Scanner - Outdated Check');
    }

    const packageJson = readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const latestVersions = await fetchLatestVersions(dependencies.map(d => d.name));
    dependencies.forEach(dep => {
      dep.latestVersion = latestVersions.get(dep.name);
    });

    const lookupsMissing = dependencies.filter((d) => !d.latestVersion).length;
    const outdated: OutdatedPackage[] = [];

    dependencies.forEach(dep => {
      if (!dep.latestVersion || dep.latestVersion === dep.resolvedVersion || dep.latestVersion === dep.requestedVersion) {
        return;
      }

      const updateType = compareVersions(dep.resolvedVersion || dep.requestedVersion, dep.latestVersion);
      if (updateType) {
        outdated.push({
          name: dep.name,
          current: dep.resolvedVersion || dep.requestedVersion,
          latest: dep.latestVersion,
          type: updateType,
        });
      }
    });

    const major = outdated.filter(p => p.type === 'major');
    const minor = outdated.filter(p => p.type === 'minor');
    const patch = outdated.filter(p => p.type === 'patch');

    const recommendations = options.recommend
      ? await (async () => {
          const rnInfo = await detectReactNativeVersions(cwd);
          return analyzeRecommendedUpdates(outdated, rnInfo.version);
        })()
      : null;
    const recommendationByPackage = new Map((recommendations ?? []).map((r) => [r.package, r]));

    if (jsonMode) {
      const result = {
        summary: {
          total: outdated.length,
          major: major.length,
          minor: minor.length,
          patch: patch.length,
          registryLookupsMissing: lookupsMissing,
        },
        packages: outdated,
        ...(recommendations ? { recommendations } : {}),
      };
      emitStructuredOutput(result, 'Outdated Dependencies', options);
      return;
    }

    if (lookupsMissing > 0) {
      printWarning(
        isOffline()
          ? 'Offline mode: no registry lookups were made, so no updates can be reported.'
          : `${lookupsMissing} of ${dependencies.length} registry lookup(s) failed or timed out (${networkFailureCount()} request failure(s)) — results may be incomplete. Retry, or raise --timeout <ms>.`
      );
    }

    if (outdated.length === 0 && lookupsMissing === dependencies.length) {
      return;
    }

    if (outdated.length === 0) {
      printSection('Status');
      printSuccess('All dependencies are up to date');
      return;
    }

    printSection('Available Updates');

    function printPkgLine(pkg: OutdatedPackage): void {
      console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest}`);
      const rec = recommendationByPackage.get(pkg.name);
      if (rec && rec.recommended !== pkg.latest) {
        if (rec.recommended) {
          console.log(`    └─ Recommended: ${rec.recommended} (${rec.reason})`);
        } else {
          console.log(`    └─ ${rec.reason}`);
        }
      }
    }

    if (major.length > 0) {
      printError(`🔴 Major Updates (${major.length}) - May include breaking changes`);
      major.forEach(printPkgLine);
    }

    if (minor.length > 0 && !options.majorOnly) {
      printWarning(`🟡 Minor Updates (${minor.length}) - New features, backward compatible`);
      minor.forEach(printPkgLine);
    }

    if (patch.length > 0 && !options.majorOnly) {
      printSuccess(`🟢 Patch Updates (${patch.length}) - Bug fixes only`);
      patch.forEach(printPkgLine);
    }
    if (options.recommend) {
      printInfo('Recommendations check each package\'s known React Native compatibility (data/compatibility.ts) — packages with no compatibility data default to the latest published version.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Error: ${message}` }, 'Outdated Dependencies', options);
    } else {
      printError(`Error: ${message}`);
    }
    process.exit(1);
  }
}
