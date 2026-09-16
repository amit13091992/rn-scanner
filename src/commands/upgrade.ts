import { getAllDependenciesWithResolution, readPackageJson } from '../utils/packageJson.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { analyzeBreakingChanges } from '../analyzers/breakingChanges.js';
import { analyzeNewArchitecture } from '../analyzers/newArchitecture.js';
import { analyzeAndroidEnvironment } from '../analyzers/androidEnvironment.js';
import { analyzeIosEnvironment } from '../analyzers/iosEnvironment.js';
import { analyzeNodeEnvironment } from '../analyzers/nodeEnvironment.js';
import { checkDeprecatedPackages } from '../data/deprecatedPackages.js';
import { detectDuplicateDependencies } from '../utils/versionDetection.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { verdictFromRequirements, combineVerdicts } from '../utils/verdict.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
  printInfo,
} from '../utils/terminal.js';

export interface UpgradeOptions {
  json?: boolean;
  cwd?: string;
}

type RiskLevel = 'low' | 'medium' | 'high';

function envIssues(requirements: EnvironmentRequirement[]): EnvironmentRequirement[] {
  return requirements.filter((r) => r.status === 'error' || r.status === 'warning');
}

export async function upgradeCommand(toVersion: string, options: UpgradeOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const packageJson = readPackageJson(cwd);
    const rnInfo = detectReactNativeVersions(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const currentVersion = rnInfo.version;

    // Evaluate breaking changes as if react-native were already upgraded to the target
    // version, so rules keyed on the target's version range are surfaced (not just rules
    // that already match the currently-installed version).
    const dependenciesAtTarget: DependencyInfo[] = dependencies.map((dep) =>
      dep.name === 'react-native'
        ? { ...dep, resolvedVersion: toVersion, requestedVersion: toVersion }
        : dep
    );
    const breakingChanges = analyzeBreakingChanges(dependenciesAtTarget, dependencies).filter(
      (r): r is typeof r & { issue: NonNullable<typeof r.issue> } => r.detected && r.issue !== undefined
    );

    const newArch = analyzeNewArchitecture(dependencies, toVersion);
    const newArchIssues = newArch.results.filter(
      (r) => r.support === 'unsupported' || r.support === 'partial'
    );

    const androidEnvironment = analyzeAndroidEnvironment(cwd, toVersion);
    const iosEnvironment = analyzeIosEnvironment(cwd, toVersion);
    const nodeEnvironment = analyzeNodeEnvironment(toVersion);
    const androidIssues = envIssues(androidEnvironment);
    const iosIssues = envIssues(iosEnvironment);
    const nodeIssues = envIssues(nodeEnvironment);

    const deprecatedPkgs = checkDeprecatedPackages(dependencies.map((d) => d.name));
    const duplicates = detectDuplicateDependencies(dependencies);

    const criticalBreaking = breakingChanges.filter((c) => c.issue.severity === 'critical').length;
    const newArchUnsupported = newArchIssues.filter((i) => i.support === 'unsupported').length;
    const androidErrors = androidIssues.filter((i) => i.status === 'error').length;
    const iosErrors = iosIssues.filter((i) => i.status === 'error').length;
    const nodeErrors = nodeIssues.filter((i) => i.status === 'error').length;

    let risk: RiskLevel = 'low';
    if (criticalBreaking > 0 || newArchUnsupported > 0 || androidErrors > 0 || iosErrors > 0 || nodeErrors > 0) {
      risk = 'high';
    } else if (
      breakingChanges.length > 0 ||
      newArchIssues.length > 0 ||
      androidIssues.length > 0 ||
      iosIssues.length > 0 ||
      nodeIssues.length > 0
    ) {
      risk = 'medium';
    }

    // verdict is a READY/WARN/BLOCKED restatement of `risk`, kept as a distinct field so
    // consumers can match on the literal contract without depending on the risk vocabulary.
    const verdict = risk === 'high' ? 'BLOCKED' : risk === 'medium' ? 'WARN' : 'READY';
    // envVerdict rolls up just the native-toolchain checks (node/android/ios), independent of
    // breaking-change/New Architecture severity — useful when a caller only cares whether the
    // machine itself is ready to build, not whether the JS dependency graph has migration work.
    const envVerdict = combineVerdicts([
      verdictFromRequirements(nodeEnvironment),
      verdictFromRequirements(androidEnvironment),
      verdictFromRequirements(iosEnvironment),
    ]);

    if (jsonMode) {
      const result = {
        from: currentVersion,
        to: toVersion,
        risk,
        verdict,
        envVerdict,
        breakingChanges: breakingChanges.map((c) => c.issue),
        newArchitecture: {
          isDefaultAtTarget: newArch.status.isNewArchDefault,
          isBridgeRemovedAtTarget: newArch.status.isBridgeRemoved,
          issues: newArchIssues,
        },
        nodeEnvironment,
        androidEnvironment,
        iosEnvironment,
        deprecatedPackages: deprecatedPkgs.map((p) => ({
          name: p.name,
          reason: p.info.reason,
          replacement: p.info.replacement,
        })),
        duplicateDependencies: duplicates,
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader(`Upgrade Readiness: ${currentVersion ?? 'unknown'} → ${toVersion}`);

    const riskLabel = risk === 'high' ? '🔴 HIGH' : risk === 'medium' ? '🟠 MEDIUM' : '✓ LOW';
    const verdictLabel = verdict === 'BLOCKED' ? '🔴 BLOCKED' : verdict === 'WARN' ? '🟠 WARN' : '✓ READY';
    console.log(`Verdict: ${verdictLabel}  (Risk: ${riskLabel})\n`);

    printSection('Breaking Changes');
    if (breakingChanges.length === 0) {
      printSuccess('No known breaking changes for this upgrade');
    } else {
      breakingChanges.forEach((c) => {
        const icon = c.issue.severity === 'critical' ? '🔴 CRITICAL' : c.issue.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
        console.log(`\n${icon}  ${c.issue.package}@${c.issue.version} (since ${c.issue.introducedInVersion})`);
        c.issue.changes.forEach((msg) => console.log(`  • ${msg}`));
        if (c.issue.migrationGuide) console.log(`  Migration guide: ${c.issue.migrationGuide}`);
      });
    }

    printSection('New Architecture');
    if (newArch.status.isNewArchDefault) {
      if (newArch.status.isBridgeRemoved) {
        printInfo(`React Native ${toVersion} removes the legacy bridge — New Architecture is mandatory`);
      } else {
        printInfo(`React Native ${toVersion} defaults to the New Architecture`);
      }
      if (newArchIssues.length === 0) {
        printSuccess('No known New Architecture incompatibilities in current dependencies');
      } else {
        newArchIssues.forEach((issue) => {
          if (issue.support === 'unsupported') {
            printError(`${issue.package}@${issue.version} does not support the New Architecture`);
          } else {
            printWarning(`${issue.package}@${issue.version} has partial New Architecture support`);
          }
          if (issue.notes) console.log(`  ${issue.notes}`);
        });
      }
    } else {
      printInfo(`React Native ${toVersion} does not default to the New Architecture`);
    }

    printSection('Node.js Environment');
    if (nodeIssues.length === 0) {
      printSuccess('Current Node.js version satisfies target requirements (where detectable)');
    } else {
      nodeIssues.forEach((i) => {
        const label = `${i.name}: ${i.current ?? 'not detected'} (required: ${i.required ?? i.recommended})`;
        if (i.status === 'error') printError(label);
        else printWarning(label);
        if (i.reason) console.log(`  ${i.reason}`);
      });
    }

    printSection('Android Environment');
    if (androidIssues.length === 0) {
      printSuccess('Current Android toolchain satisfies target requirements (where detectable)');
    } else {
      androidIssues.forEach((i) => {
        const label = `${i.name}: ${i.current ?? 'not detected'} (required: ${i.required ?? i.recommended})`;
        if (i.status === 'error') printError(label);
        else printWarning(label);
        if (i.reason) console.log(`  ${i.reason}`);
      });
    }

    printSection('iOS Environment');
    if (iosIssues.length === 0) {
      printSuccess('Current iOS toolchain satisfies target requirements (where detectable)');
    } else {
      iosIssues.forEach((i) => {
        const label = `${i.name}: ${i.current ?? 'not detected'} (required: ${i.required ?? i.recommended})`;
        if (i.status === 'error') printError(label);
        else printWarning(label);
        if (i.reason) console.log(`  ${i.reason}`);
      });
    }

    if (deprecatedPkgs.length > 0) {
      printSection('Deprecated Packages');
      deprecatedPkgs.forEach((dep) => {
        printWarning(`${dep.name} is deprecated`);
        console.log(`  Reason: ${dep.info.reason}`);
        if (dep.info.replacement) console.log(`  Use instead: ${dep.info.replacement}`);
      });
    }

    if (duplicates.length > 0) {
      printSection('Duplicate Dependencies');
      duplicates.forEach((dup) => {
        const icon = dup.severity === 'critical' ? '🔴 CRITICAL' : dup.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
        console.log(`${icon}  ${dup.package}: ${dup.versions.join(', ')}`);
      });
    }
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
