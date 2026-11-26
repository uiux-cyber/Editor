/**
 * Turns parametric template designs into concrete, endlessly varied instances.
 * A variation is fully described by (template, palette, font pair, seed), so it can be rebuilt
 * for any aspect ratio and is stable across sessions.
 */

import { hashString, seededRandom } from '@/core/easing';
import { makeImage, uid } from '@/core/factory';
import { fitContain } from '@/core/project';
import { motionFontFamily, normalizeMotionMeta, type MotionValue } from '@shared/motion';
import { getMotionPreset } from './motionPresets';
import { themeValues } from './motionVariations';
import type { Clip, ImageClip, Keyframe, MediaAsset, ShapeClip } from '@/core/types';
import { BRAND_FONTS_ID, BRAND_PALETTE_ID } from './brand';
import { FONT_PAIRS, PALETTES, TEMPLATES, getFontPair, getPalette, getTemplate } from './index';
import { generatedCategories, generatedPage } from './templates/_gen';
import type { AspectId, FontPair, Palette, TemplateCategory, TemplateDef, TemplateEnv, TemplateMotionOptions } from './types';

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

// ---------------------------------------------------------------------------------------------
// Brand kit ("Use my brand")
// ---------------------------------------------------------------------------------------------

/** What the template engine needs from the user's brand kit (installed by the UI). */
export interface TemplateBrand {
  /** Changes whenever the kit changes (part of variation keys, so thumbnails refresh). */
  revision: number;
  palette: Palette;
  fonts: FontPair;
  /** Picture placed into `Logo` placeholders, if the kit has a logo. */
  logo: MediaAsset | null;
}

let brand: TemplateBrand | null = null;

/** Install (or clear) the brand used by brand variations. */
export function setTemplateBrand(b: TemplateBrand | null): void {
  brand = b;
}
export const templateBrand = (): TemplateBrand | null => brand;

/** True when a variation renders with the brand kit. */
export const isBrandVariation = (v: TemplateVariation): boolean => v.paletteId === BRAND_PALETTE_ID;

/** Placeholders named `Logo` receive the brand logo. */
export const isLogoSlot = (c: Clip): c is ShapeClip => c.type === 'shape' && !!c.shape.slot && c.name.trim().toLowerCase() === 'logo';

/**
 * Replace `Logo` placeholders with the logo picture, fitted inside the placeholder (never
 * cropped) and keeping its timing, placement and animation. Round placeholders get more margin.
 */
export function fillLogoSlots(clips: Clip[], logo: MediaAsset, cw: number, ch: number): Clip[] {
  return clips.map((c) => {
    if (!isLogoSlot(c)) return c;
    const base = fitContain(logo.width || 512, logo.height || 512, cw, ch);
    const round = c.shape.kind === 'ellipse' || c.shape.radius >= Math.min(c.shape.width, c.shape.height) * 0.45;
    const inset = round ? 0.7 : 0.88;
    const k = Math.min((c.shape.width * inset) / base.w, (c.shape.height * inset) / base.h);
    const scaled = (frames: Keyframe[] | undefined): Keyframe[] | undefined => frames?.map((f) => ({ ...f, v: f.v * k }));
    let keyframes: ImageClip['keyframes'];
    if (c.keyframes) {
      keyframes = { ...c.keyframes };
      if (c.keyframes.scaleX) keyframes.scaleX = scaled(c.keyframes.scaleX);
      if (c.keyframes.scaleY) keyframes.scaleY = scaled(c.keyframes.scaleY);
    }
    const img: ImageClip = {
      id: c.id,
      trackId: c.trackId,
      name: 'Logo',
      start: c.start,
      duration: c.duration,
      ...(keyframes ? { keyframes } : {}),
      transform: { ...c.transform, scaleX: c.transform.scaleX * k, scaleY: c.transform.scaleY * k },
      blendMode: c.blendMode,
      effects: [],
      ...(c.anim ? { anim: c.anim } : {}),
      type: 'image',
      assetId: logo.id,
    };
    return img;
  });
}

/**
 * `env.motion` for a build: Motion library designs as full-frame layers, styled with the palette
 * and fonts. The in-memory clips are collected in `assets` (applying a template saves them as
 * .kmotion files).
 */
