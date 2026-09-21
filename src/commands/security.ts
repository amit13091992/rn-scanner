import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { loadConfig } from '../utils/config.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';

export interface SecurityOptions {
  json?: boolean;
  cwd?: string;
}

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  moderate: '🟡 MODERATE',
  low: 'ℹ️  LOW',
  unknown: 'ℹ️  UNKNOWN',
};
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'unknown'];

/**
 * Standalone vulnerability scan, focused on the "a package I depend on (possibly transitively)
 * just got a security advisory — am I affected, and how did it get into my tree?" workflow —
 * without running the rest of `check`'s compatibility/breaking-change analysis.
 */
export async function securityCommand(options: SecurityOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;
  // Set inside the try block and read after it, so a non-zero exit is decided outside the
  // try/catch — calling `process.exit` from within `try` would otherwise be caught by this
  // function's own `catch` (a real concern in tests, where `process.exit` is stubbed to throw)
  // and misreported as a fatal error alongside the already-printed successful result.
  let criticalOrHighFound = false;

  try {
    if (!jsonMode) {
      printHeader('Security Scan');
    }

    const { config } = loadConfig(cwd);
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const graph = await buildDependencyGraph(cwd);

    if (!jsonMode && graph && !graph.hierarchyComplete) {
      printWarning(
        `Dependency hierarchy for "${graph.manager}" is direct-only (not fully resolved); transitive coverage may be incomplete.`
      );
    }

    const result = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph);

    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            ...result,
            hierarchyComplete: graph?.hierarchyComplete ?? false,
          },
          null,
          2
        )
      );
    } else {
      if (!result.scanned) {
        printWarning(`Could not run security scan: ${result.error ?? 'unknown error'}`);
      } else if (result.results.length === 0) {
        printSuccess('No known vulnerabilities found (via OSV.dev, including transitive dependencies)');
      } else {
        printSection('Vulnerabilities');
        result.results
          .slice()
          .sort((a, b) => {
            const aMax = Math.min(...a.vulnerabilities.map((v) => SEVERITY_ORDER.indexOf(v.severity)));
            const bMax = Math.min(...b.vulnerabilities.map((v) => SEVERITY_ORDER.indexOf(v.severity)));
            return aMax - bMax;
          })
          .forEach((pkgResult) => {
            pkgResult.vulnerabilities.forEach((vuln) => {
              console.log(`\n${SEVERITY_ICON[vuln.severity] ?? vuln.severity}  ${pkgResult.package}@${pkgResult.version}${pkgResult.direct ? '' : ' (transitive)'}`);
              console.log(`  ├─ ${vuln.id}: ${vuln.summary}`);
              if (vuln.fixedVersion) {
                console.log(`  ├─ Fixed in: ${vuln.fixedVersion}`);
              }
              pkgResult.paths.forEach((path, idx) => {
                const connector = idx === pkgResult.paths.length - 1 && vuln.references.length === 0 ? '└─' : '├─';
                console.log(`  ${connector} Path: your-app → ${path.join(' → ')}`);
              });
              if (vuln.references.length > 0) {
                console.log(`  └─ ${vuln.references[0]}`);
              }
            });
          });

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
    }

    criticalOrHighFound = result.summary.critical + result.summary.high > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
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
