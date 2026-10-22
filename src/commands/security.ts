import { isOffline } from '../utils/network.js';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { analyzeSecurityVulnerabilities, type SecurityAnalysisResult } from '../analyzers/securityVulnerabilities.js';
import { loadConfig } from '../utils/config.js';
import { listWorkspaceTargets } from '../utils/workspaceRun.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { printGroupedVulnerabilities, meetsFailThreshold, parseFailOn, type SecurityPrintOptions } from '../utils/securityFormat.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VulnerabilitySeverity } from '../types/vulnerability.js';
import type { DependencyGraph } from '../types/dependencyGraph.js';

function graphManagerLabel(graph: DependencyGraph | null): { manager: string; hierarchyComplete: boolean } | null {
  return graph ? { manager: graph.manager, hierarchyComplete: graph.hierarchyComplete } : null;
}

export interface SecurityOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  /** Run the scan against every workspace package in the monorepo containing `cwd`, not just
   *  `cwd` itself, and aggregate the results into one report. A no-op (same as omitting it) when
   *  `cwd` isn't inside a workspace at all. */
  allWorkspaces?: boolean;
  /** One line per advisory instead of one grouped block per package. */
  verbose?: boolean;
  /** Counts plus one line per affected package — no per-advisory detail. */
  summary?: boolean;
  /** Lowest severity that makes the command exit 1 (default `high`; `none` never fails). */
  failOn?: string;
}

function appNameOf(cwd: string): string {
  try {
    const name = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).name;
    return typeof name === 'string' && name ? name : 'your-app';
  } catch {
    return 'your-app';
  }
}

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  moderate: '🟡 MODERATE',
  low: 'ℹ️  LOW',
  unknown: 'ℹ️  UNKNOWN',
};
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'unknown'];

/** Runs the scan for a single project directory — no printing, no process.exit — so both the
 *  single-project and `--all-workspaces` paths share the exact same analysis. */
async function scanOneProject(
  cwd: string
): Promise<{ result: SecurityAnalysisResult; graph: DependencyGraph | null }> {
  const { config } = loadConfig(cwd);
  const packageJson = await readPackageJson(cwd);
  const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
  const graph = await buildDependencyGraph(cwd);
  const result = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);
  return { result, graph };
}

function printSecurityResult(
  result: SecurityAnalysisResult,
  graphInfo: { manager: string; hierarchyComplete: boolean } | null,
  display: SecurityPrintOptions
): void {
  if (graphInfo && !graphInfo.hierarchyComplete) {
    printWarning(
      `Dependency hierarchy for "${graphInfo.manager}" is direct-only (not fully resolved); transitive coverage may be incomplete.`
    );
  }

  if (!result.scanned) {
    printWarning(`Could not run security scan: ${result.error ?? 'unknown error'}`);
    return;
  }
  if (result.results.length === 0) {
    printSuccess('No known vulnerabilities found (via OSV.dev, including transitive dependencies)');
    return;
  }

  printSection('Vulnerabilities');
  printGroupedVulnerabilities(result.results, display);

  printSection('Summary');
  (['critical', 'high', 'moderate', 'low', 'unknown'] as const).forEach((severity) => {
    if (result.summary[severity] > 0) {
      console.log(`${SEVERITY_ICON[severity]}: ${result.summary[severity]}`);
    }
  });
  const affectedDirect = result.results.filter((r) => r.direct).length;
  const affectedTransitive = result.results.filter((r) => !r.direct).length;
  printInfo(`${result.results.length} package(s) affected (${affectedDirect} direct, ${affectedTransitive} transitive)`);
}

function exceedsThreshold(result: SecurityAnalysisResult, threshold: VulnerabilitySeverity | 'none'): boolean {
  return meetsFailThreshold(result.summary, threshold);
}

async function runAcrossWorkspaces(cwd: string, options: SecurityOptions, jsonMode: boolean, threshold: VulnerabilitySeverity | 'none'): Promise<boolean> {
  const targets = listWorkspaceTargets(cwd);
  if (targets.length === 0) {
    // Not actually a workspace — --all-workspaces is a no-op, fall back to scanning cwd alone.
    const { result, graph } = await scanOneProject(cwd);
    if (jsonMode) {
      emitStructuredOutput({ ...result, hierarchyComplete: graph?.hierarchyComplete ?? false }, 'Security Scan', options);
    } else {
      printSecurityResult(result, graphManagerLabel(graph), { appName: appNameOf(cwd), verbose: !!options.verbose, summaryOnly: !!options.summary });
    }
    return exceedsThreshold(result, threshold);
  }

  const perPackage = await Promise.all(
    targets.map(async (target) => {
      const { result, graph } = await scanOneProject(target.dir);
      return { package: target.name, dir: target.dir, ...result, hierarchyComplete: graph?.hierarchyComplete ?? false, manager: graph?.manager };
    })
  );

  if (jsonMode) {
    const summary = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
    perPackage.forEach((pkg) => {
      (['critical', 'high', 'moderate', 'low', 'unknown'] as const).forEach((sev) => {
        summary[sev] += pkg.summary[sev];
      });
    });
    emitStructuredOutput({ workspaces: perPackage, summary }, 'Security Scan (all workspaces)', options);
  } else {
    perPackage.forEach((pkg) => {
      printSection(`Workspace package: ${pkg.package}`);
      printSecurityResult(
        { scanned: pkg.scanned, error: pkg.error, results: pkg.results, summary: pkg.summary },
        pkg.manager ? { manager: pkg.manager, hierarchyComplete: pkg.hierarchyComplete } : null,
        { appName: pkg.package, verbose: !!options.verbose, summaryOnly: !!options.summary }
      );
    });
  }

  return perPackage.some((pkg) => exceedsThreshold(pkg, threshold));
}

/**
 * Standalone vulnerability scan, focused on the "a package I depend on (possibly transitively)
 * just got a security advisory — am I affected, and how did it get into my tree?" workflow —
 * without running the rest of `check`'s compatibility/breaking-change analysis.
 */
export async function securityCommand(options: SecurityOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  // Set inside the try block and read after it, so a non-zero exit is decided outside the
  // try/catch — calling `process.exit` from within `try` would otherwise be caught by this
  // function's own `catch` (a real concern in tests, where `process.exit` is stubbed to throw)
  // and misreported as a fatal error alongside the already-printed successful result.
  let criticalOrHighFound = false;
  let threshold: VulnerabilitySeverity | 'none';
  try {
    threshold = parseFailOn(options.failOn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid --fail-on value';
    if (jsonMode) emitStructuredOutput({ error: message }, 'Security Scan', options);
    else printError(message);
    process.exit(1);
    return;
  }

  try {
    if (!jsonMode) {
      printHeader(options.allWorkspaces ? 'Security Scan (all workspaces)' : 'Security Scan');
    }

    if (options.allWorkspaces) {
      criticalOrHighFound = await runAcrossWorkspaces(cwd, options, jsonMode, threshold);
    } else {
      const { result, graph } = await scanOneProject(cwd);
      if (jsonMode) {
        emitStructuredOutput(
          { ...result, hierarchyComplete: graph?.hierarchyComplete ?? false },
          'Security Scan',
          options
        );
      } else {
        printSecurityResult(result, graphManagerLabel(graph), { appName: appNameOf(cwd), verbose: !!options.verbose, summaryOnly: !!options.summary });
      }
      // A scan that could not run is not a clean scan — fail CI unless the user asked for --offline.
      criticalOrHighFound = exceedsThreshold(result, threshold) || (!result.scanned && !isOffline());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Security Scan', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (criticalOrHighFound) {
    process.exit(1);
  }
}
