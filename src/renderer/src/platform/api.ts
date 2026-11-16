import type { KinoraBridge } from '@shared/ipc';

declare global {
  interface Window {
    kinora: KinoraBridge;
  }
}

/** The preload bridge. Present whenever the renderer runs inside the Kinora shell. */
export const api: KinoraBridge = window.kinora;
export const hasBridge = typeof window !== 'undefined' && !!window.kinora;
