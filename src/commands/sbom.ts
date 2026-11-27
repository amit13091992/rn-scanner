import { createRequire } from 'node:module';
import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { readInstalledPackageLicense } from '../detectors/license.js';
import { readLockfileIntegrity } from '../detectors/lockfileIntegrity.js';
import { buildCycloneDxBom } from '../analyzers/sbom.js';
import { analyzeSecurityVulnerabilities } from '../analyzers/securityVulnerabilities.js';
import { loadConfig } from '../utils/config.js';
import { printError } from '../utils/terminal.js';
import { formatJsonAsHtml, emitHtml, type HtmlOption } from '../utils/htmlOutput.js';

const require = createRequire(import.meta.url);

export interface SbomOptions {
  cwd?: string;
  html?: HtmlOption;
  /** Also embed a CycloneDX `vulnerabilities` (VEX) section from an OSV.dev scan. */
  vex?: boolean;
}

/**
 * Renders a CycloneDX 1.6 SBOM (JSON, no dependency needed — it's a fixed schema, not a
 * generated one) from the same dependency graph `why`/`tree`/`security` already traverse: a
 * component per installed package (purl, license, dev-only marker, lockfile integrity hash),
 * the real dependency edges, and with `--vex` a `vulnerabilities` section whose entries are all
 * `in_triage` (reachability is never assessed). Coverage is complete for npm, yarn, pnpm and bun
 * graphs alike; hashes come from npm, yarn classic, pnpm and bun lockfiles (not yarn berry). Always writes to stdout,
 * `check`/`security`-style, so it composes with shell redirection
 * (`npx rn-dep-scanner sbom > sbom.json`) rather than needing its own `--output` flag.
 */
export async function sbomCommand(options: SbomOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  // See securityCommand for why `process.exit` is deferred until after the try/catch.
  let noGraphFound = false;

  try {
    const packageJson = await readPackageJson(cwd);
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      if (options.html) {
        emitHtml(formatJsonAsHtml('SBOM', { error: 'No project or lockfile found' }), typeof options.html === 'string' ? options.html : undefined);
      } else {
        console.log(JSON.stringify({ error: 'No project or lockfile found' }, null, 2));
      }
      noGraphFound = true;
    } else {
      let vulnerabilities;
      if (options.vex) {
        const { config } = loadConfig(cwd);
        const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
        const scan = await analyzeSecurityVulnerabilities(dependencies, config.ignoreVulnerabilities, graph, { source: config.knownMalwareFeed, cwd });
        if (!scan.scanned) {
          // An empty vulnerabilities list in a VEX document asserts "none known" — never emit
          // that when the scan could not run.
          throw new Error(`Cannot build the VEX section: ${scan.error ?? 'vulnerability scan did not run'}`);
        }
        vulnerabilities = scan.results;
      }

      const { version: toolVersion } = require('../../package.json') as { version: string };
      const sbom = buildCycloneDxBom({
        graph,
        app: { name: packageJson.name ?? 'unknown', version: packageJson.version ?? '0.0.0' },
        tool: { name: 'rn-dep-scanner', version: toolVersion },
        licenseOf: (name) => readInstalledPackageLicense(cwd, name),
        hashes: readLockfileIntegrity(cwd),
        ...(vulnerabilities ? { vulnerabilities } : {}),
      });

      if (options.html) {
        emitHtml(formatJsonAsHtml('SBOM', sbom), typeof options.html === 'string' ? options.html : undefined);
      } else {
        console.log(JSON.stringify(sbom, null, 2));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    printError(`Fatal error: ${message}`);
    process.exit(1);
    return;
  }

  if (noGraphFound) {
    process.exit(1);
  }
}

