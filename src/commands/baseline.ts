import { basename, join } from 'node:path';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { loadConfig } from '../utils/config.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { createBaseline, diffBaselineDetailed, readBaselineFile, severityCounts, writeBaselineFile, BASELINE_FILENAME } from '../utils/baseline.js';
import { printGroupedVulnerabilities, SEVERITY_ORDER } from '../utils/securityFormat.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface BaselineOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  create?: boolean;
}

/**
 * `--create` snapshots current known-vulnerability findings to `.rn-dep-scanner-baseline.json`
 * so CI can be set up to fail only on *new* findings, not the backlog a large existing project
 * already has (the "adopt this on day one without a wall of pre-existing issues" workflow).
 * Without `--create`, re-scans and reports only findings not already in the baseline.
 */
export async function baselineCommand(options: BaselineOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let newFindingsCount = 0;
  let baselineMissing = false;
  let scanFailed = false;

  try {
    const { config } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);
    const securityResult = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);
    const baselinePath = join(cwd, BASELINE_FILENAME);

    const appName = packageJson.name || basename(cwd);

    if (!securityResult.scanned) {
      // Failing closed: an empty snapshot would silently whitelist nothing, and a check that
      // couldn't scan would otherwise report "no new vulnerabilities" and pass CI.
      const error = `Security scan could not run (${securityResult.error ?? 'unknown error'}) — baseline ${options.create ? 'not written' : 'not evaluated'}`;
      if (jsonMode) {
        emitStructuredOutput({ error, scanned: false }, 'Baseline', options);
      } else {
        printError(error);
      }
      scanFailed = true;
    } else if (options.create) {
      const existing = readBaselineFile(baselinePath);
      const previous = existing.status === 'ok' ? existing.baseline : undefined;
      const baseline = createBaseline(securityResult);
      writeBaselineFile(baselinePath, baseline);
      const counts = severityCounts(securityResult.results);
      const bySeverity = SEVERITY_ORDER.filter((sev) => counts[sev] > 0).map((sev) => `${counts[sev]} ${sev}`);
      const previousKeys = new Set(previous?.entries ?? []);
      const added = baseline.entries.filter((k) => !previousKeys.has(k)).length;
      const removed = previous ? previous.entries.filter((k) => !baseline.entries.includes(k)).length : 0;

      if (jsonMode) {
        emitStructuredOutput(
          {
            created: true,
            path: BASELINE_FILENAME,
            entries: baseline.entries.length,
            bySeverity: counts,
            ...(previous ? { replaced: { previousEntries: previous.entries.length, added, removed } } : {}),
          },
          'Baseline',
          options
        );
      } else {
        printHeader('Baseline');
        if (existing.status === 'corrupt') {
          printWarning(`The existing ${BASELINE_FILENAME} was unreadable (${existing.reason}) and has been replaced`);
        }
        printSuccess(
          `${previous ? 'Updated' : 'Created'} ${BASELINE_FILENAME} with ${baseline.entries.length} known finding(s)${bySeverity.length ? ` (${bySeverity.join(', ')})` : ''}`
        );
        if (previous) {
          printInfo(`Replaced the previous baseline (${previous.entries.length} finding(s)): +${added} added, -${removed} dropped`);
        }
        if (baseline.entries.length === 0) {
          printInfo('No vulnerabilities found right now — the baseline is empty, so any future finding will be reported as new.');
        }
        console.log(`\n  Next: commit ${BASELINE_FILENAME}, then run \`npx rn-dep-scanner baseline\` in CI — it exits 1 only on findings not listed here.`);
      }
    } else if (readBaselineFile(baselinePath).status === 'missing') {
      const error = `No baseline found at ${BASELINE_FILENAME} — run \`npx rn-dep-scanner baseline --create\` first`;
      if (jsonMode) {
        emitStructuredOutput({ error }, 'Baseline', options);
      } else {
        printError(error);
      }
      baselineMissing = true;
    } else {
      const loaded = readBaselineFile(baselinePath);
      if (loaded.status !== 'ok') {
        const error = `${BASELINE_FILENAME} is unreadable (${loaded.status === 'corrupt' ? loaded.reason : 'missing'}) — fix or delete it, then run \`npx rn-dep-scanner baseline --create\``;
        if (jsonMode) {
          emitStructuredOutput({ error }, 'Baseline', options);
        } else {
          printError(error);
        }
        baselineMissing = true;
      } else {
      const baseline = loaded.baseline;
      const diff = diffBaselineDetailed(securityResult, baseline);
      const newFindings = diff.newFindings;
      newFindingsCount = newFindings.results.reduce((sum, r) => sum + r.vulnerabilities.length, 0);
      const counts = severityCounts(newFindings.results);

      if (jsonMode) {
        emitStructuredOutput(
          {
            baseline: { createdAt: baseline.createdAt, entries: baseline.entries.length },
            summary: { known: baseline.entries.length, unchanged: diff.unchanged, resolved: diff.resolved.length, new: newFindingsCount, newBySeverity: counts },
            newFindings,
            resolved: diff.resolved,
          },
          'Baseline',
          options
        );
      } else {
        printHeader('Baseline Check');
        printInfo(`Baseline created ${baseline.createdAt} (${baseline.entries.length} known finding(s))`);
        console.log(`  Still present: ${diff.unchanged}   Resolved since baseline: ${diff.resolved.length}   New: ${newFindingsCount}`);

        if (newFindingsCount === 0) {
          printSuccess('No new vulnerabilities since the baseline was created');
        } else {
          const bySeverity = SEVERITY_ORDER.filter((sev) => counts[sev] > 0).map((sev) => `${counts[sev]} ${sev}`);
          printError(`${newFindingsCount} new vulnerabilit${newFindingsCount === 1 ? 'y' : 'ies'} not in the baseline (${bySeverity.join(', ')})`);
          printGroupedVulnerabilities(newFindings.results, { appName, verbose: true });
        }

        if (diff.resolved.length > 0) {
          console.log('\n  Resolved since the baseline (no longer reported):');
          diff.resolved.slice(0, 10).forEach((r) => {
            console.log(`   ✓ ${typeof r === 'string' ? r : `${r.package}@${r.version} ${r.id} (${r.severity})`}`);
          });
          if (diff.resolved.length > 10) console.log(`   … and ${diff.resolved.length - 10} more`);
          console.log('  Run `baseline --create` to prune them from the baseline.');
        }
      }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Baseline', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (baselineMissing || scanFailed || newFindingsCount > 0) {
    process.exit(1);
  }
}
