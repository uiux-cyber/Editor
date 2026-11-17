/**
 * Command registry. Every user-facing action that should be reachable from the command palette,
 * the menus or a keyboard shortcut is a `Command`. Feature areas add theirs in
 * `ui/commands/defs/<area>.ts` (default export: Command[]); they are picked up automatically.
 * Commands can also be added at runtime with `registerCommands`.
 */

import type { ReactNode } from 'react';

export interface Command {
  /** Stable id, e.g. `clip.split` or `smart.autoCaptions`. Used for custom shortcuts. */
  id: string;
  /** English title; translated for display with `t()` (see docs/I18N.md). */
  title: string;
  /** Menu / palette group, e.g. 'File', 'Edit', 'View', 'Timeline', 'Clip', 'Smart', 'Help'. */
  group: string;
  /** Extra search terms for the palette. */
  keywords?: string[];
  /**
   * Default shortcut in the form `Ctrl+Shift+K`, `S`, `Alt+ArrowLeft`, `F6`, `?`. Printable
   * symbols are written as the character they type (`?`, `+`), without Shift. Users can rebind
   * it in Settings → Shortcuts.
   */
  shortcut?: string;
  /** Further default shortcuts (e.g. `Ctrl+Y` for redo). */
  extraShortcuts?: string[];
  icon?: ReactNode;
  /** Return false to hide / disable the command in the current state. */
  when?: () => boolean;
  /** For toggles and choices: shown as a check mark in menus and as On / Off in the palette. */
  checked?: () => boolean;
  /**
   * Title-bar menu to list the command in: 'File' | 'Edit' | 'View' | 'Tools' | 'Help', or false
   * for palette / shortcut only. Default: the group when it names one of those menus, otherwise
   * 'Tools' (under a heading with the group name).
   */
  menu?: string | false;
  /** Shorter label used inside a menu section (e.g. 'Light' under a 'Theme' heading). */
  menuTitle?: string;
  /** Heading of the menu section this command belongs to (consecutive commands share it). */
  menuSection?: string;
  /**
   * The shortcut also works while a text field has focus (document-level commands such as Save
   * or the command palette). Shortcuts never fire while a dialog or menu is open.
   */
  global?: boolean;
  run: () => unknown;
}

const modules = import.meta.glob<{ default: Command[] }>('./defs/*.ts', { eager: true });

let commands: Command[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default ?? []);
const listeners = new Set<() => void>();

export function getCommands(): Command[] {
  return commands;
}

export function getCommand(id: string): Command | undefined {
  return commands.find((c) => c.id === id);
}

/** Add commands at runtime. Returns a function that removes them again. */
export function registerCommands(list: Command[]): () => void {
  const ids = new Set(list.map((c) => c.id));
  commands = [...commands.filter((c) => !ids.has(c.id)), ...list];
  listeners.forEach((cb) => cb());
  return () => {
    commands = commands.filter((c) => !list.includes(c));
    listeners.forEach((cb) => cb());
  };
}

export function onCommandsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Run a command by id if it exists and is enabled. Returns true when it ran. */
export function runCommand(id: string): boolean {
  const cmd = getCommand(id);
  if (!cmd || (cmd.when && !cmd.when())) return false;
  void cmd.run();
  return true;
}
