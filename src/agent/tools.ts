import type { AgentToolDefinition } from '../types/aiAgent.js';
import { getNewArchInfo } from '../data/newArchitecture.js';
import { getCompatibilityRules } from '../data/compatibility.js';
import { fetchLatestVersion } from '../utils/npmRegistry.js';

/**
 * The agent's entire tool surface. Deliberately a hardcoded allowlist of existing,
 * already-tested read-only lookups — never raw filesystem access, never shell/process
 * execution, never a path the user's `cwd` controls. This is what keeps the agent inside
 * `security.md`'s "never execute scanned repository code" boundary by construction: there is
 * no tool here that reads anything other than this package's own curated data or the public
 * npm registry, so there's nothing for a malicious `node_modules` entry to exploit through it.
 */
export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getNewArchitectureStatus',
      description:
        "Looks up this package's curated New Architecture (Fabric/TurboModules) support status: supported/partial/unsupported, with a minimum supported version if known.",
      parameters: {
        type: 'object',
        properties: { packageName: { type: 'string', description: 'npm package name' } },
        required: ['packageName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCompatibilityRules',
      description:
        'Looks up curated compatibility rules for a package: which of its version lines require which React Native / React / Node version ranges.',
      parameters: {
        type: 'object',
        properties: { packageName: { type: 'string', description: 'npm package name' } },
        required: ['packageName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLatestPublishedVersion',
      description: "Looks up a package's latest published version from the public npm registry.",
      parameters: {
        type: 'object',
        properties: { packageName: { type: 'string', description: 'npm package name' } },
        required: ['packageName'],
      },
    },
  },
];

export type AgentToolName = (typeof AGENT_TOOL_DEFINITIONS)[number]['function']['name'];

/** Narrows an arbitrary tool-call-argument bag down to the one string field every tool here
 *  actually needs, so a malformed/missing argument degrades to an error result instead of
 *  throwing mid-agent-loop. */
function requirePackageName(args: Record<string, unknown>): string | undefined {
  return typeof args.packageName === 'string' && args.packageName.length > 0 ? args.packageName : undefined;
}

/**
 * Executes one allowlisted tool call by name. Returns a JSON-serializable result (never
 * throws) so the caller can always feed it back to the model as a tool message — an unknown
 * tool name or bad argument is reported back to the model as an error string, not a crash,
 * since Ollama's own model is responsible for deciding whether to self-correct.
 */
export async function runAgentTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name as AgentToolName) {
    case 'getNewArchitectureStatus': {
      const packageName = requirePackageName(args);
      if (!packageName) return { error: 'packageName is required' };
      const info = getNewArchInfo(packageName);
      return info ?? { error: `no curated New Architecture entry for "${packageName}"` };
    }
    case 'getCompatibilityRules': {
      const packageName = requirePackageName(args);
      if (!packageName) return { error: 'packageName is required' };
      const rules = getCompatibilityRules(packageName);
      return rules.length > 0 ? rules : { error: `no curated compatibility rules for "${packageName}"` };
    }
    case 'getLatestPublishedVersion': {
      const packageName = requirePackageName(args);
      if (!packageName) return { error: 'packageName is required' };
      const version = await fetchLatestVersion(packageName);
      return version ? { version } : { error: `could not resolve latest version for "${packageName}"` };
    }
    default:
      return { error: `unknown tool "${name}"` };
  }
}
