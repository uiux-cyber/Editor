import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { MEDIA_EXTS, PROJECT_EXT, extOf, type FileInfo } from '@shared/ipc';
import {
  BRIDGE_FILE,
  CLAUDE_ENABLED_SETTING,
  claudeCodeCommand,
  kinoraEntryOf,
  textResult,
  withKinoraEntry,
  withoutKinoraEntry,
  type BridgeInfo,
  type BridgeRequest,
  type BridgeResponse,
  type McpServerEntry,
  type ToolResult,
} from '@shared/claude';
import type { MainContext } from '../context';

/**
 * Kinora as a Claude connector, main-process side.
 *
 *  - A named-pipe server the MCP bridge (src/mcp/kinora-mcp.ts) connects to. Only clients that
 *    present the random token from <user data>\claude-bridge.json are accepted; the file lives in
 *    the user's own profile, so only the same Windows user can use the pipe. The server runs only
 *    while Claude access is on (Settings → Claude).
 *  - Tool calls are forwarded to the renderer (`x:claude:call`), which runs them on the open
 *    project and answers with `x:claude:reply`.
 *  - "Connect to Claude Desktop" adds Kinora to claude_desktop_config.json (both the regular and
 *    the Microsoft Store install locations), keeping everything else in the file.
 *  - File access for tools: Claude may read media / projects the user names, and write only new
 *    files; replacing an existing file needs the user's approval in Kinora first (renderer).
 */

interface Client {
  id: number;
  name: string;
  socket: net.Socket;
  since: number;
}

export interface ClaudeClientInfo {
  id: number;
  name: string;
  since: number;
}

export interface ClaudeStatus {
  enabled: boolean;
  clients: ClaudeClientInfo[];
  /** Claude Desktop config folders found on this PC. */
  desktopDirs: string[];
  /** Kinora is in Claude Desktop's config (in at least one of them). */
  desktopConnected: boolean;
  /** Command that adds Kinora to Claude Code. */
  claudeCode: string;
  /** The bridge script exists (missing in a development build that was not fully built). */
  bridgeReady: boolean;
}

const CALL_TIMEOUT_MS = 15 * 60 * 1000;
const WRITE_EXTS = new Set(['mp4', 'mov', 'webm', 'gif', 'mp3', 'wav', 'png', PROJECT_EXT, 'srt', 'vtt']);

const norm = (p: string): string => path.normalize(p);

