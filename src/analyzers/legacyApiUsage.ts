import { relative } from 'node:path';
import { walkSourceFiles } from '../utils/sourceFiles.js';
import { LEGACY_APIS, type LegacyApiEntry } from '../data/legacyApis.js';

export interface LegacyApiOccurrence {
  symbol: string;
  fromPackage: string;
  reason: string;
  replacement: string;
  removedInVersion?: string;
  /** Project-relative paths (not absolute — keeps output stable across machines/CI) of every
   *  file where this symbol was found imported. */
  files: string[];
}

export interface LegacyApiUsageResult {
  occurrences: LegacyApiOccurrence[];
  filesScanned: number;
}

/**
 * Matches a named import/require destructure of `symbol` specifically from `fromPackage` —
 * covers `import { X } from 'react-native'`, `import { A, X, B } from 'react-native'`, and
 * `const { X } = require('react-native')`. Deliberately regex-based, consistent with
 * `unusedDependencies`'s approach and this project's "prefer deterministic analysis" rule — a
 * renamed import (`X as Y`) or a re-export through an intermediate module won't be caught, so
 * this is a starting point for review, not a compiler-grade usage analysis.
 */
function buildPattern(entry: LegacyApiEntry): RegExp {
  const symbol = entry.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pkg = entry.fromPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Named-import braces: `{ ...symbol... }` from the package, allowing other names alongside it.
  const importForm = `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]${pkg}['"]`;
  // Destructured require: `{ ...symbol... } = require('package')`.
  const requireForm = `\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*=\\s*require\\(\\s*['"]${pkg}['"]\\s*\\)`;
  return new RegExp(`${importForm}|${requireForm}`);
}

/**
 * Scans project source for imports of React Native core APIs that were removed and split into
 * separate community packages (`data/legacyApis.ts`), reporting each affected file and the
 * suggested replacement package. Import-based detection only — a deprecated *prop* or *method*
 * on an API that otherwise still exists isn't covered (that needs real usage analysis of the
 * component's call sites, not just an import check).
 */
export function analyzeLegacyApiUsage(cwd: string): LegacyApiUsageResult {
  const patterns = LEGACY_APIS.map((entry) => ({ entry, pattern: buildPattern(entry) }));
  const filesBySymbol = new Map<string, Set<string>>();

  const { filesScanned } = walkSourceFiles(cwd, (filePath, content) => {
    for (const { entry, pattern } of patterns) {
      if (pattern.test(content)) {
        if (!filesBySymbol.has(entry.symbol)) filesBySymbol.set(entry.symbol, new Set());
        filesBySymbol.get(entry.symbol)!.add(relative(cwd, filePath));
      }
    }
  });

  const occurrences: LegacyApiOccurrence[] = LEGACY_APIS
    .filter((entry) => filesBySymbol.has(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      fromPackage: entry.fromPackage,
      reason: entry.reason,
      replacement: entry.replacement,
      removedInVersion: entry.removedInVersion,
      files: [...filesBySymbol.get(entry.symbol)!].sort(),
    }));

  return { occurrences, filesScanned };
}
