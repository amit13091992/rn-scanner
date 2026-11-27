import { createRequire } from 'node:module';
import { createMcpHandler, serveStdio } from '../mcp/protocol.js';
import { createTools } from '../mcp/tools.js';

const require = createRequire(import.meta.url);

/**
 * `mcp`: serves this CLI's analyses to an MCP client (a coding agent) over stdio until the client
 * closes the stream. stdout is the protocol channel, so nothing else may write to it; diagnostics
 * go to stderr.
 */
export async function mcpCommand(): Promise<void> {
  const { version } = require('../../package.json') as { version: string };
  const handler = createMcpHandler({ name: 'rn-preflight', version }, createTools());
  console.error(`rn-preflight MCP server ${version} ready on stdio`);
  await serveStdio(handler, process.stdin, process.stdout);
}
