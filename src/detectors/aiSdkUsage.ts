import { relative } from 'node:path';
import { walkSourceFiles } from '../utils/sourceFiles.js';
import { AI_KEY_PATTERNS } from '../data/aiKeyPatterns.js';
import type { AiKeyExposure } from '../types/aiSdkExposure.js';

/**
 * Scans project source for AI-provider-key-shaped literals (`data/aiKeyPatterns.ts`). Only the
 * provider/label/file/line is recorded — the matched substring itself is discarded immediately
 * after the regex test, so a real key can never reach the result object, `--json`/`--html`
 * output, or a captured log.
 */
export function scanForAiKeyLiterals(cwd: string): { exposures: AiKeyExposure[]; filesScanned: number } {
  const exposures: AiKeyExposure[] = [];

  const { filesScanned } = walkSourceFiles(cwd, (filePath, content) => {
    const lines = content.split('\n');
    lines.forEach((lineText, idx) => {
      for (const { provider, label, pattern } of AI_KEY_PATTERNS) {
        if (pattern.test(lineText)) {
          exposures.push({
            provider,
            label,
            file: relative(cwd, filePath),
            line: idx + 1,
          });
          break;
        }
      }
    });
  });

  return { exposures, filesScanned };
}
