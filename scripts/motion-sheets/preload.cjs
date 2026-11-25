const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sheets', {
  save: (name, dataUrl) => ipcRenderer.invoke('sheets:save', name, dataUrl),
  log: (text) => ipcRenderer.send('sheets:log', text),
  done: (summary) => ipcRenderer.send('sheets:done', summary),
});
