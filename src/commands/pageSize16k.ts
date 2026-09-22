import { readPackageJson, getAllDependenciesWithResolution } from '../utils/packageJson.js';
import { analyzePageSize } from '../analyzers/pageSize.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface PageSize16kOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
}

/**
 * Standalone Android 16KB page-size alignment report — the same `analyzePageSize` data
 * `doctor` already surfaces, exposed on its own for a user who only wants this slice (e.g.
 * auditing native-library alignment ahead of a Google Play 16KB-page-size deadline) without
 * `doctor`'s Hermes/Node/native-toolchain checks.
 */
export async function pageSize16kCommand(options: PageSize16kOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const packageJson = await readPackageJson(cwd);
    const dependencies = await getAllDependenciesWithResolution(packageJson, cwd);
    const pageSize = analyzePageSize(cwd, dependencies);

    if (jsonMode) {
      emitStructuredOutput(pageSize, '16KB Page-Size Alignment', options);
      return;
    }

    printHeader('16KB Page-Size Alignment (Android)');

    const checked = pageSize.filter((r) => r.status !== 'not-checked');
    const unaligned = pageSize.filter((r) => r.status === 'unaligned');
    const noNativeLibraries = pageSize.filter((r) => r.notCheckedReason === 'no_native_libraries');
    const unreadable = pageSize.filter((r) => r.notCheckedReason === 'unreadable_library');

    if (pageSize.length === 0) {
      printInfo('No dependencies to check — no readable package.json, or no dependencies declared');
    } else if (checked.length === 0) {
      printInfo(`No prebuilt native (.so) libraries found across ${pageSize.length} dependenc${pageSize.length === 1 ? 'y' : 'ies'} — either no native modules are installed, or their .so files haven't been generated yet (some compile from source during the Android build)`);
    } else if (unaligned.length === 0) {
      printSuccess(`All ${checked.length} checked native librar${checked.length === 1 ? 'y is' : 'ies are'} 16KB-page-size aligned`);
    } else {
      unaligned.forEach((r) => {
        printWarning(`${r.package}@${r.version} ships a native library that is not 16KB-page-size aligned`);
        r.libraries
          .filter((l) => !l.is16kAligned)
          .forEach((l) => console.log(`  └─ ${l.path} (${l.abi}, max PT_LOAD align: ${l.maxLoadAlign} bytes)`));
      });
    }

    if (checked.length > 0 && noNativeLibraries.length > 0) {
      printInfo(`${noNativeLibraries.length} package(s) have no prebuilt native (.so) libraries to check — either JS-only, or compiling native code from source during the Android build`);
    }
    if (unreadable.length > 0) {
      printWarning(`${unreadable.length} package(s) shipped .so files that could not be read or parsed — alignment could not be determined`);
      unreadable.forEach((r) => console.log(`  └─ ${r.package}@${r.version}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, '16KB Page-Size Alignment', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
  }
}
