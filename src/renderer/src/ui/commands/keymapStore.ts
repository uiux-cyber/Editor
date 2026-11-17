/**
 * The user's keymap: default shortcuts from the command registry plus the overrides saved in
 * settings (`shortcuts.keymap`). Everything that shows or dispatches shortcuts reads it from here,
 * so menus, the palette, tooltips and the shortcuts dialog always agree.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { t } from '../i18n';
import { getCommands, onCommandsChanged, type Command } from './index';
import { conflictsFor, indexBindings, parseOverrides, resolveBindings, shortcutKeys, shortcutLabel, withBindings, type KeymapOverrides } from './keymap';

const SETTINGS_KEY = 'shortcuts.keymap';

interface KeymapState {
  overrides: KeymapOverrides;
  /** Bumped when commands are registered / removed. */
  version: number;
}

export const useKeymap = create<KeymapState>()(() => ({ overrides: {}, version: 0 }));

let cache: { overrides: KeymapOverrides; version: number; bindings: Map<string, string[]>; index: Map<string, string[]> } | null = null;

function compute(): NonNullable<typeof cache> {
  const { overrides, version } = useKeymap.getState();
  if (!cache || cache.overrides !== overrides || cache.version !== version) {
    const bindings = resolveBindings(getCommands(), overrides);
    cache = { overrides, version, bindings, index: indexBindings(bindings) };
  }
  return cache;
}

/** Effective shortcuts of every command. */
export const allBindings = (): Map<string, string[]> => compute().bindings;
/** shortcut → command ids. */
export const bindingIndex = (): Map<string, string[]> => compute().index;
export const bindingsFor = (id: string): string[] => compute().bindings.get(id) ?? [];

/** Localised key-cap label (German keyboards say “Strg”, French “Maj”…). */
export const keyLabel = (label: string): string => t(label, undefined, 'key');

/** "Ctrl+K" for the command's first shortcut, or '' when it has none. */
export function shortcutText(id: string): string {
  const first = bindingsFor(id)[0];
  return first ? shortcutLabel(first, keyLabel) : '';
}

export const keyCaps = (shortcut: string): string[] => shortcutKeys(shortcut, keyLabel);

/** "Undo (Ctrl+Z)" — tooltip text that follows the user's keymap. */
export function withShortcut(label: string, id: string): string {
  const s = shortcutText(id);
  return s ? `${label} (${s})` : label;
}

/** Re-render when the keymap or the command list changes. */
export function useKeymapVersion(): number {
  const overrides = useKeymap((s) => s.overrides);
  const version = useKeymap((s) => s.version);
  const [n, setN] = useState(0);
  useEffect(() => setN((x) => x + 1), [overrides, version]);
  return n;
}

let saveTimer = 0;
function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void window.kinora?.settings.set(SETTINGS_KEY, useKeymap.getState().overrides), 150);
}

function setOverrides(overrides: KeymapOverrides): void {
  useKeymap.setState({ overrides });
  persist();
}

/** Replace the shortcuts of one command. */
export function setCommandBindings(cmd: Command, next: string[]): void {
  setOverrides(withBindings(useKeymap.getState().overrides, cmd, next));
}

/**
 * Give `cmd` the shortcut `shortcut` (replacing the binding at `index`, or adding it when
 * index is undefined). When `steal` is set, other commands using it lose that shortcut.
 */
export function assignShortcut(cmd: Command, shortcut: string, index: number | undefined, steal: boolean): void {
  let overrides = useKeymap.getState().overrides;
  const bindings = resolveBindings(getCommands(), overrides);
  if (steal) {
    for (const otherId of conflictsFor(bindings, shortcut, cmd.id)) {
      const other = getCommands().find((c) => c.id === otherId);
      if (other) overrides = withBindings(overrides, other, (bindings.get(otherId) ?? []).filter((s) => s !== shortcut));
    }
  }
  const current = [...(bindings.get(cmd.id) ?? [])];
  if (index !== undefined && index < current.length) current[index] = shortcut;
  else current.push(shortcut);
  setOverrides(withBindings(overrides, cmd, current.filter((s, i) => current.indexOf(s) === i)));
}

export function removeShortcut(cmd: Command, shortcut: string): void {
  setCommandBindings(
    cmd,
    bindingsFor(cmd.id).filter((s) => s !== shortcut),
  );
}

export function resetCommand(id: string): void {
  const copy = { ...useKeymap.getState().overrides };
  delete copy[id];
  setOverrides(copy);
}

export function resetAllShortcuts(): void {
  setOverrides({});
}

export const isCustomized = (id: string): boolean => Array.isArray(useKeymap.getState().overrides[id]);

/** Load saved overrides and follow registry changes (call once at startup). */
export async function initKeymap(): Promise<void> {
  onCommandsChanged(() => useKeymap.setState((s) => ({ version: s.version + 1 })));
  try {
    const raw = await window.kinora?.settings.get(SETTINGS_KEY);
    useKeymap.setState({ overrides: parseOverrides(raw) });
  } catch {
    /* defaults */
  }
}
