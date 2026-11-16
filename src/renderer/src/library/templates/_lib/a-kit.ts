/**
 * Helpers shared by the `a-*` template packs: contrast-safe colour picks, label typography,
 * left/right text anchoring, overlay placement and terse animation references.
 *
 * Everything is pure; randomness always comes from `env.rng` (see `pick` / `chance` in kit.ts).
 */

import { linear, makeShape, radial } from '@/core/factory';
import type { ClipAnimations, Paint, ShapeClip, TextClip, TextStyle } from '@/core/types';
import type { TextMetrics } from '@/engine/sources/textLayout';
import { getBundledFont } from '../../fonts';
import type { TemplateEnv } from '../../types';
import { alpha, body, contrast, heading, mix, readableOn, safeArea, type TypeOpts } from './kit';

export type MText = TextClip & { metrics: TextMetrics };

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

/** First candidate that reaches `min` contrast on `fill`, else near-white / near-black. */
export function firstReadable(fill: string, candidates: string[], min = 4.5): string {
  for (const c of candidates) if (c && contrast(c, fill) >= min) return c;
  return readableOn(fill);
}

/** Body-text colour for a panel of colour `fill` (palette colours preferred). */
export function inkOn(env: TemplateEnv, fill: string, min = 4.5): string {
  const c = env.palette;
  return firstReadable(fill, [c.text, c.onPrimary, c.bg, c.surface], min);
}

/** Secondary text colour on `fill`: the palette's muted tone when legible, else a softened ink. */
export function mutedOn(env: TemplateEnv, fill: string): string {
  const c = env.palette;
  if (contrast(c.textMuted, fill) >= 3.2) return c.textMuted;
  const ink = inkOn(env, fill);
  const soft = mix(ink, fill, 0.28);
  return contrast(soft, fill) >= 3.2 ? soft : ink;
}

/** A palette accent (primary → secondary → accent) that stands out on `fill`, else the ink. */
export function accentOn(env: TemplateEnv, fill: string, min = 3): string {
  const c = env.palette;
  for (const a of [c.primary, c.secondary, c.accent]) if (contrast(a, fill) >= min) return a;
  return inkOn(env, fill);
}

/** Chroma 0..1 (max − min channel) of a hex colour. */
function chroma(hex: string): number {
  const h = hex.replace('#', '').slice(0, 6);
  const n = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16);
  if (Number.isNaN(n)) return 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

/**
 * The palette's signal colours for overlays that sit on footage: primary first, unless it is
 * nearly neutral (e.g. a black primary in an editorial palette), then the most colourful first.
 */
export function vivids(env: TemplateEnv): string[] {
  const c = env.palette;
  const list = [c.primary, c.secondary, c.accent];
  if (chroma(c.primary) >= 0.25) return list;
  return [...list].sort((a, b) => chroma(b) - chroma(a));
}

/** The most useful signal colour of the palette (see `vivids`). */
export const vivid = (env: TemplateEnv): string => vivids(env)[0];

/** A signal colour that still separates from `fill` (contrast ≥ min), else a readable ink. */
export function vividOn(env: TemplateEnv, fill: string, min = 2): string {
  for (const v of vivids(env)) if (contrast(v, fill) >= min) return v;
  return inkOn(env, fill);
}

/** Decorative tone of `color` pushed towards `bg` (for quiet shapes and generator layers). */
export const tone = (color: string, bg: string, t: number): string => mix(color, bg, t);

/**
 * Fill for media placeholders: a dark, palette-tinted gradient so the white "drop media" hint
 * stays legible whatever the palette.
 */
export function slotFill(env: TemplateEnv): Paint {
  const c = env.palette;
  return linear(135, mix(c.primary, '#1c1f26', 0.6), mix(c.secondary, '#1c1f26', 0.78));
}

// ---------------------------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------------------------

export const isScript = (family: string): boolean => getBundledFont(family)?.category === 'script';
export const isMono = (family: string): boolean => getBundledFont(family)?.category === 'mono';

/** Nearest available weight of a bundled family. */
export function weightOf(family: string, want: number): number {
  const f = getBundledFont(family);
  if (!f) return want;
  return f.weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), f.weights[0]);
}

export interface LabelOpts extends TypeOpts {
  /** Letter spacing in em (ignored for script faces). Default 0.18. */
  track?: number;
  /** Preferred weight (snapped to the family's available weights). */
  weight?: number;
  /** Force upper case (default true unless the body face is a script). */
  caps?: boolean;
}

/** Small tracked caps in the body face: kickers, tags, roles. */
export function label(env: TemplateEnv, content: string, o: LabelOpts): MText {
  const { track, weight, caps, ...rest } = o;
  const fam = env.fonts.body.family;
  const script = isScript(fam);
  const style: Partial<TextStyle> = {
    uppercase: script ? false : (caps ?? true),
    letterSpacing: script ? 0 : (track ?? 0.18),
    ...(weight ? { fontWeight: weightOf(fam, weight) } : {}),
    ...o.style,
  };
  return body(env, content, { ...rest, style }) as MText;
}

/** Body text with an optional preferred weight. */
export function copy(env: TemplateEnv, content: string, o: TypeOpts & { weight?: number }): MText {
  const { weight, ...rest } = o;
  const fam = env.fonts.body.family;
  return body(env, content, { ...rest, style: { ...(weight ? { fontWeight: weightOf(fam, weight) } : {}), ...o.style } }) as MText;
}

