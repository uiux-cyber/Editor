/**
 * The endless Motion library. A version of a ready-made clip is fully described by
 * (design, palette, font pair, look, sample words, seed), so it can be rebuilt at any size and is
 * stable across sessions. Page 0 shows every design as its author made it; later pages restyle each
 * design with a new palette, font pair, look, sample words and seed.
 *
 * Pure: the presets, palettes and fonts come in through a MotionLibrary, so the contact-sheet
 * script can use this without the app.
 */

import { hashString, seededRandom } from '@/core/easing';
import { motionParamValues, type MotionBrandRole, type MotionParam, type MotionValue } from '@shared/motion';
import type { MotionCategory, MotionPresetDef } from './motionPresets';
import type { FontPair, Palette } from './types';

export interface MotionLibrary {
  presets: MotionPresetDef[];
  palettes: Palette[];
  fontPairs: FontPair[];
  /** The Motion font for a font family, or null when the sandbox does not have it. */
  fontFor: (family: string) => string | null;
}

/** Colours, fonts and name a version is styled with (a library palette, or the brand kit). */
export interface MotionTheme {
  palette: Palette;
  fonts: FontPair;
  /** Fills settings linked to the brand name. */
  name?: string;
}

export const MOTION_BRAND_ID = '__brand';
/** The design's own colours and fonts. */
export const MOTION_OWN_ID = '';

export interface MotionVariation {
  /** Unique, stable key. */
  key: string;
  presetId: string;
  /** A palette id, MOTION_OWN_ID or MOTION_BRAND_ID. */
  paletteId: string;
  fontPairId: string;
  /** 0 = the defaults, n = looks[n - 1]. */
  look: number;
  /** 0 = the default words, n = copy[n - 1]. */
  copy: number;
  /** Clip seed (k.random, k.rand); also picks the varied settings. */
  seed: number;
  /** Pick the `vary` settings at random. */
  random: boolean;
}

const PALETTE_ROLES: Partial<Record<MotionBrandRole, keyof Palette>> = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
  background: 'bg',
  surface: 'surface',
  text: 'text',
  muted: 'textMuted',
  'on-primary': 'onPrimary',
};

/** Settings a theme gives values (colours and fonts by role, the name). */
export function themeValues(params: MotionParam[], theme: MotionTheme, fontFor: MotionLibrary['fontFor']): Record<string, MotionValue> {
  const out: Record<string, MotionValue> = {};
  for (const p of params) {
    if (!p.brand) continue;
    const field = PALETTE_ROLES[p.brand];
    if (field && p.type === 'color') out[p.id] = theme.palette[field] as string;
    else if ((p.brand === 'heading' || p.brand === 'body') && p.type === 'font') {
      const f = fontFor(theme.fonts[p.brand].family);
      if (f) out[p.id] = f;
    } else if (p.brand === 'name' && p.type === 'text' && theme.name?.trim()) out[p.id] = theme.name.trim();
  }
  return out;
}

/** Settings picked at random: those listed in `vary`, else the selects no look sets. */
function variedIds(preset: MotionPresetDef): string[] {
  if (preset.vary) return preset.vary;
  const byLooks = new Set((preset.looks ?? []).flatMap((l) => Object.keys(l)));
  return preset.params.filter((p) => p.type === 'select' && !byLooks.has(p.id)).map((p) => p.id);
}

function randomValue(p: MotionParam, rnd: () => number): MotionValue | undefined {
  switch (p.type) {
    case 'select':
      return p.options?.length ? p.options[Math.floor(rnd() * p.options.length) % p.options.length] : undefined;
    case 'toggle':
      return rnd() < 0.5;
    case 'number': {
      const min = p.min ?? 0;
      const max = p.max ?? 1;
      // Stay away from the extremes: they are there for people, not for a gallery.
      const lo = min + (max - min) * 0.2;
      const hi = max - (max - min) * 0.2;
      const step = p.step && p.step > 0 ? p.step : 0;
      let v = lo + rnd() * (hi - lo);
      if (step) v = min + Math.round((v - min) / step) * step;
      return Math.min(max, Math.max(min, Number(v.toFixed(6))));
    }
    default:
      return undefined;
  }
}

/** Every setting's value for a version of a design (defaults filled in). */
export function variationValues(preset: MotionPresetDef, v: Pick<MotionVariation, 'look' | 'copy' | 'seed' | 'random'>, theme: MotionTheme | null, fontFor: MotionLibrary['fontFor']): Record<string, MotionValue> {
  const chosen: Record<string, MotionValue> = {};
  if (v.random) {
    const rnd = seededRandom(v.seed ^ 0x2c1b3c6d);
    for (const id of variedIds(preset)) {
      const p = preset.params.find((x) => x.id === id);
      const value = p && randomValue(p, rnd);
      if (value !== undefined) chosen[id] = value;
    }
  }
  const look = v.look > 0 ? preset.looks?.[(v.look - 1) % preset.looks.length] : undefined;
  if (look) Object.assign(chosen, look);
  const copy = v.copy > 0 ? preset.copy?.[(v.copy - 1) % preset.copy.length] : undefined;
  if (copy) Object.assign(chosen, copy);
  // The theme last: the brand name wins over sample words.
  if (theme) Object.assign(chosen, themeValues(preset.params, theme, fontFor));
  return motionParamValues(preset.params, chosen);
}

/** The values of a version that differ from the design's defaults. */
export function changedVariationValues(preset: MotionPresetDef, all: Record<string, MotionValue>): Record<string, MotionValue> {
  const out: Record<string, MotionValue> = {};
  for (const p of preset.params) if (all[p.id] !== undefined && all[p.id] !== p.default) out[p.id] = all[p.id];
  return out;
}

// ---------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------

