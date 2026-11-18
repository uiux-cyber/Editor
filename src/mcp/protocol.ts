/**
 * The MCP side of the bridge: JSON-RPC 2.0 over stdio (one message per line), tools only.
 * Kept free of I/O so it can be unit-tested; kinora-mcp.ts wires it to stdin/stdout and the app.
 */

import { MCP_PROTOCOL_VERSIONS, SERVER_INSTRUCTIONS, TOOLS, TOOL_NAMES, textResult, type ToolResult } from '../shared/claude';

type Json = Record<string, unknown>;

export interface McpServerOptions {
  version: string;
  /** Write one JSON-RPC message. */
  send: (message: Json) => void;
  /** Run a tool in Kinora. */
  call: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Told the client's name once it introduces itself (shown in Kinora). */
  onClient?: (name: string) => void;
}

export function createMcpServer(opts: McpServerOptions): { handle: (message: unknown) => Promise<void>; handleLine: (line: string) => Promise<void> } {
  const reply = (id: unknown, result: unknown): void => opts.send({ jsonrpc: '2.0', id, result });
  const fail = (id: unknown, code: number, message: string): void => opts.send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message: unknown): Promise<void> {
    if (Array.isArray(message)) {
      await Promise.all(message.map(handle));
      return;
    }
    if (!message || typeof message !== 'object') {
      fail(null, -32600, 'Invalid request');
      return;
    }
    const { id, method, params } = message as { id?: unknown; method?: unknown; params?: Json };
    // Responses from the client (we never send requests) and notifications need no answer.
    if (typeof method !== 'string') return;
    const isRequest = id !== undefined && id !== null;
    if (!isRequest) return;
    try {
      switch (method) {
        case 'initialize': {
          const info = params?.clientInfo as { name?: unknown } | undefined;
          if (typeof info?.name === 'string' && info.name) opts.onClient?.(info.name);
          const requested = params?.protocolVersion;
          reply(id, {
            protocolVersion: typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'kinora', title: 'Kinora', version: opts.version },
            instructions: SERVER_INSTRUCTIONS,
          });
          return;
        }
        case 'ping':
          reply(id, {});
          return;
        case 'tools/list':
          reply(id, { tools: TOOLS });
          return;
        case 'tools/call': {
          const name = params?.name;
          const args = params?.arguments;
          if (typeof name !== 'string' || !TOOL_NAMES.has(name)) {
            fail(id, -32602, `Unknown tool: ${String(name)}`);
            return;
          }
          let result: ToolResult;
          try {
            result = await opts.call(name, args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {});
          } catch (err) {
            result = textResult(err instanceof Error ? err.message : String(err), true);
          }
          reply(id, result);
          return;
        }
        default:
          fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      fail(id, -32603, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, 'Parse error');
      return;
    }
    await handle(message);
  }

  return { handle, handleLine };
}
