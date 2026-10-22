import type { DependencyInfo } from '../types/dependency.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { analyzeBreakingChanges, detectBreakingChanges, type BreakingChangeCheckResult, type BreakingChangeIssue } from './breakingChanges.js';
import { analyzeWhyNot, type WhyNotConstraint } from './whyNot.js';
import { findPathsGroupedByVersion } from '../utils/dependencyGraph.js';

export interface ImpactResult {
  package: string;
  currentVersion: string | null;
  targetVersion: string;
  /** The most relevant breaking-change note (kept for backward compatibility). */
  breakingChange: BreakingChangeCheckResult;
  /** Every applicable note between the installed and target version, newest first. */
  breakingChanges: BreakingChangeIssue[];
  blockers: WhyNotConstraint[];
  /** Immediate names of every package that depends on `package` (directly or transitively),
   *  derived from the dependency graph — "these are worth re-testing after the upgrade". */
  reverseDependents: string[];
  recommendedActions: string[];
}

/**
 * Assesses what upgrading a single package to `targetVersion` would affect: known breaking
 * changes at that version (reusing `detectBreakingChanges`, the same data `check`/`upgrade`
 * use), peer/dependency conflicts that would block the install (reusing `analyzeWhyNot`), and
 * which other installed packages depend on it at all (so their behavior is worth re-verifying
 * even without a hard conflict). `graph` is optional — without it, `reverseDependents` is
 * reported as an empty array rather than guessed at (ADR-0004).
 */
export function analyzeImpact(
  cwd: string,
  dependencies: DependencyInfo[],
  packageName: string,
  targetVersion: string,
  graph?: DependencyGraph | null
): ImpactResult {
  const current = dependencies.find((d) => d.name === packageName);
  const currentVersion = current?.resolvedVersion ?? current?.requestedVersion ?? null;

  const syntheticDep: DependencyInfo = {
    name: packageName,
    requestedVersion: targetVersion,
    resolvedVersion: targetVersion,
    type: current?.type ?? 'dependency',
  };
  const breakingChange = detectBreakingChanges(syntheticDep, currentVersion ?? undefined, true);

  const breakingChanges = analyzeBreakingChanges([syntheticDep], current ? [current] : [syntheticDep], true)
    .flatMap((r) => (r.detected && r.issue ? [r.issue] : []));

  const whyNot = analyzeWhyNot(cwd, dependencies, packageName, targetVersion);

  const reverseDependents = new Set<string>();
  if (graph) {
    findPathsGroupedByVersion(graph, packageName).forEach((occurrence) => {
      occurrence.paths.forEach((path) => {
        const immediateParent = path.length >= 2 ? path[path.length - 2] : graph.nodes.get(graph.root)?.name || 'your-app';
        reverseDependents.add(immediateParent);
      });
    });
  }

  const recommendedActions: string[] = [];
  for (const issue of breakingChanges.filter((i) => !i.stale && i.relevance !== 'historical')) {
    recommendedActions.push(
      `Review breaking changes introduced in ${packageName}@${issue.introducedInVersion}` +
        (issue.migrationGuide ? ` (migration guide: ${issue.migrationGuide})` : '') +
        ' before upgrading.'
    );
  }
  if (whyNot.blockers.length > 0) {
    recommendedActions.push(
      `Resolve peer/version conflicts with: ${whyNot.blockers.map((b) => b.requiredBy).join(', ')} before upgrading (see \`why-not\` for details).`
    );
  }
  if (reverseDependents.size > 0) {
    recommendedActions.push(
      `Re-test ${reverseDependents.size} package(s)/area(s) that depend on ${packageName}: ${[...reverseDependents].join(', ')}.`
    );
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push('No known breaking changes or conflicts detected — verify manually, since this is based only on curated data, not a full compatibility guarantee.');
  }

  return {
    package: packageName,
    currentVersion,
    targetVersion,
    breakingChange,
    breakingChanges,
    blockers: whyNot.blockers,
    reverseDependents: [...reverseDependents],
    recommendedActions,
  };
}
