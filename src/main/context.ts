/**
 * Services the main process offers to feature modules in `src/main/handlers/*.ts`.
 * Each handler module default-exports `register(ctx: MainContext)` and is loaded automatically.
 */

import type { BrowserWindow } from 'electron';
import type { FileInfo } from '@shared/ipc';

export interface MainContext {
  /** Register an IPC handler. Only the editor window may call it. Use the `x:<area>:<name>` naming scheme. */
  handle: (channel: string, fn: (...args: any[]) => unknown) => void;
  /** Send an event to the renderer (received with `window.kinora.on(channel, cb)`; channel must start with `x:`). */
  send: (channel: string, ...args: unknown[]) => void;
  /** The editor window, when open. */
  window: () => BrowserWindow | null;
  /** Allow the renderer to read / write a path (only for paths the user picked or the app created). */
  approveRead: (p: string) => void;
  approveWrite: (p: string) => void;
  assertRead: (p: string) => void;
  assertWrite: (p: string) => void;
  /** Persistent JSON settings (main-process side). */
  settings: { get<T>(key: string, fallback?: T): T | undefined; set(key: string, value: unknown): void };
  statFile: (p: string) => Promise<FileInfo>;
  sanitizeName: (name: string) => string;
  /** userData folder (or the isolated test profile). */
  userData: () => string;
  /** Folder holding bundled AI models (resources/models in development, <app>/resources/models when installed). */
  modelsDir: () => string;
  /** Set during automated tests: dialogs resolve to files inside this folder. */
  e2eDir: string | null;
}
