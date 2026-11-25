#!/usr/bin/env node
/**
 * Translation helper (see docs/I18N.md).
 *
 *   node scripts/i18n.mjs            list missing / unused strings per locale
 *   node scripts/i18n.mjs --keys     print every source string as JSON
 *
 * Source strings are collected from `t('…')` calls in the translated files (TRANSLATED below),
 * plus command / settings metadata (`title`, `menuTitle`, `group`, `description`) in
 * `ui/commands/defs` and `ui/settings/defs`, plus the fixed extras listed in EXTRA_KEYS.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'src/renderer/src');
export const LOCALES_DIR = join(SRC, 'ui/i18n/locales');

/** Files and folders whose user-visible strings go through t(). */
export const TRANSLATED = [
  'App.tsx',
  'main.tsx',
  'ui/projectIO.ts',
  'ui/actions.ts',
  'ui/common',
  'ui/shell',
  'ui/settings',
  'ui/palette',
  'ui/collect',
  'ui/commands',
  'ui/claude',
  'ui/library',
  'ui/inspector',
  'ui/timeline',
  'ui/time',
  'ui/media',
  'ui/export',
  'ui/templates',
  'ui/thumbnails',
  'ui/coloraudio',
  'ui/preview',
  'ui/speech',
  'ui/tools',
  'ui/vision',
  'ui/motion',
];

/** Strings looked up dynamically (menu names, groups, key caps, format hints, kinds). */
export const EXTRA_KEYS = [
  'menu|File',
  'menu|Edit',
  'menu|View',
  'menu|Tools',
  'menu|Help',
  'File',
  'Edit',
  'Clip',
  'Timeline',
  'Playback',
  'Tools',
  'View',
  'Preferences',
  'Help',
  'Theme',
  'Preview',
  'Smart',
  ...['Ctrl', 'Alt', 'Shift', 'Del', 'Esc', 'Space', 'Home', 'End', 'Enter', 'Backspace', 'Tab', 'PgUp', 'PgDn', 'Ins', 'Scroll', 'Click', 'Drag', 'Rotate'].map((k) => `key|${k}`),
  'YouTube · landscape',
  'Reels · Shorts · stories',
  'Square posts',
  'Portrait feed',
  'Cinematic',
  'Command',
  'Template',
  'Effect',
  'Transition',
  'Filter',
  'Text style',
  'Sticker',
  'Sound',
  'Background',
  // Mouse gestures in the keyboard shortcuts dialog
  'Zoom the timeline around the cursor',
  'Scroll the timeline sideways',
  'Add a clip to the selection',
  'Move without snapping',
  'Move on the canvas along one axis',
  'Rotate in 15° steps',
];

function walk(p) {
  const full = join(SRC, p);
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => walk(join(p, f)));
  return /\.(ts|tsx)$/.test(p) ? [full] : [];
}

const unquote = (q, body) => (q === '`' ? body : body.replace(/\\'/g, "'").replace(/\\"/g, '"'));

/** Source strings used by one file. */
export function extractFile(file) {
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  // t('…'), t('…', vars), t('…', undefined, 'context') — also tr(…) aliases.
  const call = /\bt[r]?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*(?:,\s*(?:undefined|\{[^}]*\}|[\w.]+)\s*)?(?:,\s*'([\w-]+)')?\s*\)/g;
  for (const m of src.matchAll(call)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    const key = unquote(m[1], m[2]);
    out.add(m[3] ? `${m[3]}|${key}` : key);
  }
  // tk('…'): marked for translation, translated where it is displayed (tMaybe).
  for (const m of src.matchAll(/\btk\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    out.add(unquote(m[1], m[2]));
  }
  if (/commands[\\/]defs[\\/]|settings[\\/]defs[\\/]/.test(file)) {
    for (const m of src.matchAll(/\b(title|menuTitle|group|description|menuSection):\s*'((?:\\.|[^'\\])*)'/g)) out.add(unquote("'", m[2]));
    // Tuples like ['full', 'Preview quality: Full', 'Full', 1] (title with a colon, menu label)
    for (const m of src.matchAll(/\['\w+', '([^']+: [^']+)', '([^']+)'/g)) {
      out.add(m[1]);
      out.add(m[2]);
    }
  }
  return out;
}

/** Titles and descriptions of the ready-made Claude requests (src/shared/claude.ts PROMPTS), shown in Settings → Claude. */
export function promptKeys() {
  const src = readFileSync(join(ROOT, 'src/shared/claude.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const PROMPTS'), src.indexOf('export const PROMPT_NAMES'));
  const out = new Set();
  for (const m of block.matchAll(/^ {4}(?:title|description): '((?:\\.|[^'\\])*)'/gm)) {
    out.add(unquote("'", m[1]).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  return out;
}

export function extractKeys() {
  const keys = new Set(EXTRA_KEYS);
  for (const p of TRANSLATED) for (const f of walk(p)) extractFile(f).forEach((k) => keys.add(k));
  promptKeys().forEach((k) => keys.add(k));
  return keys;
}

export function loadLocale(code) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8'));
}

export function localeCodes() {
  return readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = extractKeys();
  if (process.argv.includes('--keys')) {
    console.log(JSON.stringify([...keys].sort(), null, 2));
  } else {
    let problems = 0;
    for (const code of localeCodes()) {
      const dict = loadLocale(code);
      const missing = [...keys].filter((k) => !(k in dict));
      const unused = Object.keys(dict).filter((k) => !keys.has(k));
      problems += missing.length;
      console.log(`${code}: ${Object.keys(dict).length} strings, ${missing.length} missing, ${unused.length} unused`);
      for (const k of missing) console.log(`  missing: ${k}`);
      for (const k of unused) console.log(`  unused:  ${k}`);
    }
    process.exit(problems ? 1 : 0);
  }
}
