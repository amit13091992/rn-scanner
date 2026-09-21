import { readPackageJson } from '../utils/packageJson.js';
import { buildDependencyGraph, collectAllPackageVersions } from '../utils/dependencyGraph.js';
import { readInstalledPackageLicense } from '../detectors/license.js';
import { printError } from '../utils/terminal.js';
import { formatJsonAsHtml, emitHtml, type HtmlOption } from '../utils/htmlOutput.js';

export interface SbomOptions {
  cwd?: string;
  html?: HtmlOption;
}

interface CycloneDxComponent {
  type: 'library';
  name: string;
  version: string;
  purl: string;
  licenses?: Array<{ license: { id?: string; name?: string } }>;
}

/**
 * Renders a CycloneDX 1.5 SBOM (JSON, no dependency needed — it's a fixed schema, not a
 * generated one) from the same dependency graph `why`/`tree`/`security` already traverse. This
 * is an output format on existing data, not new detection — coverage is complete for npm
 * (`hierarchyComplete: true`), direct-only for yarn/pnpm/bun (same known limitation as those
 * commands). Always writes to stdout, `check`/`security`-style, so it composes with shell
 * redirection (`rn-dep-scanner sbom > sbom.json`) rather than needing its own `--output` flag.
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
      const packages = collectAllPackageVersions(graph);
      const components: CycloneDxComponent[] = packages.map((pkg) => {
        const license = readInstalledPackageLicense(cwd, pkg.name);
        return {
          type: 'library',
          name: pkg.name,
          version: pkg.version,
          purl: `pkg:npm/${encodeURIComponent(pkg.name).replace(/%40/g, '@').replace(/%2F/g, '/')}@${pkg.version}`,
          ...(license ? { licenses: [{ license: { id: license } }] } : {}),
        };
      });

      const sbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          component: {
            type: 'application',
            name: packageJson.name ?? 'unknown',
            version: packageJson.version ?? '0.0.0',
          },
        },
        components,
      };

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

