// Electron entry for the library checker: loads the built checker page in a hidden window and
// forwards its `__CHECK__` / `__DONE__` console lines to stdout.
const { app, BrowserWindow } = require('electron');
const os = require('node:os');
const path = require('node:path');

const [htmlFile, packs = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

app.setPath('userData', path.join(os.tmpdir(), `kinora-check-ud-${process.pid}`));
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const timeout = setTimeout(() => {
  console.log('__FATAL__checker timed out after 180s');
  app.exit(2);
}, 180000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.webContents.on('console-message', (event, _level, legacyMessage) => {
    const message = typeof event.message === 'string' ? event.message : String(legacyMessage ?? '');
    if (message.startsWith('__CHECK__')) {
      console.log(message);
    } else if (message.startsWith('__DONE__')) {
      console.log(message);
      clearTimeout(timeout);
      setTimeout(() => app.exit(0), 50);
    } else if (/error/i.test(message)) {
      console.log('__LOG__' + message);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('__FATAL__renderer exited: ' + details.reason);
    app.exit(2);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log(`__FATAL__failed to load checker page: ${code} ${desc}`);
    app.exit(2);
  });
  await win.loadFile(htmlFile, { query: { packs } });
});

app.on('window-all-closed', () => app.exit(0));
