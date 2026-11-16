/**
 * Turns parametric template designs into concrete, endlessly varied instances.
 * A variation is fully described by (template, palette, font pair, seed), so it can be rebuilt
 * for any aspect ratio and is stable across sessions.
 */

import { hashString, seededRandom } from '@/core/easing';
import type { Clip } from '@/core/types';
import { FONT_PAIRS, PALETTES, TEMPLATES, getFontPair, getPalette, getTemplate } from './index';
import type { AspectId, FontPair, Palette, TemplateCategory, TemplateDef } from './types';

export interface TemplateVariation {
  /** Unique, stable key. */
  key: string;
  templateId: string;
  paletteId: string;
  fontPairId: string;
  seed: number;
}

export const ASPECT_SIZES: Record<AspectId, { cw: number; ch: number }> = {
  '16:9': { cw: 1920, ch: 1080 },
  '9:16': { cw: 1080, ch: 1920 },
  '1:1': { cw: 1080, ch: 1080 },
  '4:5': { cw: 1080, ch: 1350 },
};

/** The supported aspect closest to a composition size. */
export function aspectIdFor(cw: number, ch: number): AspectId {
  const ratio = cw / ch;
  let best: AspectId = '16:9';
  let bestDiff = Infinity;
  for (const [id, size] of Object.entries(ASPECT_SIZES) as [AspectId, { cw: number; ch: number }][]) {
    const diff = Math.abs(Math.log(ratio / (size.cw / size.ch)));
    if (diff < bestDiff) {
      best = id;
      bestDiff = diff;
    }
  }
  return best;
}

const FALLBACK_PALETTE: Palette = {
  id: '_fallback',
  name: 'Default',
  dark: true,
  bg: '#0d0f14',
  bg2: '#1a1e29',
  surface: '#222838',
  primary: '#7c5cff',
  secondary: '#22d3ee',
  accent: '#ffb020',
  text: '#ffffff',
  textMuted: '#a7b0c2',
  onPrimary: '#ffffff',
};
const FALLBACK_FONTS: FontPair = { id: '_fallback', name: 'Default', heading: { family: 'Montserrat', weight: 800 }, body: { family: 'Inter', weight: 500 } };

export const supportsAspect = (def: TemplateDef, aspect: AspectId): boolean => !def.aspects || def.aspects.includes(aspect);

/** Build the clips of a variation for a composition of `cw × ch` design px. */
export function buildTemplate(v: TemplateVariation, cw: number, ch: number, duration?: number): { clips: Clip[]; duration: number; def: TemplateDef } | null {
  const def = getTemplate(v.templateId);
  if (!def) return null;
  const total = duration ?? def.duration;
  try {
    const clips = def.build({
      cw,
      ch,
      aspect: aspectIdFor(cw, ch),
      portrait: ch > cw * 1.05,
      square: Math.abs(cw - ch) < cw * 0.05,
      palette: getPalette(v.paletteId) ?? PALETTES[0] ?? FALLBACK_PALETTE,
      fonts: getFontPair(v.fontPairId) ?? FONT_PAIRS[0] ?? FALLBACK_FONTS,
      rng: seededRandom(v.seed),
      duration: total,
    });
    return { clips: clips.filter((c) => c.duration > 0 && c.start >= 0), duration: total, def };
  } catch (err) {
    console.warn(`[templates] "${v.templateId}" failed to build`, err);
    return null;
  }
}

function variation(def: TemplateDef, n: number): TemplateVariation {
  const h = hashString(def.id);
  const palettes = PALETTES.length ? PALETTES : [FALLBACK_PALETTE];
  const fonts = FONT_PAIRS.length ? FONT_PAIRS : [FALLBACK_FONTS];
  // Co-prime strides walk through every palette × font combination before repeating.
  const palette = palettes[(h + n * 7) % palettes.length];
  const fontPair = fonts[((h >>> 5) + n * 3) % fonts.length];
  const seed = (h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  return { key: `${def.id}:${palette.id}:${fontPair.id}:${seed}`, templateId: def.id, paletteId: palette.id, fontPairId: fontPair.id, seed };
}

export interface VariationQuery {
  aspect: AspectId;
  category?: TemplateCategory | 'all';
  search?: string;
}

/** Display order of template categories (most used first). */
export const TEMPLATE_CATEGORY_ORDER: TemplateCategory[] = ['intro', 'title', 'social', 'promo', 'youtube', 'slideshow', 'lower-third', 'outro', 'quote', 'business', 'event', 'vlog', 'news', 'gaming', 'countdown'];

const categoryRank = (c: TemplateCategory): number => {
  const i = TEMPLATE_CATEGORY_ORDER.indexOf(c);
  return i < 0 ? TEMPLATE_CATEGORY_ORDER.length : i;
};

/** Sort category ids into display order. */
export const sortCategories = (list: TemplateCategory[]): TemplateCategory[] => [...list].sort((a, b) => categoryRank(a) - categoryRank(b));

/** Round-robin across categories so the first screen of "All" shows a bit of everything. */
function interleave(defs: TemplateDef[]): TemplateDef[] {
  const groups = new Map<TemplateCategory, TemplateDef[]>();
  for (const d of defs) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category)!.push(d);
  }
  const ordered = sortCategories([...groups.keys()]).map((c) => groups.get(c)!);
  const out: TemplateDef[] = [];
  for (let i = 0; out.length < defs.length; i++) for (const g of ordered) if (g[i]) out.push(g[i]);
  return out;
}

function matching(q: VariationQuery): TemplateDef[] {
  const term = q.search?.trim().toLowerCase();
  const list = TEMPLATES.filter((def) => {
    if (!supportsAspect(def, q.aspect)) return false;
    if (q.category && q.category !== 'all' && def.category !== q.category) return false;
    if (term && !(def.name.toLowerCase().includes(term) || def.category.includes(term) || def.tags.some((t) => t.toLowerCase().includes(term)))) return false;
    return true;
  });
  return interleave(list);
}

/**
 * One page of the endless gallery: every matching design once, each in a new colour / type
 * combination. Page 0 shows the designs in their library order; later pages are shuffled so the
 * feed keeps feeling fresh.
 */
export function variationPage(q: VariationQuery, page: number): TemplateVariation[] {
  const defs = matching(q);
  if (defs.length === 0) return [];
  const list = defs.map((def) => variation(def, page));
  if (page === 0) return list;
  const rnd = seededRandom(0x51ed + page * 977);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export const templateCount = (q: VariationQuery): number => matching(q).length;

/** How many distinct looks exist per design (palette × type), for the "endless" badge. */
export const looksPerDesign = (): number => Math.max(1, PALETTES.length) * Math.max(1, FONT_PAIRS.length);

/** A different colour / type treatment of the same design. */
export function shuffleVariation(v: TemplateVariation): TemplateVariation {
  const def = getTemplate(v.templateId);
  if (!def) return v;
  return variation(def, (v.seed % 9973) + 1 + Math.floor(Math.random() * 5000));
}
