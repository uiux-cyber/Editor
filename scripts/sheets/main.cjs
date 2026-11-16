// Electron entry for the contact-sheet renderer.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [htmlFile, outDir, query = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
app.setPath('userData', path.join(os.tmpdir(), `kinora-sheets-ud-${process.pid}`));
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const timeout = setTimeout(() => {
  console.log('__FATAL__timed out after 240s');
  app.exit(2);
}, 240000);

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  ipcMain.handle('sheets:save', (_e, name, dataUrl) => {
    const file = path.join(outDir, path.basename(String(name)));
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    console.log('__SAVED__' + file);
  });
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
  win.webContents.on('console-message', (event, _level, legacy) => {
    const message = typeof event.message === 'string' ? event.message : String(legacy ?? '');
    if (/error|failed/i.test(message)) console.log('__LOG__' + message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('__FATAL__renderer exited: ' + d.reason);
    app.exit(2);
  });
  await win.loadFile(htmlFile, { search: query });
});

app.on('window-all-closed', () => app.exit(0));
