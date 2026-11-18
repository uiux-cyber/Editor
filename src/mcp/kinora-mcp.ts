/**
 * Kinora's MCP server for Claude Desktop, Claude Code and other MCP clients.
 *
 * Claude Desktop runs it from Kinora's extension (Settings → Claude → Connect builds a .mcpb whose
 * server/index.js loads this file) with Claude's own Node.js; Claude Code and other MCP apps start
 * it with Kinora's own executable in Node mode:
 *   Kinora.exe <resources>\mcp\kinora-mcp.cjs      (env ELECTRON_RUN_AS_NODE=1)
 * It lists the tools by itself (so Claude sees them even while Kinora is closed) and forwards each
 * tool call over a local named pipe to the running app, starting Kinora when it isn't open.
 * The pipe and its token are in <user data>\claude-bridge.json, written by the app; only the
 * same Windows user can read that file.
 *
 * Environment: KINORA_EXE (Kinora's executable when this runs on another Node.js),
 * KINORA_USER_DATA (another profile), KINORA_APP_ARGS (JSON array of arguments to start the app
 * with, for development builds), KINORA_MCP_NO_LAUNCH=1 (tests: never start it).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { BRIDGE_FILE, textResult, type BridgeInfo, type BridgeRequest, type BridgeResponse, type ToolResult } from '../shared/claude';
import { createMcpServer } from './protocol';

declare const __KINORA_VERSION__: string;
const VERSION = typeof __KINORA_VERSION__ === 'string' ? __KINORA_VERSION__ : '0.0.0';

/** Most time a tool may take (some wait for the user to approve replacing a file). */
const CALL_TIMEOUT_MS = 15 * 60 * 1000;
/** How long to wait for Kinora to start. */
const START_TIMEOUT_MS = 60 * 1000;

const log = (...parts: unknown[]): void => {
  process.stderr.write(`[kinora-mcp] ${parts.map(String).join(' ')}\n`);
};

class UserError extends Error {}

function userDataDir(): string {
  if (process.env.KINORA_USER_DATA) return path.resolve(process.env.KINORA_USER_DATA);
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(roaming, 'Kinora');
}

function readInfo(): BridgeInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(userDataDir(), BRIDGE_FILE), 'utf8')) as BridgeInfo;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function launchApp(): void {
  let args: string[] = [];
  try {
    const parsed: unknown = JSON.parse(process.env.KINORA_APP_ARGS ?? '[]');
    if (Array.isArray(parsed)) args = parsed.map(String);
  } catch {
    /* no extra arguments */
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KINORA_APP_ARGS;
  delete env.KINORA_EXE;
  delete env.KINORA_MCP_SCRIPT;
  // In Claude's extension, Node is Claude's own: Kinora's executable comes from KINORA_EXE.
  // Started as `Kinora.exe kinora-mcp.cjs` (Claude Code), the executable is Kinora itself.
  const exe = process.env.KINORA_EXE || process.execPath;
  log(`starting Kinora (${exe})`);
  spawn(exe, args, { detached: true, stdio: 'ignore', env }).unref();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Connection to the app
// ---------------------------------------------------------------------------------------------

interface Connection {
  socket: net.Socket;
  pending: Map<number, { resolve: (r: ToolResult) => void; timer: ReturnType<typeof setTimeout> }>;
}

let clientName = 'Claude';
let connection: Connection | null = null;
let connecting: Promise<Connection> | null = null;
let nextId = 1;

function open(info: BridgeInfo): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(info.pipe!);
    const conn: Connection = { socket, pending: new Map() };
    let welcomed = false;
    const lines = readline.createInterface({ input: socket });
    socket.once('error', (err) => {
      if (!welcomed) reject(err);
    });
    socket.on('close', () => {
      if (connection === conn) connection = null;
      for (const [, p] of conn.pending) {
        clearTimeout(p.timer);
        p.resolve(textResult('Kinora closed before the task finished.', true));
      }
      conn.pending.clear();
      if (!welcomed) reject(new Error('Kinora closed the connection.'));
    });
    lines.on('line', (line) => {
      let msg: BridgeResponse;
      try {
        msg = JSON.parse(line) as BridgeResponse;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        welcomed = true;
        resolve(conn);
      } else if (msg.type === 'denied') {
        socket.destroy();
        reject(new UserError(msg.message));
      } else if (msg.type === 'result') {
        const p = conn.pending.get(msg.id);
        if (!p) return;
        conn.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.result);
      }
    });
    socket.once('connect', () => {
      const hello: BridgeRequest = { type: 'hello', token: info.token!, client: clientName };
      socket.write(`${JSON.stringify(hello)}\n`);
    });
  });
}

async function connect(): Promise<Connection> {
  if (connection && !connection.socket.destroyed) return connection;
  connecting ??= (async (): Promise<Connection> => {
    const deadline = Date.now() + START_TIMEOUT_MS;
    let launched = false;
    for (;;) {
      const info = readInfo();
      if (info && isAlive(info.pid)) {
        if (!info.enabled || !info.pipe || !info.token) throw new UserError('Claude access is turned off in Kinora. Turn it on in Kinora → Settings → Claude, then try again.');
        try {
          connection = await open(info);
          return connection;
        } catch (err) {
          if (err instanceof UserError) throw err;
          // The app may still be starting its pipe: retry until the deadline.
        }
      } else if (!launched) {
        if (process.env.KINORA_MCP_NO_LAUNCH === '1') throw new UserError('Kinora is not running. Open Kinora and try again.');
        launchApp();
        launched = true;
      }
      if (Date.now() > deadline) throw new UserError(launched ? 'Kinora did not start in time. Open Kinora and try again.' : 'Could not connect to Kinora. Restart Kinora and try again.');
      await sleep(400);
    }
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function callTool(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  let conn: Connection;
  try {
    conn = await connect();
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err), true);
  }
  const id = nextId++;
  return new Promise<ToolResult>((resolve) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      resolve(textResult(`Kinora did not finish "${tool}" within ${CALL_TIMEOUT_MS / 60000} minutes.`, true));
    }, CALL_TIMEOUT_MS);
    conn.pending.set(id, { resolve, timer });
    const req: BridgeRequest = { type: 'call', id, tool, args };
    conn.socket.write(`${JSON.stringify(req)}\n`);
  });
}

// ---------------------------------------------------------------------------------------------
// stdio
// ---------------------------------------------------------------------------------------------

const server = createMcpServer({
  version: VERSION,
  send: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
  call: callTool,
  onClient: (name) => {
    clientName = name;
  },
});

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => void server.handleLine(line));
input.on('close', () => {
  connection?.socket.end();
  process.exit(0);
});
log(`Kinora MCP server ${VERSION} ready`);
