import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzeBundleSize } from '../analyzers/bundleSize.js';
import { printHeader, printSection, printError, printInfo } from '../utils/terminal.js';

export interface BundleOptions {
  json?: boolean;
  cwd?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function bundleCommand(options: BundleOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json;

  try {
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const result = analyzeBundleSize(cwd, dependencies);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHeader('Dependency Size');
    printInfo('On-disk install size per direct dependency — an approximation of bundle weight, not a real Metro bundle analysis.');

    printSection('Largest Dependencies');
    result.packages.slice(0, 25).forEach((p) => {
      console.log(`  ${formatBytes(p.sizeBytes).padStart(9)}  ${p.name}`);
    });

    console.log(`\nTotal (direct dependencies): ${formatBytes(result.totalBytes)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Fatal error: ${message}` }, null, 2));
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
