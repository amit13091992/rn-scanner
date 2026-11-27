import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PassThrough } from 'node:stream';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, serveStdio, type McpTool } from '../src/mcp/protocol.js';
import { createTools } from '../src/mcp/tools.js';

const fixtureCwd = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'page-size');

function tool(name: string, run: McpTool['run']): McpTool {
  return { name, description: name, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, run };
}

const info = { name: 'test', version: '0.0.0' };

test('mcp handler - initialize negotiates a supported version and falls back to the newest', async () => {
  const handle = createMcpHandler(info, []);
  const same = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })) as any;
  assert.equal(same.result.protocolVersion, '2024-11-05');
  const other = (await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as any;
  assert.equal(other.result.protocolVersion, '2025-06-18');
  assert.deepEqual(other.result.capabilities, { tools: {} });
});

test('mcp handler - notifications get no reply; unknown methods and tools are JSON-RPC errors', async () => {
  const handle = createMcpHandler(info, []);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(((await handle({ jsonrpc: '2.0', id: 1, method: 'nope' })) as any).error.code, -32601);
  assert.equal(((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } })) as any).error.code, -32602);
  assert.equal(((await handle([])) as any).error.code, -32600);
});

test('mcp handler - a throwing tool becomes an isError result, not a crashed server', async () => {
  const handle = createMcpHandler(info, [tool('boom', async () => { throw new Error('kaput'); })]);
  const res = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom' } })) as any;
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content[0].text, 'kaput');
});

test('mcp handler - overlapping tool calls run one at a time', async () => {
  const log: string[] = [];
  const slow = tool('slow', async () => {
    log.push('start');
    await new Promise((r) => setTimeout(r, 20));
    log.push('end');
    return { content: [{ type: 'text', text: 'ok' }] };
  });
  const handle = createMcpHandler(info, [slow]);
  const call = (id: number) => handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'slow' } });
  await Promise.all([call(1), call(2)]);
  assert.deepEqual(log, ['start', 'end', 'start', 'end']);
});

test('serveStdio - handles lines split across chunks, bad JSON, and ends when input closes', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = serveStdio(createMcpHandler(info, []), input, output);
  input.write('{"jsonrpc":"2.0","id":1,');
  input.write('"method":"ping"}\nnot json\n');
  input.end();
  await done;
  output.end();
  const lines = (output.read() as string | null ?? '').toString().trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.id === 1 && l.result));
  assert.ok(lines.some((l) => l.id === null && l.error.code === -32700));
});

test('mcp tools - every tool is read-only and declares an object input schema', () => {
  const tools = createTools();
  assert.deepEqual(tools.map((t) => t.name), ['check_package', 'security_scan', 'check_dependencies', 'doctor']);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal((t.inputSchema as any).type, 'object');
  }
});

test('mcp tools - argument validation rejects bad cwd and bad package args without running anything', async () => {
  const byName = new Map(createTools().map((t) => [t.name, t]));
  const badCwd = (await Promise.resolve(byName.get('doctor')!.run({ cwd: '/definitely/not/here' }).catch((e: Error) => e.message))) as any;
  assert.match(typeof badCwd === 'string' ? badCwd : badCwd.content[0].text, /not an existing directory/);
  const noName = await byName.get('check_package')!.run({});
  assert.equal(noName.isError, true);
  const badVersion = await byName.get('check_package')!.run({ name: 'x', version: 5 });
  assert.equal(badVersion.isError, true);
});

test('mcp tools - doctor returns the CLI JSON for a real fixture project over the handler', async () => {
  const handle = createMcpHandler(info, createTools());
  const res = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: { cwd: fixtureCwd } } })) as any;
  assert.notEqual(res.result.isError, true);
  const parsed = JSON.parse(res.result.content[0].text);
  assert.ok('pageSize16k' in parsed && 'verdict' in parsed);
});
