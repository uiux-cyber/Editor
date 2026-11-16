import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { KinoraBridge } from '@shared/ipc';
import { mediaUrl } from '@shared/ipc';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: KinoraBridge = {
  app: {
    info: () => invoke('app:info'),
    getRecent: () => invoke('app:getRecent'),
    addRecent: (entry) => invoke('app:addRecent', entry),
    removeRecent: (path) => invoke('app:removeRecent', path),
    showItemInFolder: (path) => invoke('app:showItemInFolder', path),
    openPath: (path) => invoke('app:openPath', path),
    openExternal: (url) => invoke('app:openExternal', url),
    setTitle: (title) => invoke('app:setTitle', title),
    setDirty: (dirty) => invoke('app:setDirty', dirty),
    confirmClose: () => invoke('app:confirmClose'),
    keepAwake: (on) => invoke('app:keepAwake', on),
    setProgress: (value) => invoke('app:setProgress', value),
    onCloseRequested: (cb) => subscribe('app:closeRequested', cb),
    onOpenProject: (cb) => subscribe<[string]>('app:openProject', cb),
    getStartupProject: () => invoke('app:getStartupProject'),
  },
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value),
  },
  dialog: {
    openMedia: () => invoke('dialog:openMedia'),
    openProject: () => invoke('dialog:openProject'),
    saveProject: (defaultName) => invoke('dialog:saveProject', defaultName),
    saveFile: (defaultName, filters) => invoke('dialog:saveFile', defaultName, filters),
    locateMedia: (name) => invoke('dialog:locateMedia', name),
    message: (opts) => invoke('dialog:message', opts),
  },
  fs: {
    stat: (paths) => invoke('fs:stat', paths),
    readProject: (path) => invoke('fs:readProject', path),
    writeProject: (path, data) => invoke('fs:writeProject', path, data),
    writeFile: (path, data) => invoke('fs:writeFile', path, data),
    openWrite: (path) => invoke('fs:openWrite', path),
    write: (handle, position, data) => invoke('fs:write', handle, position, data),
    closeWrite: (handle) => invoke('fs:closeWrite', handle),
    abortWrite: (handle) => invoke('fs:abortWrite', handle),
    saveRecording: (name, data) => invoke('fs:saveRecording', name, data),
  },
  autosave: {
    write: (id, name, path, data) => invoke('autosave:write', id, name, path, data),
    list: () => invoke('autosave:list'),
    read: (id) => invoke('autosave:read', id),
    remove: (id) => invoke('autosave:remove', id),
  },
  media: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    toUrl: (path) => mediaUrl(path),
  },
};

contextBridge.exposeInMainWorld('kinora', bridge);
