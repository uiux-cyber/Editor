import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, session, shell } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { MainContext } from './context';
import { isLottieFile } from './lottieGuard';
import {
  APP_NAME,
  AUDIO_EXTS,
  IMAGE_EXTS,
  LOTTIE_EXTS,
  MEDIA_EXTS,
  MEDIA_SCHEME,
  PROJECT_EXT,
  VIDEO_EXTS,
  extOf,
  type AppInfo,
  type AutosaveEntry,
  type FileInfo,
  type RecentProject,
  type SaveDialogFilter,
} from '@shared/ipc';

// ---------------------------------------------------------------------------------------------
// Boot configuration (must run before `app.whenReady`)
// ---------------------------------------------------------------------------------------------

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;

if (process.env.KINORA_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.KINORA_USER_DATA));
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.kinora.studio');

// Prefer the discrete GPU on hybrid-graphics laptops: compositing and encoding are GPU bound.
app.commandLine.appendSwitch('force_high_performance_gpu');
// Keep media pipelines alive when the window is occluded (long exports).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------------------------------------------------------------------------------------------
// Small JSON settings store
// ---------------------------------------------------------------------------------------------

class JsonStore {
  private data: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      this.data = {};
    }
  }
  get<T>(key: string, fallback?: T): T | undefined {
    return (key in this.data ? (this.data[key] as T) : fallback) as T | undefined;
  }
  set(key: string, value: unknown): void {
    if (value === undefined) delete this.data[key];
    else this.data[key] = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[settings] failed to persist', err);
    }
  }
}

let store: JsonStore;
let mainWindow: BrowserWindow | null = null;
let documentDirty = false;
let closeConfirmed = false;
let keepAwakeId: number | null = null;
let startupProject: string | null = null;

// Paths the renderer is allowed to read/write as project documents or export targets. They are
// only ever added from a native dialog, the recent list, the command line or the app's own folders.
const approvedRead = new Set<string>();
const approvedWrite = new Set<string>();
const normPath = (p: string): string => path.resolve(p).toLowerCase();

function approveRead(p: string): void {
  approvedRead.add(normPath(p));
}
function approveWrite(p: string): void {
  approvedWrite.add(normPath(p));
}
function assertRead(p: string): void {
  if (!approvedRead.has(normPath(p))) throw new Error('Access to this file has not been granted.');
}
// Automated tests set KINORA_E2E_DIR: writes inside that folder skip the native save dialog.
const e2eDir = process.env.KINORA_E2E_DIR ? path.resolve(process.env.KINORA_E2E_DIR) : null;
const insideE2eDir = (p: string): boolean => !!e2eDir && normPath(p).startsWith(normPath(e2eDir) + path.sep);

function assertWrite(p: string): void {
  if (insideE2eDir(p)) return;
  if (!approvedWrite.has(normPath(p))) throw new Error('Writing to this location has not been granted.');
}

function findProjectArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (extOf(arg) === PROJECT_EXT && fs.existsSync(arg)) return path.resolve(arg);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// kinora:// protocol — serves the renderer bundle and streams local media with range support
// ---------------------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  apng: 'image/apng',
  lottie: 'application/zip',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  '3gp': 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  onnx: 'application/octet-stream',
  tflite: 'application/octet-stream',
  bin: 'application/octet-stream',
  txt: 'text/plain; charset=utf-8',
  cube: 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  `media-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  `connect-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

