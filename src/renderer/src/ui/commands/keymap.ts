/**
 * Keyboard shortcut model (pure, no DOM / store access so it can be unit tested).
 *
 * Canonical form: modifiers in the order `Ctrl+Alt+Shift+` followed by one key name.
 *  - Letters are upper case (`Ctrl+Shift+K`), keep Shift.
 *  - Named keys use KeyboardEvent.key names (`ArrowLeft`, `Delete`, `Home`, `F6`, `Space`), keep Shift.
 *  - Other printable characters are written as the character they produce and never carry Shift,
 *    because Shift is implied by the character: `?` (not `Shift+/`), `+`, `_`.
 * `Meta` / `Cmd` / `Win` are treated as Ctrl.
 */

export interface KeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const NAMED_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Escape',
  'Tab',
  'Space',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ContextMenu',
  'Pause',
  'PrintScreen',
];
const NAMED_LOOKUP = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));

const KEY_ALIASES: Record<string, string> = {
  del: 'Delete',
  esc: 'Escape',
  return: 'Enter',
  spacebar: 'Space',
  ' ': 'Space',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  pagedn: 'PageDown',
  ins: 'Insert',
  plus: '+',
  minus: '-',
  '−': '-',
  comma: ',',
  period: '.',
  slash: '/',
};

const MODIFIER_NAMES: Record<string, 'ctrl' | 'alt' | 'shift'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  meta: 'ctrl',
  win: 'ctrl',
  super: 'ctrl',
  mod: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

/** Canonical key name, or null when the token is not a usable key. */
export function canonicalKey(token: string): string | null {
  if (!token) return null;
  if (token.length === 1) {
    if (token === ' ') return 'Space';
    if (/[a-z]/i.test(token)) return token.toUpperCase();
    return KEY_ALIASES[token] ?? token;
  }
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (KEY_ALIASES[token]) return KEY_ALIASES[token];
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  return NAMED_LOOKUP.get(lower) ?? null;
}

/** Keys that are written as the character they produce (Shift is implied). */
const isSymbolKey = (key: string): boolean => key.length === 1 && !/[A-Z]/.test(key);

function finish(combo: KeyCombo): KeyCombo {
  return isSymbolKey(combo.key) ? { ...combo, shift: false } : combo;
}

/** Parse `Ctrl+Shift+K`, `ctrl + k`, `Shift+Del`, `?`, `Ctrl++`. Returns null when invalid. */
export function parseShortcut(input: string): KeyCombo | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let tokens: string[];
  if (s === '+') tokens = ['+'];
  else if (s.endsWith('++')) tokens = [...s.slice(0, -2).split('+'), '+'];
  else tokens = s.split('+');
  tokens = tokens.map((t) => (t === '+' ? t : t.trim())).filter((t) => t !== '');
  if (tokens.length === 0) return null;
  const combo: KeyCombo = { ctrl: false, alt: false, shift: false, key: '' };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const mod = MODIFIER_NAMES[tok.toLowerCase()];
    if (mod && i < tokens.length - 1) {
      combo[mod] = true;
      continue;
    }
    if (i !== tokens.length - 1) return null;
    const key = canonicalKey(tok);
    if (!key) return null;
    combo.key = key;
  }
  return combo.key ? finish(combo) : null;
}

export function comboToString(c: KeyCombo): string {
  return `${c.ctrl ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${c.key}`;
}

/** Canonical string for a shortcut, or null when it cannot be parsed. */
export function normalizeShortcut(input: string): string | null {
  const c = parseShortcut(input);
  return c ? comboToString(c) : null;
}

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Hyper', 'Super', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock']);

/**
 * Candidate shortcuts for a key event, most specific first: the one built from the produced
 * character, plus a physical-key variant (`Shift+1` for `!`, letters on non-Latin layouts).
 * Empty for bare modifiers and dead keys.
 */
export function eventToShortcuts(e: KeyEventLike): string[] {
  const key = e.key;
  if (!key || MODIFIER_KEYS.has(key) || key === 'Dead' || key === 'Unidentified' || key === 'Process') return [];
  const mods = { ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey, shift: e.shiftKey };
  const out: string[] = [];
  const push = (k: string | null, shift = mods.shift): void => {
    if (!k) return;
    const s = comboToString(finish({ ...mods, shift, key: k }));
    if (!out.includes(s)) out.push(s);
  };
  const code = e.code ?? '';
  const physLetter = /^Key([A-Z])$/.exec(code)?.[1] ?? null;
  const physDigit = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1] ?? null;
  if (key.length === 1 && !/[\x20-\x7e]/.test(key)) {
    // Non-Latin layouts (Devanagari, Cyrillic…): fall back to the physical key.
    push(physLetter ?? physDigit);
    return out;
  }
  push(canonicalKey(key));
  // Digits typed with Shift (`!` on US, every digit on AZERTY) also match `Shift+1` / `1`.
  if (physDigit && key !== physDigit) push(physDigit, mods.shift);
  return out;
}

