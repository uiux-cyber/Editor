import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { app, shell } from 'electron';
import { MEDIA_EXTS, PROJECT_EXT, extOf, type FileInfo } from '@shared/ipc';
import {
  BRIDGE_FILE,
  CLAUDE_ENABLED_SETTING,
  EXTENSION_FILE,
  EXTENSION_LOADER,
  claudeCodeCommand,
  extensionManifest,
  textResult,
  withoutKinoraEntry,
  type BridgeInfo,
  type BridgeRequest,
  type BridgeResponse,
  type McpServerEntry,
  type ToolResult,
} from '@shared/claude';
import { writeZip } from '@shared/zip';
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
 *  - "Connect" builds a Claude Desktop extension (Kinora.mcpb) with this installation's paths and
 *    opens it, so Claude Desktop shows its own "Install" dialog: no config files to find or edit
 *    (their location differs between Claude Desktop versions). It also removes the
 *    claude_desktop_config.json entries Kinora 1.3.0 wrote, so Claude never runs Kinora twice.
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
  /** Claude Desktop seems to be installed. */
  desktopFound: boolean;
  /** The last Claude app that connected, and when. */
  lastSeen: { name: string; at: number } | null;
  /** Command that adds Kinora to Claude Code. */
  claudeCode: string;
  /** The bridge script exists (missing in a development build that was not fully built). */
  bridgeReady: boolean;
}

const CALL_TIMEOUT_MS = 15 * 60 * 1000;
const LAST_SEEN_SETTING = 'claude.lastSeen';
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
        ctx.settings.set(LAST_SEEN_SETTING, { name: client.name, at: client.since });
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

  /**
   * Folders where Claude Desktop versions keep claude_desktop_config.json: the classic install,
   * the Microsoft Store install's virtualised copy, and the Claude-Data folder of newer versions.
   * Only used to remove the entries Kinora 1.3.0 wrote there.
   */
  function legacyConfigDirs(): string[] {
    if (testConfigDir) return fs.existsSync(testConfigDir) ? [testConfigDir] : [];
    const dirs: string[] = [];
    const local = process.env.LOCALAPPDATA;
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Claude'));
    if (local) {
      const list = (dir: string): string[] => {
        try {
          return fs.readdirSync(dir);
        } catch {
          return [];
        }
      };
      for (const d of list(path.join(local, 'Packages'))) if (/^Claude_/i.test(d)) dirs.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude'));
      for (const d of list(path.join(local, 'Claude-Data'))) if (/^claude_/i.test(d)) dirs.push(path.join(local, 'Claude-Data', d));
    }
    return dirs.filter((d) => fs.existsSync(d));
  }

  /** Whether Claude Desktop seems installed (any of its known folders exists). */
  function desktopFound(): boolean {
    if (testConfigDir) return true;
    const local = process.env.LOCALAPPDATA ?? '';
    return legacyConfigDirs().length > 0 || fs.existsSync(path.join(local, 'AnthropicClaude')) || fs.existsSync(path.join(local, 'Claude'));
  }

  const configFile = (dir: string): string => path.join(dir, 'claude_desktop_config.json');
  const readText = async (file: string): Promise<string | null> => fsp.readFile(file, 'utf8').catch(() => null);

  async function writeAtomic(file: string, text: string): Promise<void> {
    const tmp = `${file}.kinora-${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, file);
  }

  /** Remove Kinora entries from claude_desktop_config.json files (left by Kinora 1.3.0). */
  async function removeLegacyEntries(): Promise<number> {
    let removed = 0;
    for (const d of legacyConfigDirs()) {
      const file = configFile(d);
      try {
        const next = withoutKinoraEntry(await readText(file));
        if (next !== null) {
          await writeAtomic(file, next);
          removed++;
        }
      } catch (err) {
        console.warn('[claude] could not update', file, err);
      }
    }
    return removed;
  }

  async function status(): Promise<ClaudeStatus> {
    const lastSeen = ctx.settings.get<{ name: string; at: number } | null>(LAST_SEEN_SETTING, null) ?? null;
    return { enabled, clients: clientList(), desktopFound: desktopFound(), lastSeen, claudeCode: claudeCodeCommand(serverEntry()), bridgeReady: fs.existsSync(bridgeScript()) };
  }

  /** Build Kinora.mcpb for this installation. */
  async function buildExtension(): Promise<string> {
    const script = bridgeScript();
    const enc = new TextEncoder();
    const manifest = extensionManifest({
      version: app.getVersion(),
      exe: process.execPath,
      script,
      userData: ctx.userData(),
      appArgs: app.isPackaged ? undefined : [app.getAppPath()],
    });
    const iconFile = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'resources', 'icon.png');
    const icon = await fsp.readFile(iconFile).catch(() => null);
    if (!icon) delete manifest.icon;
    const entries = [
      { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2) + '\n') },
      { name: 'server/index.js', data: enc.encode(EXTENSION_LOADER) },
      { name: 'server/kinora-mcp.cjs', data: new Uint8Array(await fsp.readFile(script)) },
      ...(icon ? [{ name: 'icon.png', data: new Uint8Array(icon) }] : []),
    ];
    const zip = writeZip(entries, (d) => new Uint8Array(zlib.deflateRawSync(d, { level: 9 })));
    const dir = ctx.e2eDir ?? ctx.userData();
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, EXTENSION_FILE);
    await fsp.writeFile(file, zip);
    return file;
  }

  ctx.handle('x:claude:status', status);
  ctx.handle('x:claude:setEnabled', async (on: boolean) => {
    setEnabled(on === true);
    return status();
  });

  /**
   * Connect: build the extension and open it, so Claude Desktop asks to install it. Returns the
   * file (for "Show file") and whether Windows could open it with Claude Desktop.
   */
  ctx.handle('x:claude:installExtension', async (): Promise<{ file: string; opened: boolean; cleaned: number; status: ClaudeStatus }> => {
    if (!fs.existsSync(bridgeScript())) throw new Error('This build of Kinora is missing its Claude connector (resources\mcp).');
    const file = await buildExtension();
    const cleaned = await removeLegacyEntries();
    setEnabled(true);
    // Tests never hand the file to Claude Desktop.
    const opened = ctx.e2eDir ? false : (await shell.openPath(file)) === '';
    return { file, opened, cleaned, status: await status() };
  });

  ctx.handle('x:claude:showExtension', async () => {
    const file = path.join(ctx.e2eDir ?? ctx.userData(), EXTENSION_FILE);
    if (fs.existsSync(file) && !ctx.e2eDir) shell.showItemInFolder(file);
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