async function serveFile(request: Request, filePath: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const size = stat.size;
  const headers: Record<string, string> = {
    'Content-Type': MIME[extOf(filePath)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cache-Control': 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
    ...extraHeaders,
  };
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response('Bad range', { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    let start: number;
    let end: number;
    if (m[1] === '') {
      const suffix = Math.min(size, parseInt(m[2], 10));
      start = size - suffix;
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] === '' ? size - 1 : Math.min(size - 1, parseInt(m[2], 10));
    }
    if (start >= size || start > end) {
      return new Response('Range not satisfiable', { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 1 << 20 });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}

/** Bundled AI models: KINORA_MODELS_DIR, else <resources>/models when installed, else ./resources/models. */
function modelsDir(): string {
  if (process.env.KINORA_MODELS_DIR) return path.resolve(process.env.KINORA_MODELS_DIR);
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'resources', 'models');
}

// Cross-origin isolation enables SharedArrayBuffer (multi-threaded WebAssembly for on-device AI).
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

function registerProtocol(): void {
  const rendererRoot = path.join(__dirname, '../renderer');
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'media') {
        const filePath = url.searchParams.get('path');
        if (!filePath || !path.isAbsolute(filePath)) return new Response('Bad request', { status: 400 });
        if (!MEDIA_EXTS.includes(extOf(filePath))) return new Response('Forbidden', { status: 403 });
        // JSON / .lottie are only readable when the file is a Lottie animation (lottieGuard.ts).
        if (LOTTIE_EXTS.includes(extOf(filePath)) && !(await isLottieFile(path.normalize(filePath)))) return new Response('Forbidden', { status: 403 });
        return await serveFile(request, path.normalize(filePath));
      }
      if (url.hostname === 'models') {
        const root = modelsDir();
        const filePath = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
        if (!filePath.startsWith(root)) return new Response('Forbidden', { status: 403 });
        return await serveFile(request, filePath, { 'Cache-Control': 'max-age=31536000' });
      }
      if (url.hostname === 'app') {
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/' || rel === '') rel = '/index.html';
        const filePath = path.normalize(path.join(rendererRoot, rel));
        if (!filePath.startsWith(rendererRoot)) return new Response('Forbidden', { status: 403 });
        const isHtml = extOf(filePath) === 'html';
        return await serveFile(request, filePath, isHtml ? { 'Content-Security-Policy': CSP, ...ISOLATION } : { 'Cache-Control': 'max-age=31536000' });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('[protocol]', err);
      return new Response('Internal error', { status: 500 });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

function createWindow(): void {
  const state = store.get<WindowState>('windowState', { width: 1600, height: 960, maximized: true })!;
  // nativeTheme.themeSource and the title-bar colours follow the user's theme: see handlers/theme.ts.

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b0c10',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0c10', symbolColor: '#aab1c0', height: 40 },
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (documentDirty && !closeConfirmed) {
      e.preventDefault();
      win.webContents.send('app:closeRequested');
      return;
    }
    const bounds = win.getNormalBounds();
    store.set('windowState', { ...bounds, maximized: win.isMaximized() } satisfies WindowState);
    store.flush();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  // The editor is a local, single-page app: never navigate away or spawn windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const current = win.webContents.getURL();
    if (url !== current) e.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
    }
    if (isDev && input.control && input.key.toLowerCase() === 'r') win.webContents.reload();
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details);
    if (details.reason !== 'clean-exit') {
      void dialog
        .showMessageBox(win, {
          type: 'error',
          title: APP_NAME,
          message: 'The editor ran into a problem and needs to reload.',
          detail: 'Your project was autosaved and can be recovered from the start screen.',
          buttons: ['Reload'],
        })
        .then(() => win.webContents.reload());
    }
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void win.loadURL(`${MEDIA_SCHEME}://app/index.html`);
  }
}

// ---------------------------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------------------------

async function statFile(p: string): Promise<FileInfo> {
  const name = path.basename(p);
  try {
    const s = await fsp.stat(p);
    return { path: p, name, ext: extOf(name), size: s.size, mtimeMs: s.mtimeMs, exists: s.isFile() };
  } catch {
    return { path: p, name, ext: extOf(name), size: 0, mtimeMs: 0, exists: false };
  }
}

function getRecent(): RecentProject[] {
  return store.get<RecentProject[]>('recentProjects', [])!;
}

const writeHandles = new Map<number, { handle: fsp.FileHandle; path: string }>();
let nextHandle = 1;

function autosaveDir(): string {
  return path.join(app.getPath('userData'), 'autosave');
}
const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'project';

