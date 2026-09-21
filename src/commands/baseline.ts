import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { loadConfig } from '../utils/config.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { createBaseline, diffAgainstBaseline, BASELINE_FILENAME, type BaselineFile } from '../utils/baseline.js';
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

  try {
    const { config } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);
    const securityResult = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);
    const baselinePath = join(cwd, BASELINE_FILENAME);

    if (options.create) {
      const baseline = createBaseline(securityResult);
      writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
      if (jsonMode) {
        emitStructuredOutput({ created: true, path: BASELINE_FILENAME, entries: baseline.entries.length }, 'Baseline', options);
      } else {
        printHeader('Baseline');
        printSuccess(`Created ${BASELINE_FILENAME} with ${baseline.entries.length} known finding(s)`);
      }
      return;
    }

    if (!existsSync(baselinePath)) {
      const error = `No baseline found at ${BASELINE_FILENAME} — run \`rn-dep-scanner baseline --create\` first`;
      if (jsonMode) {
        emitStructuredOutput({ error }, 'Baseline', options);
      } else {
        printError(error);
      }
      baselineMissing = true;
    } else {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as BaselineFile;
      const newFindings = diffAgainstBaseline(securityResult, baseline);
      newFindingsCount = newFindings.results.reduce((sum, r) => sum + r.vulnerabilities.length, 0);

      if (jsonMode) {
        emitStructuredOutput({ baseline: { createdAt: baseline.createdAt, entries: baseline.entries.length }, newFindings }, 'Baseline', options);
      } else {
        printHeader('Baseline Check');
        printInfo(`Baseline created ${baseline.createdAt} (${baseline.entries.length} known finding(s))`);
        if (!securityResult.scanned) {
          printWarning(`Could not run security scan: ${securityResult.error ?? 'unknown error'}`);
        } else if (newFindingsCount === 0) {
          printSuccess('No new vulnerabilities since the baseline was created');
        } else {
          newFindings.results.forEach((r) => {
            r.vulnerabilities.forEach((v) => {
              printError(`${r.package}@${r.version}: ${v.id} (${v.severity}) — ${v.summary}`);
            });
          });
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

  if (baselineMissing || newFindingsCount > 0) {
    process.exit(1);
  }
}