export function templateMotion(o: { cw: number; ch: number; palette: Palette; fonts: FontPair; duration: number; seed: number; assets: MediaAsset[] }): TemplateEnv['motion'] {
  let n = 0;
  return (presetId: string, opts: TemplateMotionOptions = {}) => {
    const preset = getMotionPreset(presetId);
    if (!preset) return null;
    const start = Math.max(0, opts.start ?? 0);
    const duration = Math.max(0.2, opts.duration ?? o.duration - start);
    const chosen: Record<string, MotionValue> = { ...themeValues(preset.params, { palette: o.palette, fonts: o.fonts }, motionFontFamily), ...(opts.values ?? {}) };
    const params = preset.params.map((p) => (p.id in chosen ? { ...p, default: chosen[p.id] } : p));
    const name = opts.name ?? preset.name;
    const seed = ((o.seed ^ Math.imul(++n, 0x9e3779b1)) >>> 0) || 1;
    const meta = normalizeMotionMeta({ name, width: o.cw, height: o.ch, duration, fps: 30, seed, params }, { width: o.cw, height: o.ch, fps: 30, name });
    const asset: MediaAsset = {
      id: uid('tm_'),
      kind: 'animation',
      format: 'motion',
      name,
      source: { type: 'motion', code: preset.code, meta },
      duration: meta.duration,
      width: o.cw,
      height: o.ch,
      fps: meta.fps,
      hasVideo: true,
      hasAudio: false,
      size: 0,
      addedAt: 0,
    };
    o.assets.push(asset);
    return makeImage(asset, { ...(opts.layer ?? {}), name, start, duration });
  };
}

export interface BuiltTemplate {
  clips: Clip[];
  duration: number;
  def: TemplateDef;
  /** Media the clips reference (embedded media, the brand logo): add them to the project. */
  assets: MediaAsset[];
}

/** Build the clips of a variation for a composition of `cw × ch` design px. */
export function buildTemplate(v: TemplateVariation, cw: number, ch: number, duration?: number): BuiltTemplate | null {
  const def = getTemplate(v.templateId);
  if (!def) return null;
  const total = duration ?? def.duration;
  const branded = isBrandVariation(v) ? brand : null;
  const palette = branded?.palette ?? getPalette(v.paletteId) ?? PALETTES[0] ?? FALLBACK_PALETTE;
  const fonts = branded?.fonts ?? getFontPair(v.fontPairId) ?? FONT_PAIRS[0] ?? FALLBACK_FONTS;
  const motionAssets: MediaAsset[] = [];
  try {
    let clips = def.build({
      cw,
      ch,
      aspect: aspectIdFor(cw, ch),
      portrait: ch > cw * 1.05,
      square: Math.abs(cw - ch) < cw * 0.05,
      palette,
      fonts,
      rng: seededRandom(v.seed),
      duration: total,
      motion: templateMotion({ cw, ch, palette, fonts, duration: total, seed: v.seed, assets: motionAssets }),
    });
    clips = clips.filter((c) => c.duration > 0 && c.start >= 0);
    const used = new Set(clips.map((c) => ('assetId' in c ? c.assetId : '')));
    const assets: MediaAsset[] = [...(def.assets ?? []), ...motionAssets.filter((a) => used.has(a.id))];
    if (branded?.logo && clips.some(isLogoSlot)) {
      clips = fillLogoSlots(clips, branded.logo, cw, ch);
      assets.push(branded.logo);
    }
    return { clips, duration: total, def, assets };
  } catch (err) {
    console.warn(`[templates] "${v.templateId}" failed to build`, err);
    return null;
  }
}