export interface MotionQuery {
  category?: MotionCategory | 'all';
  search?: string;
  /** Style every version with this theme (the brand kit) and its revision. */
  brand?: { theme: MotionTheme; revision: number } | null;
}

/** Pages shown with the brand kit: colours and fonts are fixed, so only looks and words change. */
export const MOTION_BRAND_PAGES = 4;

/** Seed of the n-th version of a design. */
const seedFor = (preset: MotionPresetDef, n: number): number => (hashString(preset.id) ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;

/** The n-th version of a design: n = 0 is the design as made; later ones restyle it. */
export function variationOf(lib: MotionLibrary, preset: MotionPresetDef, n: number, brand?: MotionQuery['brand']): MotionVariation {
  const looks = (preset.looks?.length ?? 0) + 1;
  const copies = (preset.copy?.length ?? 0) + 1;
  const seed = seedFor(preset, n);
  if (brand) {
    const look = n % looks;
    const copy = n % copies;
    return { key: `${preset.id}:brand${brand.revision}:${look}:${copy}:${seed}`, presetId: preset.id, paletteId: MOTION_BRAND_ID, fontPairId: MOTION_BRAND_ID, look, copy, seed, random: n > 0 };
  }
  if (n === 0 || !lib.palettes.length || !lib.fontPairs.length) {
    return { key: `${preset.id}:own:0:0:${seed}`, presetId: preset.id, paletteId: MOTION_OWN_ID, fontPairId: MOTION_OWN_ID, look: 0, copy: 0, seed, random: false };
  }
  const h = hashString(preset.id);
  // Co-prime strides walk through palettes, fonts, looks and words without lining up.
  const palette = lib.palettes[(h + n * 7) % lib.palettes.length];
  const fonts = lib.fontPairs[((h >>> 5) + n * 3) % lib.fontPairs.length];
  const look = ((h >>> 9) + n) % looks;
  const copy = ((h >>> 13) + n * 5) % copies;
  return { key: `${preset.id}:${palette.id}:${fonts.id}:${look}:${copy}:${seed}`, presetId: preset.id, paletteId: palette.id, fontPairId: fonts.id, look, copy, seed, random: true };
}

/** The theme a version is styled with (null: the design's own colours). */
export function variationTheme(lib: MotionLibrary, v: MotionVariation, brand?: MotionQuery['brand']): MotionTheme | null {
  if (v.paletteId === MOTION_BRAND_ID) return brand?.theme ?? null;
  const palette = lib.palettes.find((p) => p.id === v.paletteId);
  const fonts = lib.fontPairs.find((f) => f.id === v.fontPairId);
  return palette && fonts ? { palette, fonts } : null;
}

const searchText = (p: MotionPresetDef): string => [p.name, p.category, p.about, ...(p.tags ?? [])].join(' ').toLowerCase();

/** Round-robin across categories so the first screen of "All" shows a bit of everything. */
function interleave(list: MotionPresetDef[]): MotionPresetDef[] {
  const groups = new Map<MotionCategory, MotionPresetDef[]>();
  for (const p of list) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category)!.push(p);
  }
  const ordered = [...groups.values()];
  const out: MotionPresetDef[] = [];
  for (let i = 0; out.length < list.length; i++) for (const g of ordered) if (g[i]) out.push(g[i]);
  return out;
}

/** Designs matching a query, in display order. */
export function matchingPresets(lib: MotionLibrary, q: MotionQuery): MotionPresetDef[] {
  const words = (q.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = lib.presets.filter((p) => (!q.category || q.category === 'all' || p.category === q.category) && words.every((w) => searchText(p).includes(w)));
  return q.category && q.category !== 'all' ? list : interleave(list);
}

/** False once the feed has nothing new to show. */
export const motionHasMore = (q: MotionQuery, pages: number): boolean => !(q.brand && pages >= MOTION_BRAND_PAGES);

/** One page of the endless feed: every matching design once, each in a new version. */
export function motionPage(lib: MotionLibrary, q: MotionQuery, page: number): MotionVariation[] {
  if (q.brand && page >= MOTION_BRAND_PAGES) return [];
  const list = matchingPresets(lib, q).map((p) => variationOf(lib, p, page, q.brand));
  if (page === 0) return list;
  const rnd = seededRandom(0x6d07 + page * 977);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Another version of the same design (a new palette, font pair, look and seed). */
export function shuffleMotion(lib: MotionLibrary, v: MotionVariation, brand?: MotionQuery['brand']): MotionVariation {
  const preset = lib.presets.find((p) => p.id === v.presetId);
  if (!preset) return v;
  return variationOf(lib, preset, 1 + Math.floor(Math.random() * 5000), v.paletteId === MOTION_BRAND_ID ? brand : null);
}

/** The values and seed to build a version with. */
export function resolveVariation(lib: MotionLibrary, v: MotionVariation, brand?: MotionQuery['brand']): { preset: MotionPresetDef; values: Record<string, MotionValue>; changed: Record<string, MotionValue>; seed: number } | null {
  const preset = lib.presets.find((p) => p.id === v.presetId);
  if (!preset) return null;
  const values = variationValues(preset, v, variationTheme(lib, v, brand), lib.fontFor);
  return { preset, values, changed: changedVariationValues(preset, values), seed: v.paletteId === MOTION_OWN_ID ? 1 : v.seed };
}

/** Colours to draw a library tile's backdrop with (transparent clips need something behind them). */
export function backdropFor(lib: MotionLibrary, v: MotionVariation, brand?: MotionQuery['brand']): { bg: string; bg2: string } {
  const theme = variationTheme(lib, v, brand);
  if (theme) return { bg: theme.palette.bg, bg2: theme.palette.bg2 };
  return { bg: '#14161d', bg2: '#262a36' };
}
