import chalk from 'chalk';
import { getAllDependenciesWithResolution, readPackageJson } from '../utils/packageJson.js';
import { detectPackageManager } from '../utils/lockfile.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeAllDependencies } from '../analyzers/compatibility.js';
import { analyzeBreakingChanges } from '../analyzers/breakingChanges.js';
import { analyzeNewArchitecture } from '../analyzers/newArchitecture.js';
import { analyzeExpoCompatibility } from '../analyzers/expoCompatibility.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { loadConfig } from '../utils/config.js';
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
import { computeHealthScore } from '../utils/healthScore.js';

export interface CheckOptions {
  json?: boolean;
  strict?: boolean;
  cwd?: string;
  security?: boolean;
}

export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();

  try {
    const jsonMode = !!options.json;

    if (!jsonMode) {
      printHeader('RN Deps Scanner');
    }

    const config = loadConfig(cwd);
    const packageJson = readPackageJson(cwd);
    const lockfileInfo = detectPackageManager(cwd);
    const rnInfo = detectReactNativeVersions(cwd);
    const allDependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const ignoredPackages = config.ignorePackages ?? [];
    const dependencies = ignoredPackages.length > 0
      ? allDependencies.filter((d) => !ignoredPackages.includes(d.name))
      : allDependencies;


    if (!jsonMode) {
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
    }

    const rnCompatCheck = rnInfo.version && rnInfo.react
      ? isReactNativeCompatible(rnInfo.version, rnInfo.react)
      : null;
    if (!jsonMode && rnCompatCheck && !rnCompatCheck.compatible) {
      printWarning(`React ↔ React Native: ${rnCompatCheck.issue}`);
    }

    if (!jsonMode) {
      printSection('Analyzing Dependencies');
      if (ignoredPackages.length > 0) {
        const actuallyIgnored = allDependencies.filter((d) => ignoredPackages.includes(d.name));
        if (actuallyIgnored.length > 0) {
          printInfo(`Ignoring ${actuallyIgnored.length} package(s) per .rn-dep-scanner.json: ${actuallyIgnored.map((d) => d.name).join(', ')}`);
        }
      }
    }
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
    const newArch = analyzeNewArchitecture(dependencies, rnInfo.version);
    const expoCompat = analyzeExpoCompatibility(cwd, rnInfo.version, packageJson);
    const securityResult = options.security
      ? await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities)
      : null;
    const newArchIssues = newArch.results.filter(
      (r) => r.support === 'unsupported' || r.support === 'partial'
    );
    const newArchUntested = newArch.results.filter((r) => r.support === 'unknown');

    const detectedBreakingChanges = breakingChangesResults.filter((r): r is typeof r & { issue: NonNullable<typeof r.issue> } => r.detected && r.issue !== undefined);
    const actionableBreakingChanges = detectedBreakingChanges.filter(c => !c.issue.stale);
    const healthBreakdown: HealthScoreBreakdown = {
      compatible,
      warnings,
      errors,
      notChecked,
      total: compatibilityResults.length,
    };
    const newArchUnsupported = newArchIssues.filter(i => i.support === 'unsupported').length;

    if (!jsonMode) {
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

      if (newArch.status.isNewArchDefault) {
        printSection('New Architecture (Fabric/TurboModules)');
        if (newArch.status.isBridgeRemoved) {
          printInfo(`React Native ${rnInfo.version} has removed the legacy bridge — New Architecture is mandatory`);
        } else {
          printInfo(`React Native ${rnInfo.version} defaults to the New Architecture`);
        }
        if (newArchIssues.length === 0) {
          printSuccess('No known New Architecture incompatibilities in checked dependencies');
        } else {
          newArchIssues.forEach((issue) => {
            if (issue.support === 'unsupported') {
              printError(`${issue.package}@${issue.version} does not support the New Architecture`);
            } else {
              printWarning(`${issue.package}@${issue.version} has partial New Architecture support`);
            }
            if (issue.notes) {
              console.log(`  └─ ${issue.notes}`);
            }
          });
        }
        if (newArchUntested.length > 0) {
          newArchUntested.forEach((issue) => {
            printInfo(`${issue.package}@${issue.version} has no New Architecture compatibility data`);
            if (issue.notes) {
              console.log(`  └─ ${issue.notes}`);
            }
          });
        }
      }

      if (expoCompat.isExpoProject) {
        printSection('Expo Compatibility');
        if (expoCompat.sdkVersion !== null) {
          printInfo(`Expo SDK: ${expoCompat.sdkVersion}`);
        }
        if (expoCompat.messages.length === 0) {
          printSuccess(`React Native ${expoCompat.actualReactNative} matches Expo SDK ${expoCompat.sdkVersion}'s expected version`);
        } else {
          expoCompat.messages.forEach((msg, idx) => {
            if (expoCompat.reactNativeMismatch && idx === 0) {
              printError(msg);
            } else {
              printWarning(msg);
            }
          });
        }
      }

      if (options.security) {
        printSection('Security Vulnerabilities');
        if (!securityResult || !securityResult.scanned) {
          printWarning(`Could not run security scan: ${securityResult?.error ?? 'unknown error'}`);
        } else if (securityResult.results.length === 0) {
          printSuccess('No known vulnerabilities found (via OSV.dev)');
        } else {
          const severityIcon: Record<string, string> = {
            critical: '🔴 CRITICAL',
            high: '🟠 HIGH',
            moderate: '🟡 MODERATE',
            low: 'ℹ️  LOW',
            unknown: 'ℹ️  UNKNOWN',
          };
          const severityOrder = ['critical', 'high', 'moderate', 'low', 'unknown'];
          securityResult.results
            .slice()
            .sort((a, b) => {
              const aMax = Math.min(...a.vulnerabilities.map((v) => severityOrder.indexOf(v.severity)));
              const bMax = Math.min(...b.vulnerabilities.map((v) => severityOrder.indexOf(v.severity)));
              return aMax - bMax;
            })
            .forEach((pkgResult) => {
              pkgResult.vulnerabilities.forEach((vuln) => {
                console.log(`\n${severityIcon[vuln.severity] ?? vuln.severity}  ${pkgResult.package}@${pkgResult.version}`);
                console.log(`  ├─ ${vuln.id}: ${vuln.summary}`);
                if (vuln.fixedVersion) {
                  console.log(`  ├─ Fixed in: ${vuln.fixedVersion}`);
                }
                if (vuln.references.length > 0) {
                  console.log(`  └─ ${vuln.references[0]}`);
                }
              });
            });
        }
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

      if (detectedBreakingChanges.length > 0) {
        printSection('Breaking Changes');
        detectedBreakingChanges.forEach((change) => {
          const icon = change.issue.stale
            ? 'ℹ️  HISTORICAL'
            : change.issue.severity === 'critical' ? '🔴 CRITICAL' : '🟠 HIGH';
          console.log(`\n${icon}  ${change.issue.package}@${change.issue.version}`);
          console.log(`  ├─ Introduced in: ${change.issue.introducedInVersion}`);
          console.log('  ├─ Changes:');
          change.issue.changes.forEach((msg: string) => {
            console.log(`  ├  ✗ ${msg}`);
          });
          if (change.issue.migrationGuide) {
            console.log(`  ├─ Migration Guide: ${change.issue.migrationGuide}`);
          }
          if (change.issue.stale) {
            console.log('  ├─ Status: Already part of the installed version — likely already migrated');
            console.log('  └─ Action: For awareness only; verify your code accounts for this if not already');
          } else {
            console.log('  ├─ Severity: ' + (change.issue.severity === 'critical' ? 'CRITICAL - Must be addressed' : 'HIGH - Should be addressed soon'));
            console.log('  └─ Action: Review migration guide and update your code accordingly');
          }
        });
      }


      printSection('Summary');
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
        const staleCount = detectedBreakingChanges.length - actionableBreakingChanges.length;
        const staleNote = staleCount > 0 ? ` (${staleCount} historical, for awareness only)` : '';
        console.log(`🔨 Breaking changes: ${detectedBreakingChanges.length}${staleNote}`);
      }
      if (deprecatedPkgs.length > 0) {
        console.log(`🗑️  Deprecated packages: ${deprecatedPkgs.length}`);
      }
      if (newArchIssues.length > 0) {
        console.log(`🏗️  New Architecture issues: ${newArchIssues.length}`);
      }

      const criticalIssues = errors + duplicates.filter(d => d.severity === 'critical').length + peerConflicts.length + newArchUnsupported + (expoCompat.reactNativeMismatch ? 1 : 0);
      if (criticalIssues > 0 || actionableBreakingChanges.length > 0) {
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
        if (actionableBreakingChanges.length > 0) {
          console.log(`  • ${actionableBreakingChanges.length} breaking change(s) require code updates`);
        }
        if (newArchUnsupported > 0) {
          console.log(`  • ${newArchUnsupported} package(s) do not support the New Architecture`);
        }
        if (expoCompat.reactNativeMismatch) {
          console.log(`  • React Native version does not match what Expo SDK ${expoCompat.sdkVersion} expects`);
        }
      } else if (compatible > 0 && errors === 0 && warnings === 0 && versionMismatches.length === 0 && duplicates.length === 0 && peerConflicts.length === 0 && deprecatedPkgs.length === 0 && newArchIssues.length === 0 && actionableBreakingChanges.length === 0 && expoCompat.messages.length === 0) {
        console.log(chalk.green.bold('\n✨ All dependencies look good!'));
      } else if (warnings > 0 || versionMismatches.length > 0 || duplicates.length > 0 || peerConflicts.length > 0 || deprecatedPkgs.length > 0 || newArchIssues.length > 0 || expoCompat.messages.length > 0) {
        console.log(chalk.yellow.bold('\n⚠️  Consider addressing detected issues'));
      } else if (notChecked > 0) {
        console.log(chalk.gray.bold('\nℹ No compatibility rules matched any dependencies — nothing was verified'));
      }
    }

    if (jsonMode) {
      const healthScoreResult = computeHealthScore(healthBreakdown);
      const result = {
        reactNative: {
          current: rnInfo.version,
        },
        react: {
          current: rnInfo.react,
        },
        packageManager: lockfileInfo.manager,
        dependencies,
        summary: {
          total: compatibilityResults.length,
          compatible,
          notChecked,
          warnings,
          errors,
          healthScore: healthScoreResult.score,
          healthScoreCoverage: {
            analyzed: healthScoreResult.analyzed,
            lowCoverage: healthScoreResult.lowCoverage,
          },
          breakingChanges: detectedBreakingChanges.length,
          actionableBreakingChanges: actionableBreakingChanges.length,
          versionMismatches: versionMismatches.length,
          duplicateDependencies: duplicates.length,
          peerConflicts: peerConflicts.length,
          deprecatedPackages: deprecatedPkgs.length,
          newArchitectureIssues: newArchIssues.length,
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
        newArchitecture: {
          isDefault: newArch.status.isNewArchDefault,
          isBridgeRemoved: newArch.status.isBridgeRemoved,
          issues: newArchIssues,
          untested: newArchUntested,
        },
        expo: expoCompat,
        ...(options.security ? { security: securityResult } : {}),
        ...(ignoredPackages.length > 0
          ? { config: { ignoredPackages: allDependencies.filter((d) => ignoredPackages.includes(d.name)).map((d) => d.name) } }
          : {}),
      };
      console.log(JSON.stringify(result, null, 2));
    }

    const criticalOrHighVulns = securityResult
      ? securityResult.summary.critical + securityResult.summary.high
      : 0;
    if (options.strict && (errors > 0 || criticalOrHighVulns > 0)) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (options.json) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
