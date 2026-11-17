/**
 * Appearance: colour theme (System / Dark / Light) and motion preference.
 *
 * The resolved theme is applied as `<html data-theme="dark|light">`; every colour in the UI comes
 * from the tokens in styles/base.css. With "System" the OS setting is followed live. The main
 * process (handlers/theme.ts) keeps the native title-bar buttons and window background in sync.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

export type ThemeSetting = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';
export type MotionSetting = 'system' | 'reduce' | 'full';

interface ThemeState {
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  motion: MotionSetting;
}

const STORAGE_KEY = 'kinora.theme';
const MOTION_KEY = 'kinora.motion';

const readLocal = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

const darkQuery = (): MediaQueryList | null => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

const resolveTheme = (setting: ThemeSetting): ResolvedTheme => (setting === 'system' ? (darkQuery()?.matches === false ? 'light' : 'dark') : setting);

const THEMES = ['system', 'dark', 'light'] as const;
const MOTIONS = ['system', 'reduce', 'full'] as const;

const initial = readLocal<ThemeSetting>(STORAGE_KEY, THEMES, 'dark');
export const useTheme = create<ThemeState>()(() => ({ setting: initial, resolved: resolveTheme(initial), motion: readLocal<MotionSetting>(MOTION_KEY, MOTIONS, 'system') }));

function paint(): void {
  const { resolved, motion } = useTheme.getState();
  const root = document.documentElement;
  root.dataset.theme = resolved;
  if (motion === 'system') delete root.dataset.motion;
  else root.dataset.motion = motion;
}

/** Tell the main process which colours the native window chrome should use. */
function syncWindowChrome(): void {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue('--titlebar-bg').trim() || css.getPropertyValue('--bg-0').trim();
  const symbolColor = css.getPropertyValue('--text-1').trim();
  void window.kinora?.call('x:theme:chrome', { color, symbolColor }).catch(() => undefined);
}

let applying = 0;
/**
 * Switch the native theme source first (so `prefers-color-scheme` follows the OS when the setting
 * is "system"), then paint with the answer and recolour the native title-bar buttons.
 */
async function applyTheme(): Promise<void> {
  const ticket = ++applying;
  const { setting } = useTheme.getState();
  let resolved = resolveTheme(setting);
  try {
    const dark = await window.kinora?.call<boolean>('x:theme:source', setting);
    if (setting === 'system' && typeof dark === 'boolean') resolved = dark ? 'dark' : 'light';
  } catch {
    /* main handler unavailable: keep the media-query answer */
  }
  if (ticket !== applying) return;
  if (resolved !== useTheme.getState().resolved) useTheme.setState({ resolved });
  paint();
  syncWindowChrome();
}

export function setTheme(setting: ThemeSetting): Promise<void> {
  if (!THEMES.includes(setting)) return Promise.resolve();
  useTheme.setState({ setting });
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    /* storage unavailable */
  }
  void window.kinora?.settings.set('appearance.theme', setting);
  // Paint the explicit choices right away; "system" waits for the native answer.
  if (setting !== 'system') {
    useTheme.setState({ resolved: setting });
    paint();
  }
  return applyTheme();
}

export function setMotion(motion: MotionSetting): void {
  if (!MOTIONS.includes(motion)) return;
  useTheme.setState({ motion });
  try {
    localStorage.setItem(MOTION_KEY, motion);
  } catch {
    /* storage unavailable */
  }
  void window.kinora?.settings.set('appearance.motion', motion);
  paint();
}

/** True when animations should be minimised (user setting or OS preference). */
export function prefersReducedMotion(): boolean {
  const { motion } = useTheme.getState();
  if (motion !== 'system') return motion === 'reduce';
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Apply the cached theme immediately (before React renders) and then load the saved setting. */
export async function initTheme(): Promise<void> {
  paint();
  darkQuery()?.addEventListener('change', () => {
    if (useTheme.getState().setting === 'system') void applyTheme();
  });
  try {
    const [saved, motion] = await Promise.all([window.kinora?.settings.get<ThemeSetting>('appearance.theme'), window.kinora?.settings.get<MotionSetting>('appearance.motion')]);
    if (saved && THEMES.includes(saved) && saved !== useTheme.getState().setting) {
      useTheme.setState({ setting: saved });
      try {
        localStorage.setItem(STORAGE_KEY, saved);
      } catch {
        /* storage unavailable */
      }
    }
    if (motion && MOTIONS.includes(motion)) useTheme.setState({ motion });
  } catch {
    /* keep the cached choice */
  }
  await applyTheme();
}

/** React hook returning the resolved theme; re-renders when it changes. */
export function useResolvedTheme(): ResolvedTheme {
  return useTheme((s) => s.resolved);
}

/** Run `cb` whenever the resolved theme changes (e.g. to redraw a canvas with theme colours). */
export function useOnThemeChange(cb: (theme: ResolvedTheme) => void): void {
  useEffect(() => useTheme.subscribe((s, prev) => s.resolved !== prev.resolved && cb(s.resolved)), [cb]);
}

/** Read a CSS custom property of the current theme (canvas drawing code). */
export function themeColor(name: string, fallback = '#000'): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const colorCache = new Map<string, string>();
let colorCacheTheme = '';
/**
 * Cached theme colour for code that paints often (canvas rulers, meters): reading computed
 * styles every frame is avoidable. The cache resets whenever the theme changes.
 */
export function cachedThemeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const theme = document.documentElement.dataset.theme ?? '';
  if (theme !== colorCacheTheme) {
    colorCache.clear();
    colorCacheTheme = theme;
  }
  let v = colorCache.get(name);
  if (v === undefined) {
    v = themeColor(name, fallback);
    colorCache.set(name, v);
  }
  return v;
}
