import type { Readable, Writable } from 'node:stream';

/**
 * A minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0) covering
 * what a read-only tool server needs: initialize, ping, tools/list, tools/call. Hand-rolled
 * rather than depending on @modelcontextprotocol/sdk, whose 17 runtime dependencies (express,
 * hono, jose, ...) would dwarf this CLI (see ADR-0011). No transport other than stdio, no
 * resources/prompts/sampling, no server-initiated requests.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Everything this server exposes only reads; surfaced so clients can skip approval prompts. */
  annotations: { readOnlyHint: true };
  run: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export type McpHandler = (message: unknown) => Promise<JsonRpcResponse | null>;

export function createMcpHandler(info: { name: string; version: string }, tools: McpTool[]): McpHandler {
  const byName = new Map(tools.map((t) => [t.name, t]));
  // Tools temporarily capture console.log/process.exit (utils/workspaceRun.ts), which is
  // process-global, so two overlapping calls would corrupt each other's output.
  let queue: Promise<unknown> = Promise.resolve();

  return async function handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return errorResponse(null, INVALID_REQUEST, 'Expected a single JSON-RPC request object');
    }
    const request = message as JsonRpcRequest;
    const isNotification = !('id' in request);
    const id = (request.id ?? null) as string | number | null;

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return isNotification ? null : errorResponse(id, INVALID_REQUEST, 'Invalid JSON-RPC request');
    }

    const params = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<string, unknown>;

    switch (request.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return {
          jsonrpc: '2.0',
          id,
          result: { protocolVersion, capabilities: { tools: {} }, serverInfo: info },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
          },
        };
      case 'tools/call': {
        const tool = typeof params.name === 'string' ? byName.get(params.name) : undefined;
        if (!tool) return errorResponse(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
        const args = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;

        const run = queue.then(async (): Promise<McpToolResult> => {
          try {
            return await tool.run(args);
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }] };
          }
        });
        queue = run.catch(() => undefined);
        return { jsonrpc: '2.0', id, result: await run };
      }
      default:
        // Notifications (e.g. notifications/initialized) never get a reply.
        return isNotification ? null : errorResponse(id, METHOD_NOT_FOUND, `Method not found: ${request.method}`);
    }
  };
}

/** Reads newline-delimited JSON-RPC from `input`, writes one response line per request to `output`. */
export function serveStdio(handle: McpHandler, input: Readable, output: Writable): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    let pending = 0;
    let ended = false;

    const maybeDone = (): void => {
      if (ended && pending === 0) resolve();
    };

    const processLine = (line: string): void => {
      if (!line.trim()) return;
      pending++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify(errorResponse(null, PARSE_ERROR, 'Parse error'))}\n`);
        pending--;
        return;
      }
      handle(parsed)
        .then((response) => {
          if (response) output.write(`${JSON.stringify(response)}\n`);
        })
        .finally(() => {
          pending--;
          maybeDone();
        });
    };

    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
    input.on('end', () => {
      processLine(buffer);
      buffer = '';
      ended = true;
      maybeDone();
    });
  });
}
