/**
 * Types shared between the main process, the preload bridge and the renderer.
 * Keep this file free of runtime imports so every side can include it.
 */

export const APP_NAME = 'Kinora';
export const PROJECT_EXT = 'kinora';
export const MEDIA_SCHEME = 'kinora';

// 'mxf' (broadcast / camera files) is imported through the optional FFmpeg conversion.
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'ts', 'mts', 'm2ts', '3gp', 'mxf'];
export const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'];
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'apng'];
/**
 * Lottie animations: Bodymovin JSON or dotLottie archives. The main process serves these only
 * after checking that the file really is a Lottie animation (any other JSON stays unreadable).
 */
export const LOTTIE_EXTS = ['json', 'lottie'];
/** Motion clips: animation code rendered frame by frame (src/shared/motion.ts). */
export const MOTION_EXTS = ['kmotion'];
export const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS, ...LOTTIE_EXTS, ...MOTION_EXTS];

export interface FileInfo {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  exists: boolean;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: string;
}

export interface AutosaveEntry {
  id: string;
  name: string;
  savedAt: number;
  path: string | null;
}

export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  isDev: boolean;
  userData: string;
  documents: string;
  videos: string;
}

/** The API exposed on `window.kinora` by the preload script. */
export interface KinoraBridge {
  app: {
    info(): Promise<AppInfo>;
    getRecent(): Promise<RecentProject[]>;
    addRecent(entry: RecentProject): Promise<void>;
    removeRecent(path: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
    openPath(path: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    setTitle(title: string): Promise<void>;
    setDirty(dirty: boolean): Promise<void>;
    confirmClose(): Promise<void>;
    keepAwake(on: boolean): Promise<void>;
    setProgress(value: number): Promise<void>;
    /** Fired when the user tries to close the window while the document is dirty. */
    onCloseRequested(cb: () => void): () => void;
    /** Fired when the OS asks the app to open a project file. */
    onOpenProject(cb: (path: string) => void): () => void;
    /** Returns a project path passed on the command line at startup, if any. */
    getStartupProject(): Promise<string | null>;
  };
  settings: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  dialog: {
    openMedia(): Promise<FileInfo[]>;
    openProject(): Promise<string | null>;
    saveProject(defaultName: string): Promise<string | null>;
    saveFile(defaultName: string, filters: SaveDialogFilter[]): Promise<string | null>;
    locateMedia(name: string): Promise<FileInfo | null>;
    message(opts: { type?: 'info' | 'warning' | 'error' | 'question'; title: string; message: string; detail?: string; buttons?: string[] }): Promise<number>;
  };
  fs: {
    stat(paths: string[]): Promise<FileInfo[]>;
    readProject(path: string): Promise<string>;
    writeProject(path: string, data: string): Promise<void>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    openWrite(path: string): Promise<number>;
    write(handle: number, position: number, data: Uint8Array): Promise<void>;
    closeWrite(handle: number): Promise<void>;
    abortWrite(handle: number): Promise<void>;
    saveRecording(name: string, data: Uint8Array): Promise<FileInfo>;
  };
  autosave: {
    write(id: string, name: string, path: string | null, data: string): Promise<void>;
    list(): Promise<AutosaveEntry[]>;
    read(id: string): Promise<string | null>;
    remove(id: string): Promise<void>;
  };
  media: {
    /** Resolve the absolute path of a File dropped from the OS. */
    pathForFile(file: File): string;
    /** Build a streamable URL for a local media file. */
    toUrl(path: string): string;
  };
  /** Call a feature handler registered in src/main/handlers (channel must start with `x:`). */
  call<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  /** Listen to a feature event sent by the main process (channel must start with `x:`). */
  on(channel: string, cb: (...args: any[]) => void): () => void;
}

/** URL of a bundled model / runtime file, e.g. modelUrl('mediapipe/selfie_segmenter.tflite'). */
export function modelUrl(rel: string): string {
  return `${MEDIA_SCHEME}://models/${rel.replace(/^\/+/, '')}`;
}

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://media/file?path=${encodeURIComponent(path)}`;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