/** The brand-kit treatment of a design: brand palette and fonts, a seeded layout. */
function brandVariation(def: TemplateDef, n: number): TemplateVariation {
  const h = hashString(def.id);
  const seed = (h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  return { key: `${def.id}:brand${brand?.revision ?? 0}:${seed}`, templateId: def.id, paletteId: BRAND_PALETTE_ID, fontPairId: BRAND_FONTS_ID, seed };
}

/** Palettes and font pairs a design's variations choose from (its own taste when it has one). */
function choices(def: TemplateDef): { palettes: Palette[]; fonts: FontPair[] } {
  let palettes = PALETTES.length ? PALETTES : [FALLBACK_PALETTE];
  let fonts = FONT_PAIRS.length ? FONT_PAIRS : [FALLBACK_FONTS];
  if (def.style?.palettes) {
    const fit = palettes.filter(def.style.palettes);
    if (fit.length >= 3) palettes = fit;
  }
  if (def.style?.fonts) {
    const fit = def.style.fonts.map((id) => getFontPair(id)).filter((f): f is FontPair => !!f);
    if (fit.length) fonts = fit;
  }
  return { palettes, fonts };
}

function variation(def: TemplateDef, n: number): TemplateVariation {
  const h = hashString(def.id);
  const { palettes, fonts } = choices(def);
  // Co-prime strides walk through every palette × font combination before repeating.
  const palette = palettes[(h + n * 7) % palettes.length];
  const fontPair = fonts[((h >>> 5) + n * 3) % fonts.length];
  const seed = (h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  return { key: `${def.id}:${palette.id}:${fontPair.id}:${seed}`, templateId: def.id, paletteId: palette.id, fontPairId: fontPair.id, seed };
}

export interface VariationQuery {
  aspect: AspectId;
  /** `mine` = the user's own saved templates. */
  category?: TemplateCategory | 'all' | 'mine';
  search?: string;
  /** Render with the brand kit (when one is installed with `setTemplateBrand`). */
  brand?: boolean;
}

/** True for the user's own saved templates. */
export const isUserTemplate = (def: TemplateDef): boolean => def.origin?.kind === 'user';

/** A variation of a design: the brand treatment when asked for, else palette × font pairing. */
export function variationFor(def: TemplateDef, n: number, useBrand = false): TemplateVariation {
  if (useBrand && brand) return brandVariation(def, n);
  if (def.fixed) return { key: `${def.id}:fixed`, templateId: def.id, paletteId: PALETTES[0]?.id ?? '_fallback', fontPairId: FONT_PAIRS[0]?.id ?? '_fallback', seed: hashString(def.id) };
  return variation(def, n);
}

/** Display order of template categories (most used first). */
export const TEMPLATE_CATEGORY_ORDER: TemplateCategory[] = ['reel', 'thumbnail', 'intro', 'title', 'social', 'promo', 'youtube', 'slideshow', 'lower-third', 'outro', 'quote', 'business', 'event', 'vlog', 'news', 'gaming', 'countdown'];

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
    if (q.category === 'mine') {
      if (!isUserTemplate(def)) return false;
    } else if (q.category && q.category !== 'all' && def.category !== q.category) return false;
    // Thumbnail designs are still pictures: they have their own chip, not a place among the video templates.
    if ((!q.category || q.category === 'all') && def.category === 'thumbnail' && !term) return false;
    if (term && !(def.name.toLowerCase().includes(term) || def.category.includes(term) || def.tags.some((t) => t.toLowerCase().includes(term)))) return false;
    return true;
  });
  // The user's own templates come first (newest first), then the library, interleaved.
  const mine = list.filter(isUserTemplate).reverse();
  return [...mine, ...interleave(list.filter((d) => !isUserTemplate(d)))];
}

/** Generated designs per page of the endless gallery. */
const GENERATED_PER_PAGE = 24;

/** Categories of generated designs a query asks for (none for "mine", thumbnails, reels…). */
function generatedFor(q: VariationQuery): TemplateCategory[] {
  if (q.category === 'mine') return [];
  const all = generatedCategories();
  if (!q.category || q.category === 'all') return all;
  return all.includes(q.category) ? [q.category] : [];
}

/** False once the endless feed has nothing new to show for this query. */
export const hasMorePages = (q: VariationQuery, pages: number): boolean => pages < 1 || generatedFor(q).length > 0;

/**
 * One page of the endless gallery. Page 0 shows every library design once; later pages are new,
 * generated layouts (different compositions, content and motion — never the same design in
 * another colour), so the feed keeps going without repeating itself.
 */
export function variationPage(q: VariationQuery, page: number): TemplateVariation[] {
  if (page === 0) {
    const defs = matching(q);
    return defs.map((def) => variationFor(def, 0, !!q.brand));
  }
  const cats = generatedFor(q);
  if (!cats.length) return [];
  const defs = generatedPage({ categories: cats, page: page - 1, count: GENERATED_PER_PAGE, search: q.search }).filter((def) => supportsAspect(def, q.aspect));
  return defs.map((def) => variationFor(def, page, !!q.brand));
}

export const templateCount = (q: VariationQuery): number => matching(q).length;


/** A different colour / type treatment of the same design. */
export function shuffleVariation(v: TemplateVariation): TemplateVariation {
  const def = getTemplate(v.templateId);
  if (!def) return v;
  const n = (v.seed % 9973) + 1 + Math.floor(Math.random() * 5000);
  // Brand mode keeps the brand and tries another layout; fixed designs have a single look.
  if (isBrandVariation(v) && brand) return brandVariation(def, n);
  if (def.fixed) return v;
  return variation(def, n);
}
