import { describe, expect, it } from 'vitest';
import { extractKeys, loadLocale } from '../scripts/i18n.mjs';
import { makeVideo } from '@/core/factory';
import { dirnamePath, isAbsolutePath, normalizePath, relativeInside, resolveFrom, uniqueFileName } from '@/core/paths';
import { createProject, parseProjectFile, serializeProject } from '@/core/project';
import type { MediaAsset } from '@/core/types';
import {
  conflictsFor,
  defaultBindings,
  eventToShortcut,
  eventToShortcuts,
  findConflicts,
  indexBindings,
  normalizeShortcut,
  parseOverrides,
  parseShortcut,
  resolveBindings,
  shortcutKeys,
  shortcutLabel,
  withBindings,
} from '@/ui/commands/keymap';
import { formatBytes, formatMessage, formatRelativeTime, messageArguments } from '@/ui/i18n/format';
import { LANGUAGES, matchLanguage } from '@/ui/i18n';
import { foldText, fuzzyMatch, highlightRuns, matchFields, rankItems, type Rankable } from '@/ui/palette/fuzzy';

// ---------------------------------------------------------------------------------------------
// Fuzzy matching & ranking
// ---------------------------------------------------------------------------------------------

describe('fuzzy matching', () => {
  it('matches subsequences and rejects missing characters', () => {
    expect(fuzzyMatch('splt', 'Split at playhead')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Split at playhead')).toBeNull();
    expect(fuzzyMatch('', 'anything')?.score).toBe(0);
    expect(fuzzyMatch('long query', 'short')).toBeNull();
  });

  it('prefers prefix, word-start and consecutive matches', () => {
    const prefix = fuzzyMatch('exp', 'Export…')!.score;
    const middle = fuzzyMatch('exp', 'Keep expanded')!.score;
    expect(prefix).toBeGreaterThan(middle);
    const initials = fuzzyMatch('sap', 'Split at playhead')!;
    expect(initials.indices).toEqual([0, 6, 9]); // S·a·p at word starts
    const scattered = fuzzyMatch('sap', 'Disappear')!.score;
    expect(initials.score).toBeGreaterThan(scattered);
    expect(fuzzyMatch('undo', 'Undo')!.score).toBeGreaterThan(fuzzyMatch('undo', 'Undo history panel')!.score);
  });

  it('ignores case and accents and keeps indices aligned', () => {
    expect(foldText('Réglages Ünïcode').length).toBe('Réglages Ünïcode'.length);
    const m = fuzzyMatch('regl', 'Réglages')!;
    expect(m.indices).toEqual([0, 1, 2, 3]);
    expect(highlightRuns('Réglages', m.indices)).toEqual([
      { text: 'Régl', hit: true },
      { text: 'ages', hit: false },
    ]);
  });

  it('matches every word of a query across fields', () => {
    const fields = [
      { text: 'Split at playhead', weight: 1 },
      { text: 'Clip', weight: 0.6 },
    ];
    expect(matchFields('clip split', fields)).not.toBeNull();
    expect(matchFields('clip banana', fields)).toBeNull();
  });

  it('ranks the best match first and boosts recent items', () => {
    const item = (key: string, title: string, boost = 0): Rankable => ({ key, fields: [{ text: title, weight: 1 }], boost });
    const items = [item('a', 'Save as…'), item('b', 'Save'), item('c', 'Safe zones'), item('d', 'Open project…')];
    const ranked = rankItems('save', items);
    expect(ranked[0].item.key).toBe('b');
    expect(ranked.map((r) => r.item.key)).not.toContain('d');
    // A recent item wins a near tie…
    const tie = [item('x', 'Zoom in'), item('y', 'Zoom out')];
    expect(rankItems('zoom', tie, ['y'])[0].item.key).toBe('y');
    // …but not over a clearly better match.
    expect(rankItems('save', items, ['c'])[0].item.key).toBe('b');
    expect(rankItems('sa', items, [], 2)).toHaveLength(2);
    // A word in the title beats an exact match on a keyword of another item.
    const titled: Rankable = { key: 't', fields: [{ text: 'Cross Zoom', weight: 1 }, { text: 'Transition', weight: 0.45 }] };
    const keyworded: Rankable = { key: 'k', fields: [{ text: 'Focus Speed Lines', weight: 1 }, { text: 'zoom', weight: 0.4 }] };
    expect(rankItems('zoom', [keyworded, titled])[0].item.key).toBe('t');
  });
});

// ---------------------------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------------------------

describe('keymap', () => {
  it('normalises shortcut strings', () => {
    expect(normalizeShortcut('ctrl+shift+k')).toBe('Ctrl+Shift+K');
    expect(normalizeShortcut('Shift + Ctrl + K')).toBe('Ctrl+Shift+K');
    expect(normalizeShortcut('Cmd+Z')).toBe('Ctrl+Z');
    expect(normalizeShortcut('Del')).toBe('Delete');
    expect(normalizeShortcut('Shift+Del')).toBe('Shift+Delete');
    expect(normalizeShortcut('alt+left')).toBe('Alt+ArrowLeft');
    expect(normalizeShortcut('space')).toBe('Space');
    expect(normalizeShortcut('f6')).toBe('F6');
    expect(normalizeShortcut('Ctrl++')).toBe('Ctrl++');
    expect(normalizeShortcut('Ctrl+,')).toBe('Ctrl+,');
    expect(normalizeShortcut('−')).toBe('-');
    // Symbols are written as the character they type: Shift is implied.
    expect(normalizeShortcut('Shift+?')).toBe('?');
    expect(normalizeShortcut('')).toBeNull();
    expect(normalizeShortcut('Ctrl+')).toBeNull();
    expect(normalizeShortcut('Ctrl+Foo')).toBeNull();
    expect(parseShortcut('Alt+Shift+ArrowRight')).toEqual({ ctrl: false, alt: true, shift: true, key: 'ArrowRight' });
  });

  it('turns key events into shortcuts', () => {
    const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}, code?: string) => ({
      key,
      code,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(eventToShortcut(ev('k', { ctrlKey: true }))).toBe('Ctrl+K');
    expect(eventToShortcut(ev('P', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
    expect(eventToShortcut(ev('?', { shiftKey: true }, 'Slash'))).toBe('?');
    expect(eventToShortcut(ev(' '))).toBe('Space');
    expect(eventToShortcut(ev('ArrowLeft', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+ArrowLeft');
    expect(eventToShortcut(ev('z', { metaKey: true }))).toBe('Ctrl+Z');
    expect(eventToShortcut(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(eventToShortcut(ev('Dead'))).toBeNull();
    // Digits typed with Shift also match the physical key; non-Latin layouts use the key position.
    expect(eventToShortcuts(ev('!', { ctrlKey: true, shiftKey: true }, 'Digit1'))).toEqual(['Ctrl+!', 'Ctrl+Shift+1']);
    expect(eventToShortcut(ev('ड', { ctrlKey: true }, 'KeyS'))).toBe('Ctrl+S');
  });

  it('resolves defaults, overrides and conflicts', () => {
    const commands = [
      { id: 'edit.undo', shortcut: 'Ctrl+Z' },
      { id: 'edit.redo', shortcut: 'Ctrl+Shift+Z', extraShortcuts: ['Ctrl+Y'] },
      { id: 'clip.split', shortcut: 'S' },
      { id: 'x.feature', shortcut: 's' },
      { id: 'no.keys' },
    ];
    expect(defaultBindings(commands[1])).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
    let bindings = resolveBindings(commands, {});
    expect(findConflicts(bindings)).toEqual(new Map([['S', ['clip.split', 'x.feature']]]));
    expect(conflictsFor(bindings, 'ctrl+y', 'edit.undo')).toEqual(['edit.redo']);
    expect(indexBindings(bindings).get('Ctrl+Z')).toEqual(['edit.undo']);

    // Rebinding: overrides store the full list; defaults are dropped again on reset.
    let overrides = withBindings({}, commands[3], ['Alt+S']);
    expect(overrides).toEqual({ 'x.feature': ['Alt+S'] });
    bindings = resolveBindings(commands, overrides);
    expect(findConflicts(bindings).size).toBe(0);
    overrides = withBindings(overrides, commands[3], ['S']);
    expect(overrides).toEqual({});
    overrides = withBindings({}, commands[0], []);
    expect(resolveBindings(commands, overrides).get('edit.undo')).toEqual([]);
    expect(parseOverrides({ a: ['ctrl+k', 3, 'Bogus+Key'], b: 'nope' })).toEqual({ a: ['Ctrl+K'] });
  });

  it('formats key caps for display', () => {
    expect(shortcutKeys('Ctrl+Shift+ArrowLeft')).toEqual(['Ctrl', 'Shift', '←']);
    expect(shortcutLabel('Shift+Delete')).toBe('Shift+Del');
    expect(shortcutLabel('Ctrl+S', (k) => (k === 'Ctrl' ? 'Strg' : k))).toBe('Strg+S');
  });
});

// ---------------------------------------------------------------------------------------------
// Project paths
// ---------------------------------------------------------------------------------------------

const asset = (id: string, path: string, proxy?: string): MediaAsset => ({
  id,
  kind: 'video',
  name: path.replace(/^.*[\\/]/, ''),
  source: { type: 'file', path },
  duration: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1000,
  addedAt: 0,
  ...(proxy ? { proxy: { path: proxy, width: 960, height: 540 } } : {}),
});

describe('project paths', () => {
  it('understands Windows and POSIX paths', () => {
    expect(isAbsolutePath('C:\\a\\b.mp4')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share\\a.mp4')).toBe(true);
    expect(isAbsolutePath('/home/me/a.mp4')).toBe(true);
    expect(isAbsolutePath('Media/a.mp4')).toBe(false);
    expect(dirnamePath('C:\\Projects\\Film\\Film.kinora')).toBe('C:\\Projects\\Film');
    expect(normalizePath('C:/Projects/./Film/../Film/Media/a.mp4')).toBe('C:\\Projects\\Film\\Media\\a.mp4');
    expect(relativeInside('C:\\Projects\\Film', 'c:\\projects\\film\\Media\\a.mp4')).toBe('Media/a.mp4');
    expect(relativeInside('C:\\Projects\\Film', 'C:\\Projects\\Film2\\a.mp4')).toBeNull();
    expect(relativeInside('C:\\Projects\\Film', 'D:\\Projects\\Film\\a.mp4')).toBeNull();
    expect(relativeInside('/home/me/film', '/home/me/film/Media/a.mp4')).toBe('Media/a.mp4');
    expect(resolveFrom('C:\\Projects\\Film', 'Media/a.mp4')).toBe('C:\\Projects\\Film\\Media\\a.mp4');
    expect(resolveFrom('/home/me/film', 'Media/a.mp4')).toBe('/home/me/film/Media/a.mp4');
    expect(resolveFrom('C:\\Projects\\Film', 'D:\\Other\\b.mp4')).toBe('D:\\Other\\b.mp4');
    expect(uniqueFileName('clip.mp4', new Set(['clip.mp4', 'clip (2).mp4']))).toBe('clip (3).mp4');
    expect(uniqueFileName('README', new Set(['readme']))).toBe('README (2)');
  });

  it('stores media inside the project folder relative to the project file and round-trips', () => {
    const p = createProject({ width: 1920, height: 1080, fps: 30 });
    const inside = asset('a1', 'C:\\Work\\Film\\Media\\clip.mp4', 'C:\\Work\\Film\\Media\\Proxies\\clip.mp4');
    const outside = asset('a2', 'D:\\Footage\\b-roll.mov');
    p.assets = { a1: inside, a2: outside };
    const clip = makeVideo(inside);
    clip.trackId = p.tracks[0].id;
    p.clips[clip.id] = clip;

    const projectPath = 'C:\\Work\\Film\\Film.kinora';
    const text = serializeProject(p, { projectPath });
    const raw = JSON.parse(text);
    expect(raw.project.assets.a1.source.path).toBe('Media/clip.mp4');
    expect(raw.project.assets.a1.proxy.path).toBe('Media/Proxies/clip.mp4');
    expect(raw.project.assets.a2.source.path).toBe('D:\\Footage\\b-roll.mov');
    // The in-memory project is untouched.
    expect(p.assets.a1.source).toEqual({ type: 'file', path: 'C:\\Work\\Film\\Media\\clip.mp4' });

    const back = parseProjectFile(text, { projectPath });
    expect(back.assets.a1.source).toEqual({ type: 'file', path: 'C:\\Work\\Film\\Media\\clip.mp4' });
    expect(back.assets.a1.proxy?.path).toBe('C:\\Work\\Film\\Media\\Proxies\\clip.mp4');
    expect(back.assets.a2.source).toEqual({ type: 'file', path: 'D:\\Footage\\b-roll.mov' });
    expect(Object.keys(back.clips)).toEqual([clip.id]);

    // The folder moved to another drive: relative media follows it.
    const moved = parseProjectFile(text, { projectPath: 'E:\\Archive\\Film\\Film.kinora' });
    expect(moved.assets.a1.source).toEqual({ type: 'file', path: 'E:\\Archive\\Film\\Media\\clip.mp4' });

    // Without a project path (and for older absolute-only files) nothing changes.
    const plain = serializeProject(p);
    expect(JSON.parse(plain).project.assets.a1.source.path).toBe('C:\\Work\\Film\\Media\\clip.mp4');
    expect(parseProjectFile(plain, { projectPath }).assets.a1.source).toEqual({ type: 'file', path: 'C:\\Work\\Film\\Media\\clip.mp4' });
  });
});

// ---------------------------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------------------------

describe('i18n formatting', () => {
  it('interpolates values', () => {
    expect(formatMessage('Hello', undefined, 'en')).toBe('Hello');
    expect(formatMessage('Save changes to “{name}”?', { name: 'Trip' }, 'en')).toBe('Save changes to “Trip”?');
    expect(formatMessage('{a} and {b}', { a: 1 }, 'en')).toBe('1 and {b}');
    expect(formatMessage('{n, number}', { n: 1234567.891 }, 'en')).toBe('1,234,567.89');
    expect(formatMessage('{n, number}', { n: 1234567.891 }, 'de')).toBe('1.234.567,89');
    expect(formatMessage('{p, number, percent}', { p: 0.25 }, 'fr')).toMatch(/^25\s?%$/);
    expect(formatMessage("It''s '{literal}'", undefined, 'en')).toBe("It's {literal}");
    expect(formatMessage('{when, date, short}', { when: new Date(2026, 0, 31) }, 'en')).toBe('1/31/26');
  });

  it('selects plural forms with the locale rules', () => {
    const msg = '{count, plural, =0 {No files} one {# file} other {# files}}';
    expect(formatMessage(msg, { count: 0 }, 'en')).toBe('No files');
    expect(formatMessage(msg, { count: 1 }, 'en')).toBe('1 file');
    expect(formatMessage(msg, { count: 1200 }, 'en')).toBe('1,200 files');
    // French treats 0 and 1 as singular; English does not.
    const fr = '{count, plural, one {# fichier} other {# fichiers}}';
    expect(formatMessage(fr, { count: 0 }, 'fr')).toBe('0 fichier');
    expect(formatMessage(fr, { count: 2 }, 'fr')).toBe('2 fichiers');
    expect(formatMessage('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', { n: 22 }, 'en')).toBe('22nd');
    expect(formatMessage('{kind, select, video {Video} other {Media}}', { kind: 'video' }, 'en')).toBe('Video');
    expect(formatMessage('{kind, select, video {Video} other {Media}}', { kind: 'x' }, 'en')).toBe('Media');
    expect(formatMessage('{n, plural, one {# clip in {track}} other {# clips in {track}}}', { n: 2, track: 'V1' }, 'en')).toBe('2 clips in V1');
    expect(messageArguments('{n, plural, one {# in {track}} other {#}} {name}')).toEqual(['n', 'name', 'track']);
  });

  it('formats relative times and sizes', () => {
    const now = Date.UTC(2026, 10, 16, 12);
    expect(formatRelativeTime(now - 3 * 60_000, 'en', now)).toBe('3 minutes ago');
    expect(formatRelativeTime(now - 26 * 3600_000, 'en', now)).toBe('yesterday');
    expect(formatRelativeTime(now - 2 * 3600_000, 'es', now)).toBe('hace 2 horas');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3, 'de')).toBe('5 GB');
  });

  it('matches system languages', () => {
    expect(matchLanguage(['pt-PT'])).toBe('pt-BR');
    expect(matchLanguage(['de-AT', 'en'])).toBe('de');
    expect(matchLanguage(['ja', 'zh'])).toBe('en');
    expect(matchLanguage(['hi-IN'])).toBe('hi');
  });
});

// ---------------------------------------------------------------------------------------------
// Translations: every source string used by the translated files exists in every locale and
// keeps its placeholders (same extraction as `node scripts/i18n.mjs`).
// ---------------------------------------------------------------------------------------------

describe('translations', () => {
  const keys = extractKeys();

  it('extracts the source strings', () => {
    expect(keys.size).toBeGreaterThan(250);
    expect(keys.has('Collect project…')).toBe(true);
    expect(keys.has('Save changes to “{name}”?')).toBe(true);
    expect(keys.has('menu|File')).toBe(true);
  });

  for (const lang of LANGUAGES.filter((l) => l.code !== 'en')) {
    it(`${lang.code} translates every string with the same placeholders`, () => {
      const dict = loadLocale(lang.code);
      expect([...keys].filter((k) => !(k in dict))).toEqual([]);
      const bad: string[] = [];
      for (const [k, v] of Object.entries(dict)) {
        const source = /^[a-z]+\|/.test(k) ? k.slice(k.indexOf('|') + 1) : k;
        if (typeof v !== 'string' || v.trim() === '') bad.push(`${k}: empty`);
        else if (messageArguments(source).join() !== messageArguments(v).join()) bad.push(`${k}: placeholders differ`);
      }
      expect(bad).toEqual([]);
    });
  }
});
