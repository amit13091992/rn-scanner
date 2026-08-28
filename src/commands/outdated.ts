import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
} from '../utils/terminal.js';

export interface OutdatedOptions {
  cwd?: string;
  json?: boolean;
  majorOnly?: boolean;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  type: 'major' | 'minor' | 'patch';
}

function getVersionParts(version: string): { major: number; minor: number; patch: number } {
  const clean = version.replace(/^[^0-9]/, '').split('-')[0];
  const parts = clean.split('.');
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,
  };
}

function compareVersions(current: string, latest: string): 'major' | 'minor' | 'patch' | null {
  const curr = getVersionParts(current);
  const latest_v = getVersionParts(latest);

  if (latest_v.major > curr.major) return 'major';
  if (latest_v.minor > curr.minor) return 'minor';
  if (latest_v.patch > curr.patch) return 'patch';

  return null;
}

export async function outdatedCommand(options: OutdatedOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();

  try {
    printHeader('RN Deps Scanner - Outdated Check');

    const packageJson = readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);

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

    if (outdated.length === 0) {
      printSection('Status');
      printSuccess('All dependencies are up to date');
      return;
    }

    const major = outdated.filter(p => p.type === 'major');
    const minor = outdated.filter(p => p.type === 'minor');
    const patch = outdated.filter(p => p.type === 'patch');

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

    if (options.json) {
      const result = {
        summary: {
          total: outdated.length,
          major: major.length,
          minor: minor.length,
          patch: patch.length,
        },
        packages: outdated,
      };
      console.log('\n' + JSON.stringify(result, null, 2));
    }
  } catch (error) {
    printError(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