/** The primary canonical shortcut for a key event (what a "record shortcut" field stores). */
export function eventToShortcut(e: KeyEventLike): string | null {
  return eventToShortcuts(e)[0] ?? null;
}

/** A shortcut needs a modifier unless it is a key that never types text in a field. */
export function isBareTypingKey(shortcut: string): boolean {
  const c = parseShortcut(shortcut);
  return !!c && !c.ctrl && !c.alt && (c.key.length === 1 || c.key === 'Space');
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: 'Del',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Ins',
};

/**
 * Key caps for display: `Ctrl+Shift+ArrowLeft` → ['Ctrl', 'Shift', '←']. `translate` localises
 * the modifier / named key labels (e.g. German keyboards print “Strg”).
 */
export function shortcutKeys(shortcut: string, translate: (label: string) => string = (s) => s): string[] {
  const c = parseShortcut(shortcut);
  if (!c) return [shortcut];
  const out: string[] = [];
  if (c.ctrl) out.push(translate('Ctrl'));
  if (c.alt) out.push(translate('Alt'));
  if (c.shift) out.push(translate('Shift'));
  const label = KEY_LABELS[c.key] ?? c.key;
  out.push(c.key.length > 1 ? translate(label) : label);
  return out;
}

/** One-line label for menus and tooltips: `Ctrl+Shift+K`. */
export function shortcutLabel(shortcut: string, translate?: (label: string) => string): string {
  return shortcutKeys(shortcut, translate).join('+');
}

// ---------------------------------------------------------------------------------------------
// Keymap: defaults + user overrides
// ---------------------------------------------------------------------------------------------

export interface BindableCommand {
  id: string;
  shortcut?: string;
  extraShortcuts?: string[];
}

/** User overrides: command id → the complete list of its shortcuts ([] = none). */
export type KeymapOverrides = Record<string, string[]>;

export function defaultBindings(cmd: BindableCommand): string[] {
  const list: string[] = [];
  for (const s of [cmd.shortcut, ...(cmd.extraShortcuts ?? [])]) {
    const n = s ? normalizeShortcut(s) : null;
    if (n && !list.includes(n)) list.push(n);
  }
  return list;
}

/** Effective shortcuts per command id. */
export function resolveBindings(commands: readonly BindableCommand[], overrides: KeymapOverrides): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cmd of commands) {
    const custom = overrides[cmd.id];
    if (Array.isArray(custom)) {
      const list: string[] = [];
      for (const s of custom) {
        const n = normalizeShortcut(s);
        if (n && !list.includes(n)) list.push(n);
      }
      out.set(cmd.id, list);
    } else {
      out.set(cmd.id, defaultBindings(cmd));
    }
  }
  return out;
}

/** shortcut → command ids using it (in command order). */
export function indexBindings(bindings: Map<string, string[]>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [id, list] of bindings) {
    for (const s of list) {
      const ids = index.get(s);
      if (ids) ids.push(id);
      else index.set(s, [id]);
    }
  }
  return index;
}

/** Shortcuts bound to more than one command. */
export function findConflicts(bindings: Map<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [s, ids] of indexBindings(bindings)) if (ids.length > 1) out.set(s, ids);
  return out;
}

/** Other commands that already use `shortcut` (excluding `exceptId`). */
export function conflictsFor(bindings: Map<string, string[]>, shortcut: string, exceptId?: string): string[] {
  const n = normalizeShortcut(shortcut);
  if (!n) return [];
  const ids: string[] = [];
  for (const [id, list] of bindings) if (id !== exceptId && list.includes(n)) ids.push(id);
  return ids;
}

/**
 * New overrides after giving `id` the shortcut list `next`. Entries equal to the defaults are
 * dropped so "reset" is the natural state.
 */
export function withBindings(overrides: KeymapOverrides, cmd: BindableCommand, next: string[]): KeymapOverrides {
  const list = next.map((s) => normalizeShortcut(s)).filter((s): s is string => !!s);
  const unique = list.filter((s, i) => list.indexOf(s) === i);
  const copy = { ...overrides };
  const defaults = defaultBindings(cmd);
  if (unique.length === defaults.length && unique.every((s, i) => s === defaults[i])) delete copy[cmd.id];
  else copy[cmd.id] = unique;
  return copy;
}

/** Sanitise overrides loaded from settings. */
export function parseOverrides(raw: unknown): KeymapOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: KeymapOverrides = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[id] = list.filter((s): s is string => typeof s === 'string').map((s) => normalizeShortcut(s)).filter((s): s is string => !!s);
  }
  return out;
}