function registerIpc(): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      // Only our own window may talk to the main process.
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unauthorized IPC sender');
      return fn(...args);
    });
  };

  handle('app:info', (): AppInfo => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    isDev,
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    videos: app.getPath('videos'),
  }));
  handle('app:getRecent', async (): Promise<RecentProject[]> => {
    const list = getRecent();
    const checked = await Promise.all(list.map(async (r) => ({ r, ok: (await statFile(r.path)).exists })));
    const alive = checked.filter((c) => c.ok).map((c) => c.r);
    alive.forEach((r) => {
      approveRead(r.path);
      approveWrite(r.path);
    });
    return alive;
  });
  handle('app:addRecent', (entry: RecentProject) => {
    if (!entry || typeof entry.path !== 'string') return;
    const list = getRecent().filter((r) => normPath(r.path) !== normPath(entry.path));
    list.unshift({ ...entry, openedAt: Date.now() });
    store.set('recentProjects', list.slice(0, 24));
    app.addRecentDocument(entry.path);
  });
  handle('app:removeRecent', (p: string) => {
    store.set('recentProjects', getRecent().filter((r) => normPath(r.path) !== normPath(p)));
  });
  handle('app:showItemInFolder', (p: string) => {
    if (typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(path.normalize(p));
  });
  handle('app:openPath', async (p: string) => {
    // Only open things the app itself produced or was given through a dialog.
    if (typeof p !== 'string' || !path.isAbsolute(p) || e2eDir) return;
    if (!approvedWrite.has(normPath(p)) && !approvedRead.has(normPath(p))) return;
    await shell.openPath(path.normalize(p));
  });
  handle('app:openExternal', async (url: string) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) await shell.openExternal(url);
  });
  handle('app:setTitle', (title: string) => {
    mainWindow?.setTitle(String(title).slice(0, 200));
  });
  handle('app:setDirty', (dirty: boolean) => {
    documentDirty = !!dirty;
  });
  handle('app:confirmClose', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });
  handle('app:keepAwake', (on: boolean) => {
    if (on && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
    if (!on && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
  });
  handle('app:setProgress', (value: number) => {
    mainWindow?.setProgressBar(typeof value === 'number' && value >= 0 && value <= 1 ? value : -1);
  });
  handle('app:getStartupProject', () => {
    const p = startupProject;
    startupProject = null;
    if (p) {
      approveRead(p);
      approveWrite(p);
    }
    return p;
  });

  handle('settings:get', (key: string) => store.get(`user.${key}`));
  handle('settings:set', (key: string, value: unknown) => store.set(`user.${key}`, value));

  handle('dialog:openMedia', async (): Promise<FileInfo[]> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: MEDIA_EXTS },
        { name: 'Video', extensions: VIDEO_EXTS },
        { name: 'Audio', extensions: AUDIO_EXTS },
        { name: 'Images', extensions: IMAGE_EXTS },
        { name: 'Animations (GIF, WebP, APNG, Lottie)', extensions: ['gif', 'webp', 'png', 'apng', ...LOTTIE_EXTS] },
      ],
    });
    if (res.canceled) return [];
    return Promise.all(res.filePaths.map(statFile));
  });
  handle('dialog:locateMedia', async (name: string): Promise<FileInfo | null> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: `Locate "${name}"`,
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: MEDIA_EXTS }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return statFile(res.filePaths[0]);
  });
  handle('dialog:openProject', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: `${APP_NAME} project`, extensions: [PROJECT_EXT] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    approveRead(res.filePaths[0]);
    approveWrite(res.filePaths[0]);
    return res.filePaths[0];
  });
  handle('dialog:saveProject', async (defaultName: string): Promise<string | null> => {
    if (e2eDir) {
      const file = path.join(e2eDir, `${sanitizeName(defaultName)}.${PROJECT_EXT}`);
      approveRead(file);
      approveWrite(file);
      return file;
    }
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save project',
      defaultPath: path.join(app.getPath('documents'), `${sanitizeName(defaultName)}.${PROJECT_EXT}`),
      filters: [{ name: `${APP_NAME} project`, extensions: [PROJECT_EXT] }],
    });
    if (res.canceled || !res.filePath) return null;
    approveRead(res.filePath);
    approveWrite(res.filePath);
    return res.filePath;
  });
  handle('dialog:saveFile', async (defaultName: string, filters: SaveDialogFilter[]): Promise<string | null> => {
    if (e2eDir) return path.join(e2eDir, sanitizeName(defaultName));
    const lastDir = store.get<string>('lastExportDir') ?? app.getPath('videos');
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export',
      defaultPath: path.join(fs.existsSync(lastDir) ? lastDir : app.getPath('videos'), sanitizeName(defaultName)),
      filters: Array.isArray(filters) ? filters : [],
    });
    if (res.canceled || !res.filePath) return null;
    store.set('lastExportDir', path.dirname(res.filePath));
    approveWrite(res.filePath);
    return res.filePath;
  });
  handle('dialog:message', async (opts: { type?: 'info' | 'warning' | 'error' | 'question'; title: string; message: string; detail?: string; buttons?: string[] }) => {
    const res = await dialog.showMessageBox(mainWindow!, {
      type: opts.type ?? 'info',
      title: opts.title ?? APP_NAME,
      message: String(opts.message ?? ''),
      detail: opts.detail,
      buttons: opts.buttons ?? ['OK'],
      noLink: true,
    });
    return res.response;
  });

  handle('fs:stat', (paths: string[]) => Promise.all((Array.isArray(paths) ? paths : []).map((p) => statFile(String(p)))));
  handle('fs:readProject', async (p: string) => {
    assertRead(p);
    return fsp.readFile(p, 'utf8');
  });
  handle('fs:writeProject', async (p: string, data: string) => {
    assertWrite(p);
    if (extOf(p) !== PROJECT_EXT) throw new Error('Invalid project file extension.');
    const tmp = `${p}.tmp`;
    await fsp.writeFile(tmp, data, 'utf8');
    await fsp.rename(tmp, p);
  });
  handle('fs:writeFile', async (p: string, data: Uint8Array) => {
    assertWrite(p);
    await fsp.writeFile(p, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });
  handle('fs:openWrite', async (p: string) => {
    assertWrite(p);
    const fh = await fsp.open(p, 'w');
    const id = nextHandle++;
    writeHandles.set(id, { handle: fh, path: p });
    return id;
  });
  handle('fs:write', async (id: number, position: number, data: Uint8Array) => {
    const entry = writeHandles.get(id);
    if (!entry) throw new Error('Invalid write handle');
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let written = 0;
    while (written < buf.length) {
      const { bytesWritten } = await entry.handle.write(buf, written, buf.length - written, position + written);
      written += bytesWritten;
    }
  });
  handle('fs:closeWrite', async (id: number) => {
    const entry = writeHandles.get(id);
    if (!entry) return;
    writeHandles.delete(id);
    await entry.handle.close();
  });
  handle('fs:abortWrite', async (id: number) => {
    const entry = writeHandles.get(id);
    if (!entry) return;
    writeHandles.delete(id);
    await entry.handle.close().catch(() => undefined);
    await fsp.unlink(entry.path).catch(() => undefined);
  });
  handle('fs:saveRecording', async (name: string, data: Uint8Array): Promise<FileInfo> => {
    const dir = path.join(app.getPath('userData'), 'recordings');
    await fsp.mkdir(dir, { recursive: true });
    const ext = AUDIO_EXTS.includes(extOf(name)) ? extOf(name) : 'webm';
    const base = sanitizeName(path.basename(name, path.extname(name))) || 'Voiceover';
    const file = path.join(dir, `${base}-${Date.now()}.${ext === 'webm' ? 'weba' : ext}`);
    await fsp.writeFile(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return statFile(file);
  });

  handle('autosave:write', async (id: string, name: string, projectPath: string | null, data: string) => {
    const dir = autosaveDir();
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeId(id)}.json`);
    const payload = JSON.stringify({ id, name, path: projectPath, savedAt: Date.now(), data });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, file);
  });
  handle('autosave:list', async (): Promise<AutosaveEntry[]> => {
    const dir = autosaveDir();
    let files: string[] = [];
    try {
      files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const out: AutosaveEntry[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')) as AutosaveEntry;
        out.push({ id: raw.id, name: raw.name, savedAt: raw.savedAt, path: raw.path ?? null });
      } catch {
        /* skip corrupt entries */
      }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  });
  handle('autosave:read', async (id: string) => {
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(autosaveDir(), `${safeId(id)}.json`), 'utf8')) as { data: string; path: string | null };
      if (raw.path) {
        approveRead(raw.path);
        approveWrite(raw.path);
      }
      return raw.data;
    } catch {
      return null;
    }
  });
  handle('autosave:remove', async (id: string) => {
    await fsp.unlink(path.join(autosaveDir(), `${safeId(id)}.json`)).catch(() => undefined);
  });

  // Feature modules: every src/main/handlers/*.ts default-exports register(ctx).
  const ctx: MainContext = {
    handle,
    send: (channel, ...args) => {
      if (!channel.startsWith('x:')) throw new Error('Extension events must use the x: namespace');
      mainWindow?.webContents.send(channel, ...args);
    },
    window: () => mainWindow,
    approveRead,
    approveWrite,
    assertRead,
    assertWrite,
    settings: { get: (key, fallback) => store.get(key, fallback), set: (key, value) => store.set(key, value) },
    statFile,
    sanitizeName,
    userData: () => app.getPath('userData'),
    modelsDir,
    e2eDir,
  };
  const modules = import.meta.glob<{ default: (ctx: MainContext) => void }>('./handlers/*.ts', { eager: true });
  for (const [file, mod] of Object.entries(modules)) {
    try {
      mod.default(ctx);
    } catch (err) {
      console.error(`[main] handler module ${file} failed to register`, err);
    }
  }
}

function sanitizeName(name: string): string {
  return String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------------------------

if (gotLock) {
  startupProject = findProjectArg(process.argv);

  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const p = findProjectArg(argv);
    if (p) {
      approveRead(p);
      approveWrite(p);
      mainWindow.webContents.send('app:openProject', p);
    }
  });

  void app.whenReady().then(() => {
    store = new JsonStore(path.join(app.getPath('userData'), 'settings.json'));
    Menu.setApplicationMenu(null);
    registerProtocol();
    registerIpc();

    // Grant only what the editor needs: microphone for voiceover and local font enumeration.
    const allowed = new Set(['media', 'local-fonts', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    store?.flush();
    app.quit();
  });
}
