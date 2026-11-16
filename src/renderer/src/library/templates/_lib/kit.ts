/**
 * Shared toolkit for template designs: typography from the environment's font pair, exact text
 * measurement, vertical stacking, safe areas and colour helpers.
 *
 * Every helper is pure and deterministic; randomness always comes from `env.rng`.
 */

import { makeText, type TextOpts } from '@/core/factory';
import type { Paint, TextClip, TextStyle } from '@/core/types';
import { measureTextBlock, type TextMetrics } from '@/engine/sources/textLayout';
import type { FontRole, TemplateEnv } from '../../types';

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

function parse(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (v: number): string =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb` with an alpha byte appended (0..1). */
export function alpha(color: string, a: number): string {
  const [r, g, b] = parse(color);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a * 255)}`;
}

/** Linear mix of two colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ca = parse(a);
  const cb = parse(b);
  return `#${hex2(ca[0] + (cb[0] - ca[0]) * t)}${hex2(ca[1] + (cb[1] - ca[1]) * t)}${hex2(ca[2] + (cb[2] - ca[2]) * t)}`;
}

/** Relative luminance 0..1. */
export function luminance(color: string): number {
  const [r, g, b] = parse(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Near-white or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string, light = '#ffffff', dark = '#111318'): string {
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}

// ---------------------------------------------------------------------------------------------
// Randomness (always seeded through env.rng)
// ---------------------------------------------------------------------------------------------

export const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];
export const range = (rng: () => number, min: number, max: number): number => min + (max - min) * rng();
export const chance = (rng: () => number, p: number): boolean => rng() < p;

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

export interface Safe {
  /** Half extents of the title-safe area, in design px from the centre. */
  hw: number;
  hh: number;
  /** Margin from the frame edge. */
  mx: number;
  my: number;
  /** Usable width / height. */
  w: number;
  h: number;
}

/** Title-safe area: 6% margins on landscape, larger top/bottom margins on vertical video (UI overlays). */
export function safeArea(env: TemplateEnv, factor = 1): Safe {
  const mx = Math.round(env.cw * (env.portrait ? 0.08 : 0.065) * factor);
  const my = Math.round(env.ch * (env.portrait ? 0.11 : 0.08) * factor);
  return { mx, my, hw: env.cw / 2 - mx, hh: env.ch / 2 - my, w: env.cw - mx * 2, h: env.ch - my * 2 };
}

/** The frame's shorter side is always 1080; this is 1 on 16:9 and grows for taller frames. */
export const tallness = (env: TemplateEnv): number => env.ch / env.cw;

// ---------------------------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------------------------

export type Role = 'heading' | 'body';

/** Text style fields for a font role of the environment's pair. */
export function roleStyle(env: TemplateEnv, role: Role): Partial<TextStyle> {
  const r: FontRole = env.fonts[role];
  return { fontFamily: r.family, fontWeight: r.weight, uppercase: r.uppercase ?? false, letterSpacing: r.letterSpacing ?? 0 };
}

export interface TypeOpts extends Omit<TextOpts, 'style'> {
  size: number;
  /** Solid colour or paint. Default: palette text colour. */
  color?: string | Paint;
  /** Wrap width in design px. */
  maxWidth?: number;
  /** Shrink the font until the text fits on at most this many lines inside maxWidth. */
  maxLines?: number;
  /** Smallest size allowed when shrinking. Default: 45% of `size`. */
  minSize?: number;
  style?: Partial<TextStyle>;
}

function styleFor(env: TemplateEnv, role: Role, content: string, o: TypeOpts, size: number): TextStyle {
  const fill: Paint = o.color === undefined ? { type: 'solid', color: env.palette.text } : typeof o.color === 'string' ? { type: 'solid', color: o.color } : o.color;
  return {
    content,
    fontFamily: 'Inter',
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    align: 'center',
    lineHeight: role === 'heading' ? 1.04 : 1.3,
    letterSpacing: 0,
    ...roleStyle(env, role),
    fill,
    ...o.style,
    fontSize: size,
    ...(o.maxWidth ? { boxWidth: Math.round(o.maxWidth) } : {}),
  } as TextStyle;
}

/**
 * Create a text clip in the environment's heading or body font. With `maxWidth` the text wraps;
 * with `maxLines` the size shrinks until it fits. The returned clip carries exact metrics.
 */
export function type(env: TemplateEnv, role: Role, content: string, o: TypeOpts): TextClip & { metrics: TextMetrics } {
  let size = o.size;
  const minSize = o.minSize ?? Math.round(o.size * 0.45);
  let style = styleFor(env, role, content, o, size);
  let m = measureTextBlock(style);
  if (o.maxWidth) {
    const maxLines = o.maxLines ?? 99;
    // Shrink in 4% steps until the text fits the line budget and no single word overflows.
    while (size > minSize && (m.lines > maxLines || m.inkWidth > o.maxWidth + 0.5)) {
      size = Math.max(minSize, Math.floor(size * 0.96));
      style = styleFor(env, role, content, o, size);
      m = measureTextBlock(style);
    }
  }
  const { size: _s, color: _c, maxWidth: _w, maxLines: _l, minSize: _m, style: _st, ...rest } = o;
  const clip = makeText(content, { ...rest, style }) as TextClip & { metrics: TextMetrics };
  Object.defineProperty(clip, 'metrics', { value: m, enumerable: false });
  return clip;
}

/** Shorthand for headings. */
export const heading = (env: TemplateEnv, content: string, o: TypeOpts): TextClip & { metrics: TextMetrics } => type(env, 'heading', content, o);
/** Shorthand for body copy. */
export const body = (env: TemplateEnv, content: string, o: TypeOpts): TextClip & { metrics: TextMetrics } => type(env, 'body', content, o);

/** Visual height of a text clip (block height × its scale). */
export const textHeight = (clip: TextClip & { metrics?: TextMetrics }): number => (clip.metrics ? clip.metrics.height : measureTextBlock(clip.text).height) * Math.abs(clip.transform.scaleY);
/** Width covered by glyphs × scale. */
export const textWidth = (clip: TextClip & { metrics?: TextMetrics }): number => (clip.metrics ? clip.metrics.inkWidth : measureTextBlock(clip.text).inkWidth) * Math.abs(clip.transform.scaleX);

export interface StackItem {
  /** Clip to position (its transform.y is overwritten). */
  clip: { transform: { y: number } };
  /** Height in design px. */
  height: number;
  /** Extra space after this item. */
  gap?: number;
}

/**
 * Stack items vertically so the whole group is centred on `centerY` (or starts at `top` when
 * given). Returns the group's total height.
 */
export function stack(items: StackItem[], opts: { centerY?: number; top?: number; gap?: number } = {}): number {
  const gap = opts.gap ?? 24;
  const total = items.reduce((s, it, i) => s + it.height + (i < items.length - 1 ? (it.gap ?? gap) : 0), 0);
  let y = opts.top !== undefined ? opts.top : (opts.centerY ?? 0) - total / 2;
  items.forEach((it, i) => {
    it.clip.transform.y = Math.round(y + it.height / 2);
    y += it.height + (i < items.length - 1 ? (it.gap ?? gap) : 0);
  });
  return total;
}
