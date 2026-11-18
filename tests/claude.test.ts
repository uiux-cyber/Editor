import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_PROTOCOL_VERSIONS, TOOLS, claudeCodeCommand, kinoraEntryOf, withKinoraEntry, withoutKinoraEntry, type McpServerEntry } from '@shared/claude';
import { createMcpServer } from '../src/mcp/protocol';

const entry: McpServerEntry = { command: 'C:\\Program Files\\Kinora\\Kinora.exe', args: ['C:\\Program Files\\Kinora\\resources\\mcp\\kinora-mcp.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };

describe('Claude Desktop config', () => {
  it('adds Kinora to a missing or empty config', () => {
    expect(JSON.parse(withKinoraEntry(null, entry))).toEqual({ mcpServers: { kinora: entry } });
    expect(JSON.parse(withKinoraEntry('  ', entry))).toEqual({ mcpServers: { kinora: entry } });
  });

  it('keeps every other setting and server', () => {
    const before = JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: { files: { command: 'npx', args: ['server-files'] } }, preferences: { x: 1 } });
    const after = JSON.parse(withKinoraEntry(before, entry));
    expect(after.globalShortcut).toBe('Ctrl+Space');
    expect(after.preferences).toEqual({ x: 1 });
    expect(after.mcpServers.files).toEqual({ command: 'npx', args: ['server-files'] });
    expect(after.mcpServers.kinora).toEqual(entry);
  });

  it('replaces an older Kinora entry and reads it back', () => {
    const old = withKinoraEntry(null, { command: 'old.exe', args: [] });
    const text = withKinoraEntry(old, entry);
    expect(kinoraEntryOf(text)).toEqual(entry);
    expect(kinoraEntryOf('{"mcpServers":{}}')).toBeNull();
    expect(kinoraEntryOf('not json')).toBeNull();
  });

  it('never overwrites a file it cannot read', () => {
    expect(() => withKinoraEntry('{ broken', entry)).toThrow();
    expect(() => withKinoraEntry('[1, 2]', entry)).toThrow();
  });

  it('accepts a byte-order mark', () => {
    expect(kinoraEntryOf(`\uFEFF${withKinoraEntry(null, entry)}`)).toEqual(entry);
  });

  it('removes only Kinora', () => {
    const text = withKinoraEntry(JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] } } }), entry);
    const removed = JSON.parse(withoutKinoraEntry(text)!);
    expect(removed.mcpServers).toEqual({ files: { command: 'npx', args: [] } });
    expect(withoutKinoraEntry(JSON.stringify(removed))).toBeNull();
    expect(withoutKinoraEntry(null)).toBeNull();
  });

  it('builds the Claude Code command with quoted paths', () => {
    const cmd = claudeCodeCommand(entry);
    expect(cmd).toBe('claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 kinora -- "C:\\Program Files\\Kinora\\Kinora.exe" "C:\\Program Files\\Kinora\\resources\\mcp\\kinora-mcp.cjs"');
  });
});

describe('tool definitions', () => {
  it('have unique names, titles and strict object schemas', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z_]{2,40}$/);
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      const props = Object.keys((t.inputSchema as { properties: object }).properties);
      for (const req of (t.inputSchema as { required: string[] }).required) expect(props).toContain(req);
    }
  });

  it('are all implemented by the editor', () => {
    const source = readFileSync('src/renderer/src/ui/claude/tools.ts', 'utf8');
    const table = source.slice(source.indexOf('const TOOLS: Record<'));
    for (const t of TOOLS) expect(table).toMatch(new RegExp(`\\n  ${t.name}: `));
  });
});

describe('MCP protocol', () => {
  function server(call = async (tool: string, args: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: `${tool}:${JSON.stringify(args)}` }] })) {
    const sent: Record<string, unknown>[] = [];
    let client = '';
    const s = createMcpServer({ version: '9.9.9', send: (m) => sent.push(m), call, onClient: (n) => (client = n) });
    return { s, sent, client: () => client };
  }

  it('initializes with the requested protocol version and reports the client', async () => {
    const { s, sent, client } = server();
    await s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } }));
    expect(sent[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kinora', version: '9.9.9' } } });
    expect(client()).toBe('claude-ai');
  });

  it('answers an unknown protocol version with its newest one', async () => {
    const { s, sent } = server();
    await s.handle({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((sent[0].result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it('lists the tools and forwards calls', async () => {
    const { s, sent } = server();
    await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((sent[0].result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);
    await s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set_playhead', arguments: { time: 2 } } });
    expect(sent[1]).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'set_playhead:{"time":2}' }] } });
  });

  it('reports failures as tool errors, unknown tools and methods as protocol errors', async () => {
    const { s, sent } = server(async () => {
      throw new Error('Kinora is not running.');
    });
    await s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_status', arguments: {} } });
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'Kinora is not running.' }], isError: true } });
    await s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'format_disk' } });
    expect(sent[1]).toMatchObject({ id: 5, error: { code: -32602 } });
    await s.handle({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect(sent[2]).toMatchObject({ id: 6, error: { code: -32601 } });
  });

  it('ignores notifications and responses, answers pings and bad JSON', async () => {
    const { s, sent } = server();
    await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await s.handle({ jsonrpc: '2.0', id: 9, result: {} });
    expect(sent).toHaveLength(0);
    await s.handle({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
    await s.handleLine('{nope');
    expect(sent[1]).toMatchObject({ id: null, error: { code: -32700 } });
  });
});
