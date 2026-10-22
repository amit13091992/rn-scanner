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
import { analyzeAllDependencies } from './compatibility.js';
import { coerce } from 'semver';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface UpgradeReadinessResult {
  risk: RiskLevel;
  /** Why `risk` is what it is, most important first — makes a non-obvious rating explainable. */
  riskReasons: string[];
  /** How many React Native minors the jump spans (0.79 → 0.88 = 9); null when either version is unparseable. */
  minorsSpanned: number | null;
  /** Installed packages whose documented compatibility rules fail at the target RN version. */
  dependencyCompatibility: Array<{ package: string; version: string; status: 'error' | 'warning'; messages: string[] }>;
  /** False when none of the native-toolchain checks could run (e.g. no android/ or ios/ directory). */
  environmentVerified: { node: boolean; android: boolean; ios: boolean };
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
function minorsBetween(from: string | null | undefined, to: string): number | null {
  const a = from ? coerce(from) : null;
  const b = coerce(to);
  if (!a || !b) return null;
  if (a.major !== b.major) return Math.max(b.minor - a.minor, 1) + Math.abs(b.major - a.major) * 6;
  return Math.max(b.minor - a.minor, 0);
}

function wasVerified(requirements: EnvironmentRequirement[]): boolean {
  return requirements.some((r) => r.status !== 'unknown');
}

export function assessUpgradeReadiness(
  dependencies: DependencyInfo[],
  cwd: string,
  toVersion: string,
  fromVersion?: string | null
): UpgradeReadinessResult {
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

  const minorsSpanned = minorsBetween(fromVersion, toVersion);
  const compatAtTarget = analyzeAllDependencies(dependencies, toVersion, null, [], cwd)
    .filter((r) => r.status === 'error' || r.status === 'warning')
    .map((r) => ({ package: r.package, version: r.version, status: r.status as 'error' | 'warning', messages: r.messages }));
  const compatErrors = compatAtTarget.filter((c) => c.status === 'error').length;

  const riskReasons: string[] = [];
  let risk = 'low' as RiskLevel;
  const raise = (level: RiskLevel, reason: string) => {
    riskReasons.push(reason);
    if (level === 'high' || (level === 'medium' && risk === 'low')) risk = level;
  };
  if (criticalBreaking > 0) raise('high', `${criticalBreaking} critical breaking change(s) newly introduced by this upgrade`);
  if (newArchUnsupported > 0) raise('high', `${newArchUnsupported} package(s) do not support the New Architecture`);
  if (androidErrors + iosErrors + nodeErrors > 0) raise('high', `${androidErrors + iosErrors + nodeErrors} native-toolchain requirement(s) not met`);
  if (compatErrors > 0) raise('high', `${compatErrors} installed package(s) are incompatible with React Native ${toVersion}`);
  if (minorsSpanned !== null && minorsSpanned >= 6) raise('high', `Jump spans ${minorsSpanned} React Native minor versions — breaking changes compound across releases`);
  else if (minorsSpanned !== null && minorsSpanned >= 3) raise('medium', `Jump spans ${minorsSpanned} React Native minor versions`);
  if (relevantBreakingChanges.length > 0) raise('medium', `${relevantBreakingChanges.length} breaking change(s) relevant to this upgrade`);
  if (newArchIssues.length > 0) raise('medium', `${newArchIssues.length} package(s) with New Architecture caveats`);
  if (compatAtTarget.length > compatErrors) raise('medium', `${compatAtTarget.length - compatErrors} package(s) with compatibility warnings at the target version`);
  if (androidIssues.length + iosIssues.length + nodeIssues.length > 0) raise('medium', 'Native-toolchain warnings');

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
    riskReasons,
    minorsSpanned,
    dependencyCompatibility: compatAtTarget,
    environmentVerified: {
      node: wasVerified(nodeEnvironment),
      android: wasVerified(androidEnvironment),
      ios: wasVerified(iosEnvironment),
    },
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
