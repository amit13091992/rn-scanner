import { buildDependencyGraph, collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface DiffOptions {
  json?: boolean;
  html?: HtmlOption;
  from: string;
  to: string;
}

interface ChangedPackage {
  name: string;
  fromVersion: string;
  toVersion: string;
}

/**
 * Compares two project directories' dependency graphs (each resolved the same way `check`/
 * `security` do, via `buildDependencyGraph`) and reports added/removed/changed packages across
 * the full transitive tree — then runs the security scan against just the added/changed set,
 * so a PR that quietly pulls in a vulnerable new transitive package is caught before merge.
 * Takes two directories rather than two raw lockfile paths so it reuses the existing
 * lockfile-parsing pipeline as-is instead of a second, ad hoc parser.
 */
export async function diffCommand(options: DiffOptions): Promise<void> {
  const jsonMode = !!options.json || !!options.html;
  // See securityCommand for why `process.exit` is deferred until after the try/catch.
  let graphMissing = false;

  try {
    const [fromGraph, toGraph] = await Promise.all([
      buildDependencyGraph(options.from),
      buildDependencyGraph(options.to),
    ]);

    if (!fromGraph || !toGraph) {
      const error = `No project or lockfile found at ${!fromGraph ? options.from : options.to}`;
      if (jsonMode) {
        emitStructuredOutput({ error }, 'Dependency Diff', options);
      } else {
        printError(error);
      }
      graphMissing = true;
      return;
    }

    const fromByName = new Map<string, string>();
    collectAllPackageVersions(fromGraph).forEach((p) => fromByName.set(p.name, p.version));
    const toByName = new Map<string, string>();
    collectAllPackageVersions(toGraph).forEach((p) => toByName.set(p.name, p.version));

    const added: { name: string; version: string }[] = [];
    const removed: { name: string; version: string }[] = [];
    const changed: ChangedPackage[] = [];

    for (const [name, version] of toByName) {
      if (!fromByName.has(name)) {
        added.push({ name, version });
      } else if (fromByName.get(name) !== version) {
        changed.push({ name, fromVersion: fromByName.get(name)!, toVersion: version });
      }
    }
    for (const [name, version] of fromByName) {
      if (!toByName.has(name)) {
        removed.push({ name, version });
      }
    }

    const newlyIntroduced = [...added.map((a) => ({ name: a.name, version: a.version })), ...changed.map((c) => ({ name: c.name, version: c.toVersion }))];
    const securityScan = await analyzeSecurityVulnerabilities(
      newlyIntroduced.map((p) => ({ name: p.name, requestedVersion: p.version, resolvedVersion: p.version, type: 'dependency' as const })),
      []
    );

    const result = { added, removed, changed, security: securityScan };

    if (jsonMode) {
      emitStructuredOutput(result, 'Dependency Diff', options);
      return;
    }

    printHeader('Dependency Diff');
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      printSuccess('No dependency changes detected');
      return;
    }

    if (added.length > 0) {
      printSection('Added');
      added.forEach((p) => console.log(`  + ${p.name}@${p.version}`));
    }
    if (removed.length > 0) {
      printSection('Removed');
      removed.forEach((p) => console.log(`  - ${p.name}@${p.version}`));
    }
    if (changed.length > 0) {
      printSection('Changed');
      changed.forEach((p) => console.log(`  ~ ${p.name}: ${p.fromVersion} → ${p.toVersion}`));
    }

    if (securityScan.scanned && securityScan.results.length > 0) {
      printSection('New Vulnerabilities Introduced');
      securityScan.results.forEach((r) => {
        r.vulnerabilities.forEach((v) => {
          printWarning(`${r.package}@${r.version}: ${v.id} (${v.severity}) — ${v.summary}`);
        });
      });
    } else if (securityScan.scanned) {
      printInfo('No known vulnerabilities in the added/changed packages');
    } else {
      printWarning(`Could not run security scan on changed packages: ${securityScan.error ?? 'unknown error'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Dependency Diff', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (graphMissing) {
    process.exit(1);
  }
}
