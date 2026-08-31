import chalk from 'chalk';
import { getAllDependenciesWithResolution, readPackageJson } from '../utils/packageJson.js';
import { detectPackageManager } from '../utils/lockfile.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeAllDependencies } from '../analyzers/compatibility.js';
import { analyzeBreakingChanges } from '../analyzers/breakingChanges.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printVersionComparison,
  printHealthScore,
  type HealthScoreBreakdown,
} from '../utils/terminal.js';
import {
  detectVersionMismatches,
  detectDuplicateDependencies,
  detectPeerDependencyConflicts,
  isReactNativeCompatible,
} from '../utils/versionDetection.js';
import { checkDeprecatedPackages } from '../data/deprecatedPackages.js';

export interface CheckOptions {
  json?: boolean;
  strict?: boolean;
  cwd?: string;
}

export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();

  try {
    printHeader('RN Deps Scanner');

    const packageJson = readPackageJson(cwd);
    const lockfileInfo = detectPackageManager(cwd);
    const rnInfo = detectReactNativeVersions(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);

    printSection('Environment');
    if (rnInfo.version) {
      printSuccess(`React Native: ${rnInfo.version}`);
    } else {
      printWarning('React Native: not found');
    }
    if (rnInfo.react) {
      printSuccess(`React: ${rnInfo.react}`);
    } else {
      printWarning('React: not found');
    }
    printInfo(`Package Manager: ${lockfileInfo.manager}`);

    const rnCompatCheck = rnInfo.version && rnInfo.react
      ? isReactNativeCompatible(rnInfo.version, rnInfo.react)
      : null;
    if (rnCompatCheck && !rnCompatCheck.compatible) {
      printWarning(`React ↔ React Native: ${rnCompatCheck.issue}`);
    }

    printSection('Analyzing Dependencies');
    const compatibilityResults = analyzeAllDependencies(
      dependencies,
      rnInfo.version,
      rnInfo.react
    );
    const breakingChangesResults = analyzeBreakingChanges(dependencies);

    const compatible = compatibilityResults.filter((i) => i.status === 'compatible').length;
    const notChecked = compatibilityResults.filter((i) => i.status === 'not-checked').length;
    const warnings = compatibilityResults.filter((i) => i.status === 'warning').length;
    const errors = compatibilityResults.filter((i) => i.status === 'error').length;

    const versionMismatches = detectVersionMismatches(dependencies);
    const duplicates = detectDuplicateDependencies(dependencies);
    const peerConflicts = detectPeerDependencyConflicts(dependencies);
    const deprecatedPkgs = checkDeprecatedPackages(
      dependencies.map(d => d.name)
    );

    if (versionMismatches.length > 0) {
      printSection('Version Mismatches');
      versionMismatches.forEach(mismatch => {
        printWarning(mismatch.package);
        console.log(`  ├─ Declared: ${mismatch.declared}`);
        console.log(`  ├─ Installed: ${mismatch.installed}`);
        if (mismatch.latest) {
          console.log(`  └─ Latest: ${mismatch.latest}`);
        }
      });
    }

    if (duplicates.length > 0) {
      printSection('Duplicate Dependencies');
      duplicates.forEach(dup => {
        const icon = dup.severity === 'critical' ? '🔴 CRITICAL' : dup.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
        console.log(`\n${icon}  ${dup.package}`);
        console.log(`  └─ Versions: ${dup.versions.join(', ')}`);
      });
    }

    if (peerConflicts.length > 0) {
      printSection('Peer Dependency Conflicts');
      peerConflicts.forEach(conflict => {
        printError(`${conflict.package}`);
        console.log(`  ├─ Issue: ${conflict.conflict}`);
        console.log(`  └─ Required by: ${conflict.dependents.join(', ')}`);
      });
    }

    if (deprecatedPkgs.length > 0) {
      printSection('Deprecated Packages');
      deprecatedPkgs.forEach(dep => {
        printWarning(`${dep.name} is deprecated`);
        console.log(`  ├─ Reason: ${dep.info.reason}`);
        if (dep.info.replacement) {
          console.log(`  └─ Use instead: ${dep.info.replacement}`);
        }
      });
    }

    if (errors > 0) {
      printSection('Errors');
      compatibilityResults
        .filter((i) => i.status === 'error')
        .forEach((issue) => {
          printError(`${issue.package}@${issue.version}`);
          console.log('  ├─ Issues:');
          issue.messages.forEach((msg) => {
            console.log(`  │  • ${msg}`);
          });
          console.log('  ├─ Impact: This dependency has critical incompatibilities');
          console.log('  └─ Recommendation: Update to a compatible version or find an alternative');
        });
    }

    if (warnings > 0) {
      printSection('Warnings');
      compatibilityResults
        .filter((i) => i.status === 'warning')
        .forEach((issue) => {
          printWarning(`${issue.package}@${issue.version}`);
          console.log('  ├─ Issues:');
          issue.messages.forEach((msg) => console.log(`  │  • ${msg}`));
          console.log('  ├─ Impact: May cause runtime issues or unexpected behavior');
          console.log('  └─ Recommendation: Consider upgrading to the latest compatible version');
        });
    }

    const detectedBreakingChanges = breakingChangesResults.filter((r): r is typeof r & { issue: NonNullable<typeof r.issue> } => r.detected && r.issue !== undefined);
    if (detectedBreakingChanges.length > 0) {
      printSection('Breaking Changes');
      detectedBreakingChanges.forEach((change) => {
        const icon = change.issue.severity === 'critical' ? '🔴 CRITICAL' : '🟠 HIGH';
        console.log(`\n${icon}  ${change.issue.package}@${change.issue.version}`);
        console.log('  ├─ Changes:');
        change.issue.changes.forEach((msg: string, idx: number) => {
          const isLast = idx === change.issue.changes.length - 1;
          console.log(`  ${isLast ? '└' : '├'}  ✗ ${msg}`);
        });
        if (change.issue.migrationGuide) {
          console.log(`  ├─ Migration Guide: ${change.issue.migrationGuide}`);
        }
        console.log('  ├─ Severity: ' + (change.issue.severity === 'critical' ? 'CRITICAL - Must be addressed' : 'HIGH - Should be addressed soon'));
        console.log('  └─ Action: Review migration guide and update your code accordingly');
      });
    }


    printSection('Summary');
    const healthBreakdown: HealthScoreBreakdown = {
      compatible,
      warnings,
      errors,
      notChecked,
      total: compatibilityResults.length,
    };
    printHealthScore(healthBreakdown);

    const dashLine = '─'.repeat(50);
    console.log(chalk.gray(`\n${dashLine}`));
    console.log(`📦 Total dependencies: ${dependencies.length}`);
    console.log(`   ├─ Direct: ${dependencies.filter(d => d.type === 'dependency').length}`);
    console.log(`   ├─ Dev: ${dependencies.filter(d => d.type === 'devDependency').length}`);
    if (dependencies.filter(d => d.type === 'peerDependency').length > 0) {
      console.log(`   └─ Peer: ${dependencies.filter(d => d.type === 'peerDependency').length}`);
    }

    if (versionMismatches.length > 0) {
      console.log(`\n⚡ Version mismatches: ${versionMismatches.length}`);
    }
    if (duplicates.length > 0) {
      console.log(`🔀 Duplicate versions: ${duplicates.length}`);
    }
    if (peerConflicts.length > 0) {
      console.log(`⚠️  Peer conflicts: ${peerConflicts.length}`);
    }
    if (detectedBreakingChanges.length > 0) {
      console.log(`🔨 Breaking changes: ${detectedBreakingChanges.length}`);
    }
    if (deprecatedPkgs.length > 0) {
      console.log(`📦 Deprecated packages: ${deprecatedPkgs.length}`);
    }

    const criticalIssues = errors + duplicates.filter(d => d.severity === 'critical').length + peerConflicts.length;
    if (criticalIssues > 0 || detectedBreakingChanges.length > 0) {
      console.log(chalk.red.bold('\n⚠️  Action Required:'));
      if (errors > 0) {
        console.log(`  • ${errors} compatibility error(s) need fixing`);
      }
      if (duplicates.filter(d => d.severity === 'critical').length > 0) {
        console.log(`  • ${duplicates.filter(d => d.severity === 'critical').length} critical duplicate version(s)`);
      }
      if (peerConflicts.length > 0) {
        console.log(`  • ${peerConflicts.length} peer dependency conflict(s)`);
      }
      if (detectedBreakingChanges.length > 0) {
        console.log(`  • ${detectedBreakingChanges.length} breaking change(s) require code updates`);
      }
    } else if (errors === 0 && warnings === 0 && versionMismatches.length === 0 && duplicates.length === 0 && peerConflicts.length === 0 && deprecatedPkgs.length === 0) {
      console.log(chalk.green.bold('\n✨ All dependencies look good!'));
    } else if (warnings > 0 || versionMismatches.length > 0 || duplicates.length > 0 || peerConflicts.length > 0 || deprecatedPkgs.length > 0) {
      console.log(chalk.yellow.bold('\n⚠️  Consider addressing detected issues'));
    }

    if (options.json) {
      const result = {
        reactNative: {
          current: rnInfo.version,
        },
        react: {
          current: rnInfo.react,
        },
        packageManager: lockfileInfo.manager,
        summary: {
          total: compatibilityResults.length,
          compatible,
          notChecked,
          warnings,
          errors,
          healthScore: healthBreakdown.total > 0
            ? (() => {
              const analyzed = healthBreakdown.total - healthBreakdown.notChecked;
              if (analyzed > 0) {
                const good = healthBreakdown.compatible;
                const bad = healthBreakdown.warnings + healthBreakdown.errors;
                return Math.round((good / (good + bad)) * 100);
              }
              return healthBreakdown.total > 0 ? 0 : 100;
            })()
            : 100,
          breakingChanges: detectedBreakingChanges.length,
          versionMismatches: versionMismatches.length,
          duplicateDependencies: duplicates.length,
          peerConflicts: peerConflicts.length,
          deprecatedPackages: deprecatedPkgs.length,
        },
        issues: compatibilityResults.filter((i) => i.status !== 'compatible' && i.status !== 'not-checked'),
        versionMismatches: versionMismatches,
        duplicateDependencies: duplicates,
        peerConflicts: peerConflicts,
        deprecatedPackages: deprecatedPkgs.map(p => ({
          name: p.name,
          reason: p.info.reason,
          replacement: p.info.replacement,
        })),
        breakingChanges: detectedBreakingChanges.filter(r => r.issue).map(r => r.issue),
      };
      console.log('\n' + JSON.stringify(result, null, 2));
    }

    if (options.strict && errors > 0) {
      process.exit(1);
    }
  } catch (error) {
    printError(
      `Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
