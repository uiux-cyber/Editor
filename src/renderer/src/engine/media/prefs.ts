/**
 * User preferences of the performance & media area (proxies, render cache, FFmpeg). Persisted
 * with `window.kinora.settings` under `media.*` keys and shared by the engine and the UI.
 */

import { create } from 'zustand';
import type { IntermediateCodec } from '@shared/media';
import { api, hasBridge } from '@/platform/api';

export type ProxySize = 540 | 720 | 1080;

export interface MediaPrefs {
  /** Preview plays proxies when they exist (export always uses the originals). */
  useProxies: boolean;
  /** Create proxies automatically for heavy media on import. */
  proxyAuto: boolean;
  /** Shorter side (px) from which a source counts as heavy. */
  proxyMinShortSide: number;
  /** Average bitrate (Mbit/s) from which a source counts as heavy. */
  proxyMinMbps: number;
  /** Treat 10-bit HEVC as heavy whatever its size. */
  proxyHevc10: boolean;
  /** Proxy size: shorter side in px. */
  proxySize: ProxySize;
  /** Render heavy sections in the background when the editor is idle. */
  cacheAuto: boolean;
  /** Disk budget of the render cache (GB). */
  cacheLimitGB: number;
  /** Codec of FFmpeg intermediates. */
  convertCodec: IntermediateCodec;
}

export const DEFAULT_PREFS: MediaPrefs = {
  useProxies: true,
  proxyAuto: true,
  proxyMinShortSide: 1440,
  proxyMinMbps: 60,
  proxyHevc10: true,
  proxySize: 540,
  cacheAuto: false,
  cacheLimitGB: 10,
  convertCodec: 'h264',
};

interface PrefsState extends MediaPrefs {
  loaded: boolean;
  set: (patch: Partial<MediaPrefs>) => void;
}

export const useMediaPrefs = create<PrefsState>()((set) => ({
  ...DEFAULT_PREFS,
  loaded: false,
  set: (patch) => {
    set(patch);
    if (!hasBridge) return;
    for (const [k, v] of Object.entries(patch)) void api.settings.set(`media.${k}`, v);
  },
}));

export const mediaPrefs = (): MediaPrefs => useMediaPrefs.getState();

let loading: Promise<void> | null = null;

/** Load the saved preferences once (missing keys keep their defaults). */
export function loadMediaPrefs(): Promise<void> {
  loading ??= (async () => {
    if (!hasBridge) return;
    const patch: Partial<MediaPrefs> = {};
    await Promise.all(
      (Object.keys(DEFAULT_PREFS) as (keyof MediaPrefs)[]).map(async (k) => {
        const v = await api.settings.get(`media.${k}`).catch(() => undefined);
        if (v !== undefined && v !== null && typeof v === typeof DEFAULT_PREFS[k]) (patch as Record<string, unknown>)[k] = v;
      }),
    );
    useMediaPrefs.setState({ ...patch, loaded: true });
  })();
  return loading;
}
