import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { analyzeImpact } from '../analyzers/impact.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

export interface ImpactOptions {
  json?: boolean;
  cwd?: string;
}

export async function impactCommand(packageName: string, targetVersion: string, options: ImpactOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);
    const result = analyzeImpact(cwd, dependencies, packageName, targetVersion, graph);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader(`Impact of upgrading ${packageName} to ${targetVersion}`);
    if (result.currentVersion) {
      printInfo(`Currently installed: ${result.currentVersion}`);
    } else {
      printInfo(`"${packageName}" is not currently a direct dependency — evaluating as a new install.`);
    }

    if (result.breakingChange.detected && result.breakingChange.issue) {
      printSection('Breaking Changes');
      const issue = result.breakingChange.issue;
      if (issue.stale) {
        printInfo(`${packageName}@${issue.introducedInVersion} introduced changes, but this is likely already part of your current version — informational only.`);
      } else {
        printWarning(`Introduced in ${issue.introducedInVersion} (severity: ${issue.severity}):`);
        issue.changes.forEach((c) => console.log(`  • ${c}`));
        if (issue.migrationGuide) console.log(`  Migration guide: ${issue.migrationGuide}`);
      }
    } else if (result.breakingChange.hasData) {
      printSuccess('No known breaking changes for this version');
    } else {
      printInfo('No breaking-change data available for this package');
    }

    if (result.blockers.length > 0) {
      printSection('Peer/Version Conflicts');
      result.blockers.forEach((b) => {
        console.log(`  • ${b.requiredBy} requires ${packageName}@${b.range}`);
      });
    }

    if (result.reverseDependents.length > 0) {
      printSection('Depended On By');
      result.reverseDependents.forEach((dep) => console.log(`  • ${dep}`));
    }

    printSection('Recommended Actions');
    result.recommendedActions.forEach((a) => console.log(`  • ${a}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
