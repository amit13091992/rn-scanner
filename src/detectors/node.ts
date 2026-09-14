export interface NodeVersionInfo {
  version?: string;
  source?: string;
}

/**
 * Detects the Node.js version running this CLI process. There is no reliable way to detect
 * the Node version a *project* is built with statically (an `engines.node` range in
 * package.json is a declared constraint, not the installed version) — the version of Node
 * actually invoking the toolchain is the one that matters for a preflight check.
 */
export function detectNodeVersion(): NodeVersionInfo {
  const version = process.version.replace(/^v/, '');
  return { version, source: 'process.version' };
}
