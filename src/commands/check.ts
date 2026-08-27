import chalk from 'chalk';
import { getAllDependencies, readPackageJson } from '../utils/packageJson.js';
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
    const dependencies = getAllDependencies(packageJson);

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
    const issues = analyzeAllDependencies(
      dependencies,
      rnInfo.version,
      rnInfo.react
    );
    const breakingChanges = analyzeBreakingChanges(dependencies);
    const securityVulns = analyzeSecurityVulnerabilities(dependencies);

    const compatible = issues.filter((i) => i.status === 'compatible').length;
    const warnings = issues.filter((i) => i.status === 'warning').length;
    const errors = issues.filter((i) => i.status === 'error').length;

    if (errors > 0) {
      printSection('Errors');
      issues
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
      issues
        .filter((i) => i.status === 'warning')
        .forEach((issue) => {
          printWarning(`${issue.package}@${issue.version}`);
          console.log('  ├─ Issues:');
          issue.messages.forEach((msg) => console.log(`  │  • ${msg}`));
          console.log('  ├─ Impact: May cause runtime issues or unexpected behavior');
          console.log('  └─ Recommendation: Consider upgrading to the latest compatible version');
        });
    }

    if (breakingChanges.length > 0) {
      printSection('Breaking Changes');
      breakingChanges.forEach((change) => {
        const icon = change.severity === 'critical' ? '🔴 CRITICAL' : '🟠 HIGH';
        console.log(`\n${icon}  ${change.package}@${change.version}`);
        console.log('  ├─ Changes:');
        change.changes.forEach((msg, idx) => {
          const isLast = idx === change.changes.length - 1;
          console.log(`  ${isLast ? '└' : '├'}  ✗ ${msg}`);
        });
        console.log('  ├─ Severity: ' + (change.severity === 'critical' ? 'CRITICAL - Must be addressed' : 'HIGH - Should be addressed soon'));
        console.log('  └─ Action: Review migration guide and update your code accordingly');
      });
    }

    if (securityVulns.length > 0) {
      printSection('Security Vulnerabilities');
      securityVulns.forEach((vuln) => {
        console.log(`\n🔓 ${vuln.package}@${vuln.version}`);
        vuln.vulnerabilities.forEach((v, idx) => {
          const severityIcon = v.severity === 'critical' ? '🔴' : v.severity === 'high' ? '🟠' : '🟡';
          const isLast = idx === vuln.vulnerabilities.length - 1;
          console.log(`  ${isLast ? '└' : '├'}─ ${severityIcon} [${v.severity.toUpperCase()}] ${v.id}`);
          console.log(`  ${isLast ? '   ' : '│  '} Description: ${v.description}`);
          if (v.fixedVersion) {
            console.log(`  ${isLast ? '   ' : '│  '} Fix: Upgrade to ${v.fixedVersion} or later`);
          } else {
            console.log(`  ${isLast ? '   ' : '│  '} Fix: No fixed version available yet`);
          }
        });
      });
    }

    printSection('Summary');
    printSummary(issues.length, compatible, warnings, errors);

    if (breakingChanges.length > 0) {
      console.log(`\n⚡ Breaking changes detected: ${breakingChanges.length}`);
    }
    if (securityVulns.length > 0) {
      console.log(`🔓 Security vulnerabilities: ${securityVulns.length}`);
    }

    if (errors > 0 || breakingChanges.length > 0 || securityVulns.length > 0) {
      console.log(chalk.red.bold('\n⚠️  Action Required:'));
      if (errors > 0) {
        console.log(`  • ${errors} dependency error(s) need to be fixed`);
      }
      if (breakingChanges.length > 0) {
        console.log(`  • ${breakingChanges.length} breaking change(s) require code updates`);
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
          total: issues.length,
          compatible,
          warnings,
          errors,
          breakingChanges: breakingChanges.length,
          securityVulnerabilities: securityVulns.length,
        },
        issues: issues.filter((i) => i.status !== 'compatible'),
        breakingChanges: breakingChanges,
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
