/**
 * Settings window state and a small persisted-settings cache shared by every section.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useUI } from '@/store/ui';

interface SettingsWindowState {
  section: string;
  search: string;
}

export const useSettingsWindow = create<SettingsWindowState>()(() => ({ section: 'general', search: '' }));

/** Open the Settings window, optionally at a section (e.g. 'shortcuts'). */
export function openSettings(section?: string, search = ''): void {
  useSettingsWindow.setState((s) => ({ section: section ?? s.section, search }));
  useUI.getState().openModal('settings');
}

/** The settings search text (sections can use it to filter their own content). */
export function useSettingsSearch(): string {
  return useSettingsWindow((s) => s.search);
}

// ---------------------------------------------------------------------------------------------
// Persisted values
// ---------------------------------------------------------------------------------------------

const values = new Map<string, unknown>();
const loaded = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

const notify = (key: string): void => listeners.get(key)?.forEach((cb) => cb());

/** Read a setting (cached after the first read). */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!loaded.has(key)) {
    try {
      const v = await window.kinora?.settings.get<T>(key);
      if (!loaded.has(key)) {
        loaded.add(key);
        if (v !== undefined) values.set(key, v);
      }
    } catch {
      loaded.add(key);
    }
  }
  return values.has(key) ? (values.get(key) as T) : fallback;
}

export function setSetting<T>(key: string, value: T): void {
  loaded.add(key);
  values.set(key, value);
  notify(key);
  void window.kinora?.settings.set(key, value);
}

/** Persisted setting as React state: `[value, setValue, loaded]`. */
export function useSetting<T>(key: string, fallback: T): [T, (value: T) => void, boolean] {
  const [, force] = useState(0);
  useEffect(() => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    const cb = (): void => force((n) => n + 1);
    set.add(cb);
    if (!loaded.has(key)) void getSetting(key, fallback).then(cb);
    return () => {
      set!.delete(cb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const value = values.has(key) ? (values.get(key) as T) : fallback;
  return [value, (v: T) => setSetting(key, v), loaded.has(key)];
}
