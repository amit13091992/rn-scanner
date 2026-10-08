import { analyzeBreakingChanges, type BreakingChangeIssue } from './breakingChanges.js';
import { analyzeNewArchitecture } from './newArchitecture.js';
import { analyzeAndroidEnvironment } from './androidEnvironment.js';
import { analyzeIosEnvironment } from './iosEnvironment.js';
import { analyzeNodeEnvironment } from './nodeEnvironment.js';
import { checkDeprecatedPackages } from '../data/deprecatedPackages.js';
import { detectDuplicateDependencies } from '../utils/versionDetection.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { EnvironmentRequirement } from '../types/environmentRequirement.js';
import { verdictFromRequirements, combineVerdicts } from '../utils/verdict.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface UpgradeReadinessResult {
  risk: RiskLevel;
  verdict: 'READY' | 'WARN' | 'BLOCKED';
  envVerdict: 'READY' | 'WARN' | 'BLOCKED';
  breakingChanges: BreakingChangeIssue[];
  relevantBreakingChangeCount: number;
  newArchitecture: {
    isDefaultAtTarget: boolean;
    isBridgeRemovedAtTarget: boolean;
    issues: ReturnType<typeof analyzeNewArchitecture>['results'];
  };
  nodeEnvironment: EnvironmentRequirement[];
  androidEnvironment: EnvironmentRequirement[];
  iosEnvironment: EnvironmentRequirement[];
  deprecatedPackages: Array<{ name: string; reason: string; replacement: string | undefined }>;
  duplicateDependencies: ReturnType<typeof detectDuplicateDependencies>;
}

function envIssues(requirements: EnvironmentRequirement[]): EnvironmentRequirement[] {
  return requirements.filter((r) => r.status === 'error' || r.status === 'warning');
}

/**
 * Assesses upgrade readiness for a single hop (current dependency graph → `toVersion`). This
 * is the core logic `upgrade --to <version>` has always run; extracted so `upgrade --path` can
 * run the exact same assessment once per intermediate hop without duplicating it.
 */
export function assessUpgradeReadiness(dependencies: DependencyInfo[], cwd: string, toVersion: string): UpgradeReadinessResult {
  // Evaluate breaking changes as if react-native were already upgraded to the target version,
  // so rules keyed on the target's version range are surfaced (not just rules that already
  // match the currently-installed version).
  const dependenciesAtTarget: DependencyInfo[] = dependencies.map((dep) =>
    dep.name === 'react-native'
      ? { ...dep, resolvedVersion: toVersion, requestedVersion: toVersion }
      : dep
  );
  const breakingChanges = analyzeBreakingChanges(dependenciesAtTarget, dependencies, true).filter(
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

  // Only changes newly relevant to *this* upgrade (i.e. not already true before it) should
  // drive risk — a change introduced before the project's current RN version is historical and
  // shouldn't block an unrelated upgrade.
  const relevantBreakingChanges = breakingChanges.filter((c) => c.issue.relevance !== 'historical');
  const criticalBreaking = relevantBreakingChanges.filter((c) => c.issue.severity === 'critical').length;
  const newArchUnsupported = newArchIssues.filter((i) => i.support === 'unsupported').length;
  const androidErrors = androidIssues.filter((i) => i.status === 'error').length;
  const iosErrors = iosIssues.filter((i) => i.status === 'error').length;
  const nodeErrors = nodeIssues.filter((i) => i.status === 'error').length;

  let risk: RiskLevel = 'low';
  if (criticalBreaking > 0 || newArchUnsupported > 0 || androidErrors > 0 || iosErrors > 0 || nodeErrors > 0) {
    risk = 'high';
  } else if (
    relevantBreakingChanges.length > 0 ||
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

  return {
    risk,
    verdict,
    envVerdict,
    breakingChanges: breakingChanges.map((c) => c.issue),
    relevantBreakingChangeCount: relevantBreakingChanges.length,
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
}