export default function register(ctx: MainContext): void {
  // Tests can redirect the Claude Desktop config folder (only together with KINORA_E2E_DIR).
  const testConfigDir = ctx.e2eDir && process.env.KINORA_CLAUDE_CONFIG_DIR ? path.resolve(process.env.KINORA_CLAUDE_CONFIG_DIR) : null;
  const bridgeFile = (): string => path.join(ctx.userData(), BRIDGE_FILE);

  let enabled = ctx.settings.get<boolean>(CLAUDE_ENABLED_SETTING, false) === true;
  let server: net.Server | null = null;
  let pipe: string | null = null;
  let token: string | null = null;
  const clients = new Set<Client>();
  let nextClient = 1;
  let nextCall = 1;
  const pending = new Map<number, { client: Client; reqId: number; timer: ReturnType<typeof setTimeout> }>();
  let rendererReady = false;
  const queue: { callId: number; tool: string; args: Record<string, unknown>; client: string }[] = [];

  const write = (socket: net.Socket, msg: BridgeResponse): void => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(msg)}\n`);
  };

  const clientList = (): ClaudeClientInfo[] => [...clients].map((c) => ({ id: c.id, name: c.name, since: c.since }));
  const publishClients = (): void => ctx.send('x:claude:clients', clientList());

  function writeBridgeFile(): void {
    const info: BridgeInfo = { pid: process.pid, version: app.getVersion(), enabled, ...(enabled && pipe && token ? { pipe, token } : {}) };
    try {
      fs.mkdirSync(path.dirname(bridgeFile()), { recursive: true });
      const tmp = `${bridgeFile()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
      fs.renameSync(tmp, bridgeFile());
    } catch (err) {
      console.warn('[claude] could not write the bridge file', err);
    }
  }

  function removeBridgeFile(): void {
    try {
      const info = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8')) as BridgeInfo;
      if (info.pid === process.pid) fs.unlinkSync(bridgeFile());
    } catch {
      /* not ours or already gone */
    }
  }

  function tokenOk(given: unknown): boolean {
    if (!token || typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function finish(callId: number, result: ToolResult): void {
    const p = pending.get(callId);
    if (!p) return;
    pending.delete(callId);
    clearTimeout(p.timer);
    write(p.client.socket, { type: 'result', id: p.reqId, result });
  }

  function dispatch(client: Client, reqId: number, tool: string, args: Record<string, unknown>): void {
    const callId = nextCall++;
    const timer = setTimeout(() => finish(callId, textResult(`Kinora did not finish "${tool}" in time.`, true)), CALL_TIMEOUT_MS);
    pending.set(callId, { client, reqId, timer });
    const call = { callId, tool, args, client: client.name };
    if (rendererReady && ctx.window()) ctx.send('x:claude:call', call);
    else queue.push(call);
  }

  function onConnection(socket: net.Socket): void {
    let client: Client | null = null;
    const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line) => {
      let msg: BridgeRequest;
      try {
        msg = JSON.parse(line) as BridgeRequest;
      } catch {
        socket.destroy();
        return;
      }
      if (!client) {
        if (msg.type !== 'hello' || !tokenOk(msg.token)) {
          write(socket, { type: 'denied', message: 'Kinora refused the connection. Restart Claude and try again.' });
          socket.end();
          return;
        }
        if (!enabled) {
          write(socket, { type: 'denied', message: 'Claude access is turned off in Kinora. Turn it on in Kinora → Settings → Claude.' });
          socket.end();
          return;
        }
        client = { id: nextClient++, name: String(msg.client || 'Claude').slice(0, 60), socket, since: Date.now() };
        clients.add(client);
        write(socket, { type: 'welcome', version: app.getVersion() });
        publishClients();
        return;
      }
      if (msg.type === 'call' && typeof msg.id === 'number' && typeof msg.tool === 'string') {
        dispatch(client, msg.id, msg.tool, msg.args && typeof msg.args === 'object' ? msg.args : {});
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (!client) return;
      clients.delete(client);
      for (const [id, p] of pending) if (p.client === client) {
        clearTimeout(p.timer);
        pending.delete(id);
      }
      publishClients();
    });
  }

  function start(): void {
    if (server) return;
    token = randomBytes(24).toString('hex');
    pipe = `\\\\.\\pipe\\kinora-claude-${process.pid}-${randomBytes(6).toString('hex')}`;
    server = net.createServer(onConnection);
    server.on('error', (err) => console.warn('[claude] pipe server error', err));
    server.listen(pipe, () => writeBridgeFile());
  }

  function stop(): void {
    for (const c of clients) c.socket.destroy();
    clients.clear();
    server?.close();
    server = null;
    pipe = null;
    token = null;
    publishClients();
  }

  function setEnabled(on: boolean): void {
    enabled = on;
    ctx.settings.set(CLAUDE_ENABLED_SETTING, on);
    if (on) start();
    else stop();
    writeBridgeFile();
  }

  // ---- Claude Desktop / Claude Code ---------------------------------------------------------

  function bridgeScript(): string {
    return app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'kinora-mcp.cjs') : path.join(app.getAppPath(), 'out', 'mcp', 'kinora-mcp.cjs');
  }

  function serverEntry(): McpServerEntry {
    const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
    if (!app.isPackaged) env.KINORA_APP_ARGS = JSON.stringify([app.getAppPath()]);
    if (process.env.KINORA_USER_DATA) env.KINORA_USER_DATA = ctx.userData();
    return { command: process.execPath, args: [bridgeScript()], env };
  }

  /** Claude Desktop config folders: the regular install and the Microsoft Store one. */
  function desktopDirs(): string[] {
    if (testConfigDir) return fs.existsSync(testConfigDir) ? [testConfigDir] : [];
    const dirs: string[] = [];
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Claude'));
    if (process.env.LOCALAPPDATA) {
      const packages = path.join(process.env.LOCALAPPDATA, 'Packages');
      try {
        for (const d of fs.readdirSync(packages)) if (/^Claude_/i.test(d)) dirs.push(path.join(packages, d, 'LocalCache', 'Roaming', 'Claude'));
      } catch {
        /* no Store apps folder */
      }
    }
    return dirs.filter((d) => fs.existsSync(d));
  }

  const configFile = (dir: string): string => path.join(dir, 'claude_desktop_config.json');
  const readText = async (file: string): Promise<string | null> => fsp.readFile(file, 'utf8').catch(() => null);

  async function writeAtomic(file: string, text: string): Promise<void> {
    const tmp = `${file}.kinora-${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, file);
  }

  async function status(): Promise<ClaudeStatus> {
    const dirs = desktopDirs();
    let connected = false;
    for (const d of dirs) if (kinoraEntryOf(await readText(configFile(d)))) connected = true;
    return { enabled, clients: clientList(), desktopDirs: dirs, desktopConnected: connected, claudeCode: claudeCodeCommand(serverEntry()), bridgeReady: fs.existsSync(bridgeScript()) };
  }

  ctx.handle('x:claude:status', status);
  ctx.handle('x:claude:setEnabled', async (on: boolean) => {
    setEnabled(on === true);
    return status();
  });

  ctx.handle('x:claude:connectDesktop', async (): Promise<{ ok: boolean; error?: string; status: ClaudeStatus }> => {
    const dirs = desktopDirs();
    if (dirs.length === 0) return { ok: false, error: 'not-installed', status: await status() };
    const entry = serverEntry();
    const failed: string[] = [];
    for (const d of dirs) {
      const file = configFile(d);
      try {
        await writeAtomic(file, withKinoraEntry(await readText(file), entry));
      } catch (err) {
        console.warn('[claude] could not update', file, err);
        failed.push(file);
      }
    }
    if (failed.length === dirs.length) return { ok: false, error: 'unreadable', status: await status() };
    setEnabled(true);
    return { ok: true, status: await status() };
  });

  ctx.handle('x:claude:disconnectDesktop', async (): Promise<ClaudeStatus> => {
    for (const d of desktopDirs()) {
      const file = configFile(d);
      try {
        const next = withoutKinoraEntry(await readText(file));
        if (next !== null) await writeAtomic(file, next);
      } catch (err) {
        console.warn('[claude] could not update', file, err);
      }
    }
    return status();
  });

  // ---- Renderer side of tool calls ----------------------------------------------------------

  ctx.handle('x:claude:ready', () => {
    rendererReady = true;
    while (queue.length) ctx.send('x:claude:call', queue.shift());
  });

  ctx.handle('x:claude:reply', (callId: number, result: ToolResult) => {
    const ok = result && Array.isArray(result.content);
    finish(Number(callId), ok ? result : textResult('Kinora returned an invalid result.', true));
  });

  ctx.handle('x:claude:attention', () => {
    const win = ctx.window();
    if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  });

  // ---- File access for tools ----------------------------------------------------------------

  /** Media files Claude was asked to import: existing files with a media extension. */
  ctx.handle('x:claude:approveMedia', async (paths: unknown): Promise<{ files: FileInfo[]; problems: string[] }> => {
    const files: FileInfo[] = [];
    const problems: string[] = [];
    for (const raw of Array.isArray(paths) ? paths.slice(0, 200) : []) {
      const p = typeof raw === 'string' ? raw.trim() : '';
      if (!p || !path.isAbsolute(p)) {
        problems.push(`${String(raw)}: use an absolute path`);
        continue;
      }
      if (!MEDIA_EXTS.includes(extOf(p))) {
        problems.push(`${p}: not a supported media file`);
        continue;
      }
      const info = await ctx.statFile(norm(p));
      if (!info.exists) {
        problems.push(`${p}: file not found`);
        continue;
      }
      ctx.approveRead(info.path);
      files.push(info);
    }
    return { files, problems };
  });

  /** A project file to open: read it, and save back to it later. */
  ctx.handle('x:claude:approveProject', async (p: unknown): Promise<string> => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || extOf(p) !== PROJECT_EXT) throw new Error('Give the absolute path of a .kinora file.');
    const info = await ctx.statFile(norm(p));
    if (!info.exists) throw new Error(`File not found: ${p}`);
    ctx.approveRead(info.path);
    ctx.approveWrite(info.path);
    return info.path;
  });

  /** Check an output path before writing; `exists` means the user must approve replacing it. */
  ctx.handle('x:claude:checkOutput', async (p: unknown, exts: unknown): Promise<{ path: string; exists: boolean }> => {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('Give an absolute output path.');
    const file = norm(p);
    const ext = extOf(file);
    const allowed = Array.isArray(exts) ? exts.map(String).filter((e) => WRITE_EXTS.has(e)) : [];
    if (!allowed.includes(ext)) throw new Error(`The file name must end in ${allowed.map((e) => `.${e}`).join(' or ')}.`);
    const dir = await fsp.stat(path.dirname(file)).catch(() => null);
    if (!dir?.isDirectory()) throw new Error(`Folder not found: ${path.dirname(file)}`);
    const existing = await fsp.stat(file).catch(() => null);
    if (existing?.isDirectory()) throw new Error(`${file} is a folder.`);
    return { path: file, exists: !!existing };
  });

  /** Allow writing an output checked above (after the user approved replacing it, if needed). */
  ctx.handle('x:claude:approveOutput', async (p: unknown) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !WRITE_EXTS.has(extOf(p))) throw new Error('Invalid output path.');
    ctx.approveWrite(norm(p));
  });

  /** New, non-clashing files in a folder (several exports at once): never replaces anything. */
  ctx.handle('x:claude:filesInFolder', async (dir: unknown, names: unknown): Promise<string[]> => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Give an absolute folder path.');
    const folder = norm(dir);
    const st = await fsp.stat(folder).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Folder not found: ${folder}`);
    const taken = new Set<string>();
    const out: string[] = [];
    for (const raw of Array.isArray(names) ? names.map(String) : []) {
      const clean = ctx.sanitizeName(raw) || 'Kinora export';
      const ext = path.extname(clean);
      const base = clean.slice(0, clean.length - ext.length);
      let candidate = path.join(folder, clean);
      for (let n = 2; fs.existsSync(candidate) || taken.has(candidate.toLowerCase()); n++) candidate = path.join(folder, `${base} (${n})${ext}`);
      if (!WRITE_EXTS.has(extOf(candidate))) throw new Error(`Unsupported output type: ${candidate}`);
      taken.add(candidate.toLowerCase());
      ctx.approveWrite(candidate);
      out.push(candidate);
    }
    return out;
  });

  // ---- Lifecycle ----------------------------------------------------------------------------

  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-start-loading', () => {
      rendererReady = false;
    });
  });
  app.on('will-quit', () => {
    stop();
    removeBridgeFile();
  });

  if (enabled) start();
  writeBridgeFile();
}
