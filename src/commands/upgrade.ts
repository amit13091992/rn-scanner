import { getAllDependenciesWithResolution, readPackageJson } from '../utils/packageJson.js';
import { detectReactNativeVersions } from '../detectors/reactNative.js';
import { assessUpgradeReadiness, type UpgradeReadinessResult } from '../analyzers/upgradeReadiness.js';
import { planUpgradePath } from '../analyzers/upgradePath.js';
import { coerce } from 'semver';
import { fetchLatestVersion, fetchLatestVersions } from '../utils/npmRegistry.js';
import {
  printHeader,
  printSection,
  printSuccess,
  printWarning,
  printError,
  printInfo,
} from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { listWorkspaceTargets, runCapturingExit } from '../utils/workspaceRun.js';

export interface UpgradeOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Assess upgrade readiness for every workspace package in the monorepo, not just `cwd`,
   *  and aggregate the results into one report. */
  allWorkspaces?: boolean;
  /** Resolve the target version from npm's `react-native` `latest` dist-tag instead of
   *  requiring an explicit `toVersion`. */
  latest?: boolean;
}

async function runAcrossWorkspaces(toVersion: string, cwd: string, options: UpgradeOptions): Promise<void> {
  const jsonMode = !!options.json || !!options.html;
  const targets = listWorkspaceTargets(cwd);

  if (targets.length === 0) {
    return upgradeCommand(toVersion, { ...options, allWorkspaces: false });
  }

  if (!jsonMode) {
    printHeader(`Upgrade Readiness: ${toVersion} (all workspaces)`);
  }

  let anyExit = false;
  const perPackageResults: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (!jsonMode) {
      printSection(`Workspace package: ${target.name}`);
    }
    const { output, exitCode } = await runCapturingExit(() =>
      upgradeCommand(toVersion, { ...options, cwd: target.dir, allWorkspaces: false, json: jsonMode, html: false })
    );
    if (exitCode) anyExit = true;

    if (jsonMode) {
      try {
        perPackageResults.push({ ...JSON.parse(output), package: target.name, dir: target.dir });
      } catch {
        perPackageResults.push({ package: target.name, dir: target.dir, error: 'Could not parse result' });
      }
    } else {
      console.log(output.replace(/\n$/, ''));
    }
  }

  if (jsonMode) {
    emitStructuredOutput({ workspaces: perPackageResults }, 'Upgrade Readiness (all workspaces)', options);
  }

  if (anyExit) {
    process.exit(1);
  }
}

interface UpgradePathStep {
  from: string | null;
  to: string;
  risk: UpgradeReadinessResult['risk'];
  verdict: UpgradeReadinessResult['verdict'];
}

function unverifiedToolchainsList(verified: { node: boolean; android: boolean; ios: boolean }): 'full' | 'javascript-only' {
  return verified.android && verified.ios ? 'full' : 'javascript-only';
}

