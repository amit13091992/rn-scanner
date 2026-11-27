import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCommand } from '../commands/check.js';
import { securityCommand } from '../commands/security.js';
import { doctorCommand } from '../commands/doctor.js';
import { analyzePackageSafety } from '../analyzers/packageSafety.js';
import { runCapturingExit } from '../utils/workspaceRun.js';
import type { McpTool, McpToolResult } from './protocol.js';

const CWD_PROPERTY = {
  type: 'string',
  description: 'Absolute path of the React Native project to analyze. Defaults to the server\'s working directory.',
};

function text(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function failure(message: string): McpToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** `cwd` comes from an AI agent: it must be an existing directory, and is only ever read. */
function resolveCwd(args: Record<string, unknown>): string {
  if (args.cwd === undefined) return process.cwd();
  if (typeof args.cwd !== 'string' || !args.cwd.trim()) throw new Error('cwd must be a non-empty string');
  const dir = resolve(args.cwd);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`cwd is not an existing directory: ${dir}`);
  return dir;
}

/**
 * Runs one of the CLI's own commands in `--json` mode and hands back exactly the JSON it prints,
 * so an agent sees the same shape documented for the CLI. A non-zero exit (e.g. `security` on a
 * high-severity finding) is normal output here, not a tool error.
 */
async function runJsonCommand(fn: () => Promise<void>): Promise<McpToolResult> {
  const { output } = await runCapturingExit(fn);
  try {
    JSON.parse(output);
  } catch {
    return failure(output.trim() || 'Command produced no JSON output');
  }
  return text(output.trim());
}

export function createTools(): McpTool[] {
  const readOnly = { readOnlyHint: true } as const;

  return [
    {
      name: 'check_package',
      description:
        'Before adding an npm dependency, check it is safe: does the name exist on npm (a missing name is a likely hallucinated or typo\'d package), is the package or version brand new, is usage implausibly low, does it run install-time scripts, is it deprecated or in a known supply-chain incident, and does OSV.dev list advisories for the version. Returns a verdict (ok / review / avoid / unknown) with the signals behind it.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'npm package name, e.g. "react-native-reanimated" or "@scope/pkg"' },
          version: { type: 'string', description: 'Exact version to check. Defaults to the latest published version.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      annotations: readOnly,
      run: async (args) => {
        if (typeof args.name !== 'string') return failure('name is required and must be a string');
        if (args.version !== undefined && typeof args.version !== 'string') return failure('version must be a string');
        return text(await analyzePackageSafety(args.name, args.version));
      },
    },
    {
      name: 'security_scan',
      description:
        'Scan a React Native project\'s direct and transitive dependencies for known vulnerabilities (OSV.dev) and known supply-chain incidents, plus install-script and recently-published-version signals. Same JSON as `security --json`.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: CWD_PROPERTY,
          failOn: {
            type: 'string',
            enum: ['critical', 'high', 'moderate', 'low', 'none'],
            description: 'Lowest severity treated as failing (default high). Only affects the CLI exit code, not the returned findings.',
          },
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      run: async (args) => {
        const cwd = resolveCwd(args);
        return runJsonCommand(() =>
          securityCommand({ cwd, json: true, ...(typeof args.failOn === 'string' ? { failOn: args.failOn } : {}) })
        );
      },
    },
    {
      name: 'check_dependencies',
      description:
        'Full dependency health check for a React Native project: version compatibility, breaking changes, New Architecture and Expo support, sub-dependency completeness, and (by default) security. Same JSON as `check --json`.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: CWD_PROPERTY,
          security: { type: 'boolean', description: 'Include the OSV.dev vulnerability scan (default true; needs network).' },
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      run: async (args) => {
        const cwd = resolveCwd(args);
        return runJsonCommand(() => checkCommand({ cwd, json: true, security: args.security !== false }));
      },
    },
    {
      name: 'doctor',
      description:
        'Environment health for a React Native project: React Native/Hermes status, Node and Android/iOS toolchain versions against the React Native version\'s baseline, 16KB page-size readiness, and an overall READY/WARN/BLOCKED verdict. Same JSON as `doctor --json`.',
      inputSchema: { type: 'object', properties: { cwd: CWD_PROPERTY }, additionalProperties: false },
      annotations: readOnly,
      run: async (args) => {
        const cwd = resolveCwd(args);
        return runJsonCommand(() => doctorCommand({ cwd, json: true }));
      },
    },
  ];
}