/**
 * Faces whose glyphs are taller than the kit's tight heading leading (1.04) and would touch
 * or overlap when a heading wraps.
 */
const TALL_FACES: Record<string, number> = { 'Press Start 2P': 1.4, Pacifico: 1.2, Lobster: 1.12, 'Permanent Marker': 1.14, Shrikhand: 1.12 };

/** Heading text (typed as MText), with safe leading for tall display faces. */
export function title(env: TemplateEnv, content: string, o: TypeOpts): MText {
  const min = TALL_FACES[env.fonts.heading.family];
  if (min && !(o.style?.lineHeight && o.style.lineHeight >= min)) return heading(env, content, { ...o, style: { ...o.style, lineHeight: Math.max(min, o.style?.lineHeight ?? 0) } }) as MText;
  return heading(env, content, o) as MText;
}

/** Place a text block so its layout box starts at `left`. */
export function atLeft<T extends MText>(clip: T, left: number): T {
  clip.transform.x = Math.round(left + (clip.metrics.width * Math.abs(clip.transform.scaleX)) / 2);
  return clip;
}

/** Place a text block so its layout box ends at `right`. */
export function atRight<T extends MText>(clip: T, right: number): T {
  clip.transform.x = Math.round(right - (clip.metrics.width * Math.abs(clip.transform.scaleX)) / 2);
  return clip;
}

/** Width covered by glyphs. */
export const inkW = (clip: MText): number => clip.metrics.inkWidth * Math.abs(clip.transform.scaleX);
/** Block height. */
export const blockH = (clip: MText): number => clip.metrics.height * Math.abs(clip.transform.scaleY);

// ---------------------------------------------------------------------------------------------
// Timing & animation
// ---------------------------------------------------------------------------------------------

/** start / duration so a layer appears at `start` and ends `tail` seconds before the end. */
export const life = (env: TemplateEnv, start: number, tail = 0): { start: number; duration: number } => ({
  start,
  duration: Math.max(0.2, env.duration - start - tail),
});

/** Terse animation reference: an('fade-in', 0.6, 'fade-out', 0.4, 'float', 3). */
export function an(inId?: string, inDur = 0.6, outId?: string, outDur = 0.45, loopId?: string, loopDur = 3): ClipAnimations {
  const a: ClipAnimations = {};
  if (inId) a.in = { id: inId, duration: inDur };
  if (outId) a.out = { id: outId, duration: outDur };
  if (loopId) a.loop = { id: loopId, duration: loopDur };
  return a;
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

export interface OverlayBox {
  /** Left edge, bottom edge and right edge (design px from the centre). */
  left: number;
  right: number;
  bottom: number;
  top: number;
  /** Width budget for an overlay block. */
  maxW: number;
  /** Scale factor for type: 1 on 16:9, a little larger on tall frames. */
  k: number;
}

/**
 * Where lower-thirds and straps live: bottom-left of the title-safe area on landscape, raised
 * above the platform UI on vertical video.
 */
export function overlayBox(env: TemplateEnv): OverlayBox {
  const safe = safeArea(env);
  const left = -env.cw / 2 + safe.mx;
  const right = env.cw / 2 - safe.mx;
  const top = -env.ch / 2 + safe.my;
  if (env.portrait) {
    const bottom = env.aspect === '9:16' ? env.ch * 0.25 : env.ch / 2 - safe.my * 1.15;
    return { left, right, top, bottom, maxW: safe.w, k: env.aspect === '9:16' ? 1.3 : 1.18 };
  }
  if (env.square) return { left, right, top, bottom: env.ch / 2 - safe.my, maxW: safe.w * 0.9, k: 1.1 };
  return { left, right, top, bottom: env.ch / 2 - safe.my, maxW: Math.min(safe.w * 0.55, 1000), k: 1.12 };
}

/** A light panel colour in any palette (white-ish card), with the palette's own tint. */
export const lightPanel = (env: TemplateEnv): string => (env.palette.dark ? env.palette.text : env.palette.surface);
/** A dark panel colour in any palette. */
export const darkPanel = (env: TemplateEnv): string => (env.palette.dark ? env.palette.surface : env.palette.text);

/**
 * A soft elliptical shade (radial gradient on a circle, stretched with scale so the falloff
 * stays round whatever the proportions). Size is the final width × height.
 */
export function softShade(o: { name?: string; start: number; duration: number; x: number; y: number; w: number; h: number; color: string; strength: number; plateau?: boolean; anim?: ClipAnimations }): ShapeClip {
  const s = 400;
  return makeShape('ellipse', {
    name: o.name ?? 'Shade',
    start: o.start,
    duration: o.duration,
    width: s,
    height: s,
    scaleX: o.w / s,
    scaleY: o.h / s,
    x: o.x,
    y: o.y,
    fill: o.plateau
      ? radial(alpha(o.color, o.strength), alpha(o.color, o.strength), alpha(o.color, o.strength * 0.6), alpha(o.color, 0))
      : radial(alpha(o.color, o.strength), alpha(o.color, o.strength * 0.55), alpha(o.color, 0)),
    anim: o.anim,
  });
}

/** Soft drop shadow for text that sits directly on footage. */
export const footageShadow = { color: '#00000073', blur: 14, x: 0, y: 3 };
