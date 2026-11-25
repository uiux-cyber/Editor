// Electron entry for Motion contact sheets (see scripts/render-motion.mjs). Serves out/motion as
// kinora://motion/ like the app does, and saves the PNGs the page renders.
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [htmlFile, outDir, query = '', runtimeDir, timeoutS = '900'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
app.setPath('userData', path.join(os.tmpdir(), `kinora-motion-sheets-ud-${process.pid}`));
app.commandLine.appendSwitch('ignore-gpu-blocklist');

protocol.registerSchemesAsPrivileged([{ scheme: 'kinora', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
};

const timeout = setTimeout(
  () => {
    console.log(`__FATAL__timed out after ${timeoutS}s`);
    app.exit(2);
  },
  Number(timeoutS) * 1000,
);

app.whenReady().then(async () => {
  const rootDir = path.resolve(runtimeDir);
  protocol.handle('kinora', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'motion') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname) || '/frame.html';
    const file = path.normalize(path.join(rootDir, rel === '/' ? '/frame.html' : rel));
    if (!file.startsWith(rootDir + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      const ext = path.extname(file).slice(1).toLowerCase();
      return new Response(body, { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  fs.mkdirSync(outDir, { recursive: true });
  ipcMain.handle('sheets:save', (_e, name, dataUrl) => {
    const file = path.join(outDir, path.basename(String(name)));
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    console.log('__SAVED__' + file);
  });
  ipcMain.on('sheets:log', (_e, text) => console.log('__LOG__' + text));
  ipcMain.on('sheets:done', (_e, summary) => {
    console.log('__DONE__' + summary);
    clearTimeout(timeout);
    setTimeout(() => app.exit(0), 50);
  });
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('__FATAL__renderer exited: ' + d.reason);
    app.exit(2);
  });
  await win.loadFile(htmlFile, { search: query });
});

app.on('window-all-closed', () => app.exit(0));
