import { coerce, gt } from 'semver';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { fetchLatestVersions } from '../utils/npmRegistry.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
} from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface OutdatedOptions {
  cwd?: string;
  json?: boolean;
  html?: HtmlOption;
  majorOnly?: boolean;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  type: 'major' | 'minor' | 'patch';
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

    if (jsonMode) {
      const result = {
        summary: {
          total: outdated.length,
          major: major.length,
          minor: minor.length,
          patch: patch.length,
        },
        packages: outdated,
      };
      emitStructuredOutput(result, 'Outdated Dependencies', options);
      return;
    }

    if (outdated.length === 0) {
      printSection('Status');
      printSuccess('All dependencies are up to date');
      return;
    }

    printSection('Available Updates');

    if (major.length > 0) {
      printError(`🔴 Major Updates (${major.length}) - May include breaking changes`);
      major.forEach(pkg => {
        console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest}`);
      });
    }

    if (minor.length > 0 && !options.majorOnly) {
      printWarning(`🟡 Minor Updates (${minor.length}) - New features, backward compatible`);
      minor.forEach(pkg => {
        console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest}`);
      });
    }

    if (patch.length > 0 && !options.majorOnly) {
      printSuccess(`🟢 Patch Updates (${patch.length}) - Bug fixes only`);
      patch.forEach(pkg => {
        console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest}`);
      });
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