export async function upgradeCommand(toVersion: string | undefined, options: UpgradeOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  let resolvedToVersion = toVersion;
  if (options.latest) {
    resolvedToVersion = await fetchLatestVersion('react-native');
    if (!resolvedToVersion) {
      const message = "Could not resolve react-native's latest published version from the npm registry";
      if (jsonMode) {
        emitStructuredOutput({ error: message }, 'Upgrade Readiness', options);
      } else {
        printError(message);
      }
      process.exit(1);
      return;
    }
  }
  if (!resolvedToVersion) {
    const message = 'No target version given — pass --to <version> or --latest';
    if (jsonMode) {
      emitStructuredOutput({ error: message }, 'Upgrade Readiness', options);
    } else {
      printError(message);
    }
    process.exit(1);
    return;
  }

  if (options.allWorkspaces) {
    return runAcrossWorkspaces(resolvedToVersion, cwd, { ...options, latest: false });
  }

  try {
    const packageJson = readPackageJson(cwd);
    const rnInfo = detectReactNativeVersions(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const currentVersion = rnInfo.version;

    const assessment = assessUpgradeReadiness(dependencies, cwd, resolvedToVersion, currentVersion);
    const { risk, riskReasons, minorsSpanned, dependencyCompatibility, environmentVerified, verdict, envVerdict, breakingChanges, relevantBreakingChangeCount, newArchitecture, nodeEnvironment, androidEnvironment, iosEnvironment, deprecatedPackages, duplicateDependencies } = assessment;
    const latestVersions = await fetchLatestVersions(dependencies.map((d) => d.name));
    const outdatedMajors = dependencies.filter((d) => {
      const installed = coerce(d.resolvedVersion || d.requestedVersion);
      const latest = latestVersions.get(d.name) ? coerce(latestVersions.get(d.name)!) : null;
      return !!installed && !!latest && latest.major > installed.major;
    }).length;
    const nodeIssues = nodeEnvironment.filter((r) => r.status === 'error' || r.status === 'warning');
    const androidIssues = androidEnvironment.filter((r) => r.status === 'error' || r.status === 'warning');
    const iosIssues = iosEnvironment.filter((r) => r.status === 'error' || r.status === 'warning');

    // Jumping several RN minors in one go compounds breaking-change risk non-linearly, so when
    // there are known intermediate versions between the current and target version, assess each
    // hop too and surface it as a lower-risk alternative to the single direct jump above.
    const hops = planUpgradePath(currentVersion, resolvedToVersion);
    let upgradePath: UpgradePathStep[] | undefined;
    if (hops.length > 1) {
      let hopFrom = currentVersion;
      upgradePath = hops.map((hopTo) => {
        const hopAssessment = assessUpgradeReadiness(dependencies, cwd, hopTo, hopFrom);
        const step: UpgradePathStep = { from: hopFrom, to: hopTo, risk: hopAssessment.risk, verdict: hopAssessment.verdict };
        hopFrom = hopTo;
        return step;
      });
    }

    if (jsonMode) {
      const result = {
        from: currentVersion,
        to: resolvedToVersion,
        risk,
        riskReasons,
        minorsSpanned,
        dependencyCompatibility,
        outdatedMajorVersions: outdatedMajors,
        environmentVerified,
        verdictScope: unverifiedToolchainsList(environmentVerified),
        verdict,
        envVerdict,
        breakingChanges,
        relevantBreakingChangeCount,
        newArchitecture,
        nodeEnvironment,
        androidEnvironment,
        iosEnvironment,
        deprecatedPackages,
        duplicateDependencies,
        ...(upgradePath ? { upgradePath } : {}),
      };
      emitStructuredOutput(result, 'Upgrade Readiness', options);
      return;
    }

    printHeader(`Upgrade Readiness: ${currentVersion ?? 'unknown'} → ${resolvedToVersion}`);
    if (currentVersion && currentVersion === resolvedToVersion) {
      printInfo(`Already on ${resolvedToVersion}${options.latest ? ', the latest published react-native' : ''} — nothing to upgrade; the report below is a health check of the current version.`);
    }

    const riskLabel = risk === 'high' ? '🔴 HIGH' : risk === 'medium' ? '🟠 MEDIUM' : '✓ LOW';
    const verdictLabel = verdict === 'BLOCKED' ? '🔴 BLOCKED' : verdict === 'WARN' ? '🟠 WARN' : '✓ READY';
    console.log(`Verdict: ${verdictLabel}  (Risk: ${riskLabel})`);
    riskReasons.forEach((reason) => console.log(`  • ${reason}`));
    const unverifiedToolchains = (['android', 'ios'] as const).filter((k) => !environmentVerified[k]);
    if (unverifiedToolchains.length > 0) {
      console.log(`  ℹ Verdict is based on JavaScript-level data only — the ${unverifiedToolchains.map((k) => (k === 'ios' ? 'iOS' : 'Android')).join(' and ')} toolchain could not be checked (no android/ios folder found). Restore or generate it (\`npx expo prebuild\` for Expo projects) and re-run for a native check.`);
    }
    if (outdatedMajors > 0) {
      console.log(`  • ${outdatedMajors} dependenc${outdatedMajors === 1 ? 'y has' : 'ies have'} a newer major version available (run \`npx rn-preflight outdated\`)`);
    }
    console.log('');

    printSection('Breaking Changes');
    if (breakingChanges.length === 0) {
      printSuccess('No known breaking changes for this upgrade');
    } else {
      const hiddenHistorical = breakingChanges.filter((i) => i.relevance === 'historical').length;
      breakingChanges.filter((i) => i.relevance !== 'historical').forEach((issue) => {
        const icon = issue.severity === 'critical' ? '🔴 CRITICAL' : issue.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
        const relevanceLabel = issue.relevance === 'historical'
          ? ' [historical — already true before this upgrade, does not affect verdict]'
          : issue.relevance === 'action_required'
            ? ' [action required for this upgrade]'
            : ' [relevant to this upgrade]';
        console.log(`\n${icon}  ${issue.package}@${issue.version} (since ${issue.introducedInVersion})${relevanceLabel}`);
        issue.changes.forEach((msg) => console.log(`  • ${msg}`));
        if (issue.migrationGuide) console.log(`  Migration guide: ${issue.migrationGuide}`);
      });
      if (relevantBreakingChangeCount === 0) printSuccess('No breaking changes newly introduced by this upgrade');
      if (hiddenHistorical > 0) printInfo(`${hiddenHistorical} breaking change(s) already in effect on your current version are hidden (see --json)`);
    }

    if (dependencyCompatibility.length > 0) {
      printSection(`Dependency Compatibility at ${resolvedToVersion}`);
      dependencyCompatibility.forEach((c) => {
        const label = `${c.package}@${c.version}`;
        if (c.status === 'error') printError(label); else printWarning(label);
        c.messages.forEach((m) => console.log(`  • ${m}`));
      });
    }

    printSection('New Architecture');
    if (newArchitecture.isDefaultAtTarget) {
      if (newArchitecture.isBridgeRemovedAtTarget) {
        printInfo(`React Native ${resolvedToVersion} removes the legacy bridge — New Architecture is mandatory`);
      } else {
        printInfo(`React Native ${resolvedToVersion} defaults to the New Architecture`);
      }
      if (newArchitecture.issues.length === 0) {
        printSuccess('No known New Architecture incompatibilities in current dependencies');
      } else {
        newArchitecture.issues.forEach((issue) => {
          if (issue.support === 'unsupported') {
            printError(`${issue.package}@${issue.version} does not support the New Architecture`);
          } else {
            printWarning(`${issue.package}@${issue.version} has partial New Architecture support`);
          }
          if (issue.notes) console.log(`  ${issue.notes}`);
        });
      }
    } else {
      printInfo(`React Native ${resolvedToVersion} does not default to the New Architecture`);
    }

    printSection('Node.js Environment');
    if (nodeIssues.length === 0 && !environmentVerified.node) {
      printInfo('Not verified — could not detect a Node.js version to compare');
    } else if (nodeIssues.length === 0) {
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
    if (androidIssues.length === 0 && !environmentVerified.android) {
      printInfo('Not verified — no android/ directory found (managed/prebuild project), so the Android toolchain was not checked');
    } else if (androidIssues.length === 0) {
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
    if (iosIssues.length === 0 && !environmentVerified.ios) {
      printInfo('Not verified — no ios/ directory found (managed/prebuild project), so the iOS toolchain was not checked');
    } else if (iosIssues.length === 0) {
      printSuccess('Current iOS toolchain satisfies target requirements (where detectable)');
    } else {
      iosIssues.forEach((i) => {
        const label = `${i.name}: ${i.current ?? 'not detected'} (required: ${i.required ?? i.recommended})`;
        if (i.status === 'error') printError(label);
        else printWarning(label);
        if (i.reason) console.log(`  ${i.reason}`);
      });
    }

    if (deprecatedPackages.length > 0) {
      printSection('Deprecated Packages');
      deprecatedPackages.forEach((dep) => {
        printWarning(`${dep.name} is deprecated`);
        console.log(`  Reason: ${dep.reason}`);
        if (dep.replacement) console.log(`  Use instead: ${dep.replacement}`);
      });
    }

    if (duplicateDependencies.length > 0) {
      printSection('Duplicate Dependencies');
      duplicateDependencies.forEach((dup) => {
        const icon = dup.severity === 'critical' ? '🔴 CRITICAL' : dup.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
        console.log(`${icon}  ${dup.package}: ${dup.versions.join(', ')}`);
      });
    }

    if (upgradePath) {
      printSection('Suggested Incremental Path');
      printInfo(`Jumping straight to ${resolvedToVersion} is ${risk} risk — consider upgrading through known intermediate versions instead:`);
      upgradePath.forEach((step) => {
        const stepIcon = step.verdict === 'BLOCKED' ? '🔴' : step.verdict === 'WARN' ? '🟠' : '✓';
        console.log(`  ${stepIcon} ${step.from ?? 'unknown'} → ${step.to}  (risk: ${step.risk})`);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Upgrade Readiness', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
