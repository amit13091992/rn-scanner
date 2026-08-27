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
  printSummary,
} from '../utils/terminal.js';

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

    printSection('Analyzing Dependencies');
    const compatibilityResults = analyzeAllDependencies(
      dependencies,
      rnInfo.version,
      rnInfo.react
    );
    const breakingChangesResults = analyzeBreakingChanges(dependencies);
    const securityVulns = await analyzeSecurityVulnerabilities(dependencies);

    const compatible = compatibilityResults.filter((i) => i.status === 'compatible').length;
    const notChecked = compatibilityResults.filter((i) => i.status === 'not-checked').length;
    const warnings = compatibilityResults.filter((i) => i.status === 'warning').length;
    const errors = compatibilityResults.filter((i) => i.status === 'error').length;

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

    if (securityVulns.length > 0) {
      printSection('Security Vulnerabilities');
      securityVulns.forEach((vuln) => {
        console.log(`\n🔓 ${vuln.package}@${vuln.version}`);
        vuln.vulnerabilities.vulnerabilities.forEach((v, idx) => {
          const severityIcon = v.severity === 'critical' ? '🔴' : v.severity === 'high' ? '🟠' : '🟡';
          const isLast = idx === vuln.vulnerabilities.vulnerabilities.length - 1;
          console.log(`  ${isLast ? '└' : '├'}─ ${severityIcon} [${v.severity.toUpperCase()}] ${v.id}`);
          console.log(`  ${isLast ? '   ' : '│  '} Description: ${v.description}`);
          if (v.fixedVersion) {
            console.log(`  ${isLast ? '   ' : '│  '} Fix: Upgrade to ${v.fixedVersion} or later`);
          } else if (v.fixedVersions?.length) {
            console.log(`  ${isLast ? '   ' : '│  '} Fix: Upgrade to ${v.fixedVersions[0]} or later`);
          } else {
            console.log(`  ${isLast ? '   ' : '│  '} Fix: No fixed version available yet`);
          }
          if (v.references.length > 0) {
            console.log(`  ${isLast ? '   ' : '│  '} References:`);
            v.references.forEach((ref, refIdx) => {
              const isLastRef = refIdx === v.references.length - 1;
              console.log(`  ${isLast ? '   ' : '│  '} ${isLastRef ? '└─' : '├─'} ${ref.url}`);
            });
          }
        });
      });
    }

    printSection('Summary');
    printSummary(compatibilityResults.length, compatible, warnings, errors);

    if (detectedBreakingChanges.length > 0) {
      console.log(`\n⚡ Breaking changes detected: ${detectedBreakingChanges.length}`);
    }
    if (securityVulns.length > 0) {
      console.log(`🔓 Security vulnerabilities: ${securityVulns.length}`);
    }
    if (notChecked > 0) {
      console.log(`ℹ️  Not checked (no rules): ${notChecked}`);
    }

    if (errors > 0 || detectedBreakingChanges.length > 0 || securityVulns.length > 0) {
      console.log(chalk.red.bold('\n⚠️  Action Required:'));
      if (errors > 0) {
        console.log(`  • ${errors} dependency error(s) need to be fixed`);
      }
      if (detectedBreakingChanges.length > 0) {
        console.log(`  • ${detectedBreakingChanges.length} breaking change(s) require code updates`);
      }
      if (securityVulns.length > 0) {
        console.log(`  • ${securityVulns.length} security vulnerability(ies) need patching`);
      }
    } else {
      console.log(chalk.green.bold('\n✨ All dependencies look good!'));
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
          breakingChanges: detectedBreakingChanges.length,
          securityVulnerabilities: securityVulns.length,
        },
        issues: compatibilityResults.filter((i) => i.status !== 'compatible' && i.status !== 'not-checked'),
        breakingChanges: detectedBreakingChanges.filter(r => r.issue).map(r => r.issue),
        securityVulnerabilities: securityVulns,
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
