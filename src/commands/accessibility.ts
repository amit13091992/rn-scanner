import { analyzeAccessibility } from '../analyzers/accessibility.js';
import { printHeader, printSection, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface AccessibilityOptions {
  json?: boolean;
  html?: HtmlOption;
  cwd?: string;
  strict?: boolean;
}

export async function accessibilityCommand(options: AccessibilityOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;

  try {
    const result = analyzeAccessibility(cwd);
    const missingLabels = result.findings.filter((f) => f.issue === 'missing-label');

    if (jsonMode) {
      emitStructuredOutput(result, 'Accessibility Labels', options);
    } else {
      printHeader('Accessibility Labels');
      printInfo(`Checked ${result.elementsChecked} interactive element(s) across ${result.filesScanned} source file(s)`);

      if (result.findings.length === 0) {
        printSuccess('No interactive elements missing an accessibility label');
      } else {
        if (missingLabels.length > 0) {
          printSection(`Missing accessibility label (${missingLabels.length})`);
          missingLabels.forEach((f) => {
            printWarning(`${f.file}:${f.line}  <${f.component}>${f.confidence === 'low' ? '  (low confidence — custom component)' : ''}`);
            const t = Object.entries(f.declaredTraits).map(([k, v]) => `${k}=${v}`).join(', ');
            if (t) console.log(`  └─ declared traits: ${t}`);
          });
        }
        const missingRoles = result.findings.filter((f) => f.issue === 'missing-role');
        if (missingRoles.length > 0) {
          printSection(`Labeled but no accessibilityRole (${missingRoles.length})`);
          missingRoles.forEach((f) => printInfo(`${f.file}:${f.line}  <${f.component}>`));
        }
      }
      printInfo(`Note: ${result.runtimeInspection.reason}`);
    }

    if (options.strict && missingLabels.some((f) => f.confidence === 'high')) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Accessibility Labels', options);
    else printError(`Fatal error: ${message}`);
    process.exit(1);
  }
}
