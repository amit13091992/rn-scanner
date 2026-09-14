import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export type RubySource = '.ruby-version' | 'Gemfile' | 'unknown';

export interface RubyVersionInfo {
  version: string | null;
  source: RubySource;
}

/**
 * Determines the declared Ruby version, preferring (in order):
 * 1. .ruby-version at the repo root
 * 2. Gemfile's `ruby "X.Y.Z"` declaration
 *
 * Detection is static-file-based only; this does not shell out to check any
 * globally installed Ruby toolchain. Absence of both files is reported as
 * 'unknown' rather than falling back to a system check.
 */
export function detectRubyVersion(cwd: string): RubyVersionInfo {
  const rubyVersionFile = readFileSafe(join(cwd, '.ruby-version'));
  if (rubyVersionFile) {
    const trimmed = rubyVersionFile.trim();
    if (trimmed) return { version: trimmed, source: '.ruby-version' };
  }

  const gemfile = readFileSafe(join(cwd, 'Gemfile'));
  if (gemfile) {
    const match = gemfile.match(/^\s*ruby\s+['"]([\d.]+)['"]/m);
    if (match) return { version: match[1], source: 'Gemfile' };
  }

  return { version: null, source: 'unknown' };
}
