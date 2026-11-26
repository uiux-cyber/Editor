/**
 * Building blocks of generated designs (see ./index.ts): a layout context, measured type in the
 * design's fonts (or a deliberate accent face), pictures and people placeholders, and the
 * graphic devices seen in contemporary motion design — barcodes, tape, ribbons, torn paper,
 * rules, grids, frames, stickers. Everything is deterministic: randomness comes from `x.rng`.
 */

import { kf, linear, makeAdjustment, makeEffect, makeGenerator, makeShape, makeSlot, makeSticker, radial } from '@/core/factory';
import type { Clip, ClipAnimations, Paint, PathPoint, Shadow, ShapeClip, ShapeKind, Stroke, TextBackground, TextClip, TextStyle } from '@/core/types';
import type { TextMetrics } from '@/engine/sources/textLayout';
import { nearestWeight } from '../../fonts';
import type { Palette, TemplateEnv } from '../../types';
import { slotFill } from '../_lib/a-kit';
import { alpha, contrast, luminance, mix, readableOn, safeArea, type, type Role, type Safe } from '../_lib/kit';

export type Txt = TextClip & { metrics: TextMetrics };

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export interface Ctx {
  env: TemplateEnv;
  c: Palette;
  rng: () => number;
  /** Total duration. */
  d: number;
  cw: number;
  ch: number;
  /** Half width / height. */
  hw: number;
  hh: number;
  s: Safe;
  /** 16:9 */
  wide: boolean;
  /** 9:16 */
  tall: boolean;
  /** Any portrait frame (4:5, 9:16). */
  portrait: boolean;
  square: boolean;
  out: Clip[];
}

export function context(env: TemplateEnv): Ctx {
  return {
    env,
    c: env.palette,
    rng: env.rng,
    d: env.duration,
    cw: env.cw,
    ch: env.ch,
    hw: env.cw / 2,
    hh: env.ch / 2,
    s: safeArea(env),
    wide: env.cw > env.ch * 1.2,
    tall: env.ch > env.cw * 1.5,
    portrait: env.portrait,
    square: env.square,
    out: [],
  };
}

/** Append layers (bottom → top). */
export function add(x: Ctx, ...clips: Clip[]): void {
  x.out.push(...clips);
}

// ---------------------------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------------------------

export const pick = <T>(x: Ctx, list: readonly T[]): T => list[Math.floor(x.rng() * list.length) % list.length];
export const chance = (x: Ctx, p: number): boolean => x.rng() < p;
export const between = (x: Ctx, a: number, b: number): number => a + (b - a) * x.rng();
/** -1 or 1. */
export const sign = (x: Ctx): number => (x.rng() < 0.5 ? -1 : 1);
export function shuffled<T>(x: Ctx, list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(x.rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
// Time & motion
// ---------------------------------------------------------------------------------------------

/** Entrance (and the shared exit) of a layer. */
export function anim(inId?: string, inDur = 0.6, outId: string | null = 'fade-out', outDur = 0.4, loopId?: string, loopDur = 4): ClipAnimations {
  const a: ClipAnimations = {};
  if (inId) a.in = { id: inId, duration: inDur };
  if (outId) a.out = { id: outId, duration: outDur };
  if (loopId) a.loop = { id: loopId, duration: loopDur };
  return a;
}

/** Start and duration of a layer that enters at `at` and stays until `until` (default: the end). */
export const span = (x: Ctx, at: number, until?: number): { start: number; duration: number } => {
  const start = Math.max(0, Math.min(at, x.d - 0.4));
  const end = Math.min(x.d, until ?? x.d);
  return { start, duration: Math.max(0.3, end - start) };
};

/** A slow push in (scale over the whole layer): photographs feel filmed, not placed. */
export function push(duration: number, from = 1, to = 1.08): Partial<Record<'scaleX' | 'scaleY', ReturnType<typeof kf>[]>> {
  return { scaleX: [kf(0, from, 'linear'), kf(duration, to, 'linear')], scaleY: [kf(0, from, 'linear'), kf(duration, to, 'linear')] };
}

/** Gentle drift on x (parallax for decoration). */
export function drift(duration: number, x0: number, dx: number): Partial<Record<'x', ReturnType<typeof kf>[]>> {
  return { x: [kf(0, x0, 'easeInOut'), kf(duration, x0 + dx, 'easeInOut')] };
}

// Entrance vocabularies: a design picks one "voice" so all its layers move alike.
export interface Voice {
  /** Headline per-character / per-word entrance. */
  title: string;
  /** Block entrance for other text. */
  text: string;
  /** Shapes / panels. */
  shape: string;
  /** Pictures. */
  photo: string;
  /** Small labels. */
  label: string;
}

export const VOICES: Record<string, Voice> = {
  calm: { title: 'word-blur-in', text: 'blur-in', shape: 'fade-in', photo: 'zoom-soft-in', label: 'fade-in' },
  crisp: { title: 'line-rise-in', text: 'slide-up-in', shape: 'wipe-right-in', photo: 'wipe-right-in', label: 'slide-up-in' },
  punchy: { title: 'word-punch-in', text: 'pop-in', shape: 'stomp-in', photo: 'pop-up-in', label: 'pop-in' },
  typed: { title: 'typewriter', text: 'fade-in', shape: 'wipe-right-in', photo: 'fade-in', label: 'fade-in' },
  bouncy: { title: 'char-spring-in', text: 'bounce-in', shape: 'elastic-in', photo: 'pop-soft-in', label: 'pop-soft-in' },
  cinematic: { title: 'tracking-expand-in', text: 'blur-in', shape: 'fade-in', photo: 'zoom-blur-in', label: 'fade-in' },
  editorial: { title: 'line-glide-in', text: 'rise-in', shape: 'unfold-in', photo: 'unfold-in', label: 'fade-in' },
  kinetic: { title: 'char-drop-in', text: 'drop-in', shape: 'stretch-h-in', photo: 'box-open-in', label: 'slide-up-in' },
};

export const voice = (x: Ctx, names: (keyof typeof VOICES)[] = Object.keys(VOICES) as (keyof typeof VOICES)[]): Voice => VOICES[pick(x, names)];

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

export { alpha, contrast, luminance, mix, readableOn };

function chroma(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0;
  const v = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return Math.max(...v) - Math.min(...v);
}

/** The palette's most colourful signal colours, most vivid first. */
export function signals(x: Ctx): string[] {
  const c = x.c;
  return [c.primary, c.accent, c.secondary].sort((a, b) => chroma(b) - chroma(a));
}

/** A signal colour that reads on `on` (contrast ≥ min), else ink. */
export function signalOn(x: Ctx, on: string, min = 2.2): string {
  for (const s of signals(x)) if (contrast(s, on) >= min) return s;
  return readableOn(on);
}

/** Text colour on a fill: palette text / bg when they read, else white / near-black. */
export function inkOn(x: Ctx, fill: string, min = 4.5): string {
  for (const k of [x.c.text, x.c.bg, x.c.onPrimary]) if (contrast(k, fill) >= min) return k;
  return readableOn(fill);
}

/** A quiet version of the ink on `fill`. */
export const quietOn = (x: Ctx, fill: string): string => mix(inkOn(x, fill), fill, 0.32);

/** A light "paper" and a dark "ink" derived from the palette (for editorial / poster looks). */
export function paperInk(x: Ctx): { paper: string; ink: string } {
  const c = x.c;
  const light = [c.bg, c.bg2, c.surface, c.text].filter((k) => luminance(k) > 0.72).sort((a, b) => luminance(b) - luminance(a));
  const dark = [c.text, c.bg, c.bg2, c.surface].filter((k) => luminance(k) < 0.08).sort((a, b) => luminance(a) - luminance(b));
  const paper = light[0] ? mix(light[0], '#f3efe6', 0.25) : '#f1ede4';
  const ink = dark[0] ?? '#141414';
  return { paper, ink };
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

export interface TOpts {
  size: number;
  color?: string;
  fill?: Paint;
  maxWidth?: number;
  maxLines?: number;
  minSize?: number;
  align?: 'left' | 'center' | 'right';
  /** A deliberate accent face (mono labels, handwriting…) instead of the design's font. */
  family?: string;
  weight?: number;
  italic?: boolean;
  upper?: boolean;
  /** Letter spacing (em). */
  track?: number;
  lh?: number;
  stroke?: Stroke;
  shadow?: Shadow;
  glow?: { color: string; blur: number };
  bg?: TextBackground;
  name?: string;
  at: number;
  until?: number;
  anim?: ClipAnimations;
  textAnim?: ClipAnimations;
  x?: number;
  y?: number;
  rotation?: number;
  opacity?: number;
  blend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'difference';
}

/** Measured text in the design's heading / body face (or an accent face). */
export function text(x: Ctx, role: Role, content: string, o: TOpts): Txt {
  const style: Partial<TextStyle> = { align: o.align ?? 'center' };
  if (o.family) {
    style.fontFamily = o.family;
    style.fontWeight = nearestWeight(o.family, o.weight ?? 700);
    style.uppercase = false;
    style.letterSpacing = 0;
  } else if (o.weight) style.fontWeight = nearestWeight(x.env.fonts[role].family, o.weight);
  if (o.italic) style.italic = true;
  if (o.upper !== undefined) style.uppercase = o.upper;
  if (o.track !== undefined) style.letterSpacing = o.track;
  if (o.lh) style.lineHeight = o.lh;
  if (o.stroke) style.stroke = o.stroke;
  if (o.shadow) style.shadow = o.shadow;
  if (o.glow) style.glow = o.glow;
  if (o.bg) style.background = o.bg;
  if (o.fill) style.fill = o.fill;
  const t = type(x.env, role, content, {
    name: o.name ?? content.split('\n')[0].slice(0, 32),
    ...span(x, o.at, o.until),
    size: o.size,
    ...(o.color ? { color: o.color } : {}),
    ...(o.maxWidth ? { maxWidth: o.maxWidth } : {}),
    ...(o.maxLines ? { maxLines: o.maxLines } : {}),
    ...(o.minSize ? { minSize: o.minSize } : {}),
    style,
    x: Math.round(o.x ?? 0),
    y: Math.round(o.y ?? 0),
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
    ...(o.blend ? { blendMode: o.blend } : {}),
    ...(o.anim ? { anim: o.anim } : {}),
    ...(o.textAnim ? { textAnim: o.textAnim } : {}),
  }) as Txt;
  return t;
}

export const H = (x: Ctx, content: string, o: TOpts): Txt => text(x, 'heading', content, o);
export const B = (x: Ctx, content: string, o: TOpts): Txt => text(x, 'body', content, o);

/** Small tracked capitals in the body face. */
export const label = (x: Ctx, content: string, o: TOpts): Txt => text(x, 'body', content, { upper: true, track: 0.18, weight: 700, ...o });

/** Monospaced technical label. */
export const mono = (x: Ctx, content: string, o: TOpts): Txt => text(x, 'body', content, { family: 'JetBrains Mono', weight: 500, upper: true, track: 0.04, ...o });

/** Handwritten note. */
export const hand = (x: Ctx, content: string, o: TOpts): Txt => text(x, 'body', content, { family: pick(x, ['Caveat', 'Permanent Marker']), weight: 700, ...o });

/**
 * A display word scaled (not re-wrapped) to a width — giant poster type. The font size stays
 * moderate; the layer is scaled, so it can bleed off the frame.
 */
export function giant(x: Ctx, role: Role, content: string, width: number, o: Omit<TOpts, 'size'> & { maxH?: number }): Txt {
  const t = text(x, role, content, { ...o, size: 360 });
  let k = width / Math.max(1, t.metrics.inkWidth);
  if (o.maxH) k = Math.min(k, o.maxH / Math.max(1, t.metrics.height));
  t.transform.scaleX = k;
  t.transform.scaleY = k;
  return t;
}

/** Shrink a block (never grow) so it is at most `maxW` wide. */
export function fitWidth<T extends Txt>(t: T, maxW: number): T {
  const k = Math.min(1, maxW / Math.max(1, t.metrics.inkWidth));
  t.transform.scaleX *= k;
  t.transform.scaleY *= k;
  return t;
}

/** Width / height on screen. */
export const tw = (t: Txt): number => t.metrics.width * Math.abs(t.transform.scaleX);
export const th = (t: Txt): number => t.metrics.height * Math.abs(t.transform.scaleY);

/** Move a text block so its edge sits at the given coordinate. */
export function atLeft<T extends Txt>(t: T, left: number): T {
  t.transform.x = Math.round(left + tw(t) / 2);
  return t;
}
export function atRight<T extends Txt>(t: T, right: number): T {
  t.transform.x = Math.round(right - tw(t) / 2);
  return t;
}
export function atTop<T extends Txt>(t: T, top: number): T {
  t.transform.y = Math.round(top + th(t) / 2);
  return t;
}
export function atBottom<T extends Txt>(t: T, bottom: number): T {
  t.transform.y = Math.round(bottom - th(t) / 2);
  return t;
}

/** Vertical stack of blocks centred on `cy` (or from `top`). Returns the total height. */
export function column(items: { clip: { transform: { y: number } }; h: number; gap?: number }[], o: { cy?: number; top?: number; bottom?: number; gap?: number } = {}): number {
  const gap = o.gap ?? 24;
  const total = items.reduce((s, it, i) => s + it.h + (i < items.length - 1 ? (it.gap ?? gap) : 0), 0);
  let y = o.top !== undefined ? o.top : o.bottom !== undefined ? o.bottom - total : (o.cy ?? 0) - total / 2;
  items.forEach((it, i) => {
    it.clip.transform.y = Math.round(y + it.h / 2);
    y += it.h + (i < items.length - 1 ? (it.gap ?? gap) : 0);
  });
  return total;
}

/** Stack text blocks (their own heights). */
export const stackText = (ts: (Txt | null | undefined)[], o: { cy?: number; top?: number; bottom?: number; gap?: number; gaps?: number[] } = {}): number =>
  column(
    ts.filter((t): t is Txt => !!t).map((t, i) => ({ clip: t, h: th(t), gap: o.gaps?.[i] })),
    o,
  );

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

export interface SOpts {
  w: number;
  h: number;
  x?: number;
  y?: number;
  fill?: string | Paint;
  stroke?: Stroke;
  radius?: number;
  shadow?: Shadow;
  rotation?: number;
  opacity?: number;
  name?: string;
  at?: number;
  until?: number;
  anim?: ClipAnimations;
  blend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'difference';
  keyframes?: ShapeClip['keyframes'];
}

export function shape(x: Ctx, kind: ShapeKind, o: SOpts): ShapeClip {
  return makeShape(kind, {
    name: o.name ?? kind,
    ...span(x, o.at ?? 0, o.until),
    width: Math.max(1, Math.round(o.w)),
    height: Math.max(1, Math.round(o.h)),
    x: Math.round(o.x ?? 0),
    y: Math.round(o.y ?? 0),
    fill: o.fill ?? '#ffffff',
    ...(o.stroke ? { stroke: o.stroke } : {}),
    ...(o.radius ? { radius: Math.round(o.radius) } : {}),
    ...(o.shadow ? { shadow: o.shadow } : {}),
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
    ...(o.blend ? { blendMode: o.blend } : {}),
    ...(o.anim ? { anim: o.anim } : {}),
    ...(o.keyframes ? { keyframes: o.keyframes } : {}),
  });
}

export const rect = (x: Ctx, o: SOpts): ShapeClip => shape(x, 'rect', o);
export const ellipse = (x: Ctx, o: SOpts): ShapeClip => shape(x, 'ellipse', o);
/** Outline-only ellipse. */
export const ring = (x: Ctx, o: SOpts & { width: number; color: string; dash?: boolean }): ShapeClip => shape(x, 'ellipse', { ...o, fill: '#00000000', stroke: { color: o.color, width: o.width } });
/** A thin rule. */
export const rule = (x: Ctx, o: Omit<SOpts, 'h'> & { h?: number; color: string }): ShapeClip => shape(x, 'rect', { ...o, h: o.h ?? 3, fill: o.color, name: o.name ?? 'Rule' });

/** A free-form shape from points in a w × h box (0..1 coordinates). */
export function path(x: Ctx, points: PathPoint[], o: SOpts & { closed?: boolean }): ShapeClip {
  const clip = shape(x, 'path', o);
  clip.shape.path = { points, closed: o.closed ?? true };
  return clip;
}

/** A barcode: one shape (bars joined along the baseline). */
export function barcode(x: Ctx, o: SOpts & { color: string; bars?: number }): ShapeClip {
  const n = o.bars ?? 22;
  const widths: number[] = [];
  for (let i = 0; i < n * 2; i++) widths.push(i % 2 === 0 ? pick(x, [1, 1, 2, 3]) : pick(x, [1, 1, 2]));
  const total = widths.reduce((a, b) => a + b, 0);
  const pts: PathPoint[] = [];
  let u = 0;
  for (let i = 0; i < widths.length; i += 2) {
    const a = u / total;
    const b = (u + widths[i]) / total;
    pts.push({ x: a, y: 1 }, { x: a, y: 0 }, { x: b, y: 0 }, { x: b, y: 1 });
    u += widths[i] + (widths[i + 1] ?? 0);
  }
  return path(x, pts, { ...o, fill: o.color, name: o.name ?? 'Barcode' });
}

/** A strip of tape (slightly translucent, ragged ends), optionally printed with words. */
export function tape(x: Ctx, o: { w: number; h: number; x: number; y: number; rotation: number; color: string; at: number; anim?: ClipAnimations; words?: string; ink?: string }): Clip[] {
  const jag = (n: number, side: 0 | 1): PathPoint[] => Array.from({ length: n }, (_, i) => ({ x: side === 0 ? (i % 2) * 0.012 : 1 - (i % 2) * 0.012, y: side === 0 ? i / (n - 1) : 1 - i / (n - 1) }));
  const strip = path(x, [{ x: 0.012, y: 0 }, { x: 0.988, y: 0 }, ...jag(7, 1), { x: 0.012, y: 1 }, ...jag(7, 0)], {
    w: o.w,
    h: o.h,
    x: o.x,
    y: o.y,
    rotation: o.rotation,
    fill: o.color,
    name: 'Tape',
    at: o.at,
    shadow: { color: '#00000040', blur: 10, x: 0, y: 4 },
    anim: o.anim ?? anim('wipe-right-in', 0.5),
  });
  const out: Clip[] = [strip];
  if (o.words) {
    const repeated = Array.from({ length: 6 }, () => o.words).join('  —  ');
    const t = label(x, repeated, {
      size: Math.round(o.h * 0.42),
      color: o.ink ?? readableOn(o.color),
      at: o.at + 0.15,
      x: o.x,
      y: o.y,
      rotation: o.rotation,
      track: 0.08,
      anim: o.anim ?? anim('wipe-right-in', 0.5),
      name: 'Tape words',
    });
    // Crop to the strip: scale the run so it is no longer than the tape.
    const k = Math.min(1, (o.w * 0.98) / Math.max(1, tw(t)));
    t.transform.scaleX = k;
    t.transform.scaleY = k;
    out.push(t);
  }
  return out;
}

/** A torn-paper patch (ragged polygon). */
export function torn(x: Ctx, o: SOpts & { color: string; rough?: number }): ShapeClip {
  const r = o.rough ?? 0.035;
  const pts: PathPoint[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) pts.push({ x: i / n, y: Math.abs(Math.sin(i * 12.9 + o.w)) * r });
  for (let i = 1; i <= n; i++) pts.push({ x: 1 - Math.abs(Math.sin(i * 7.3 + o.h)) * r, y: i / n });
  for (let i = 1; i <= n; i++) pts.push({ x: 1 - i / n, y: 1 - Math.abs(Math.sin(i * 5.1 + o.w * 0.3)) * r });
  for (let i = 1; i < n; i++) pts.push({ x: Math.abs(Math.sin(i * 3.7 + o.h * 0.7)) * r, y: 1 - i / n });
  return path(x, pts, { ...o, fill: o.color, name: o.name ?? 'Paper', shadow: o.shadow ?? { color: '#00000033', blur: 18, x: 0, y: 8 } });
}

/** A wide ribbon swoosh crossing the frame (behind a product or a person). */
export function ribbon(x: Ctx, o: { color: string | Paint; thickness: number; at: number; tilt?: number; y?: number; anim?: ClipAnimations; name?: string }): ShapeClip {
  const t = o.thickness / x.ch;
  const tilt = o.tilt ?? 0.18;
  const pts: PathPoint[] = [
    { x: -0.05, y: 0.5 + tilt, outX: 0.35, outY: -tilt * 1.6 },
    { x: 1.05, y: 0.5 - tilt, inX: -0.35, inY: tilt * 0.4 },
    { x: 1.05, y: 0.5 - tilt + t, outX: -0.35, outY: tilt * 0.4 },
    { x: -0.05, y: 0.5 + tilt + t, inX: 0.35, inY: -tilt * 1.6 },
  ];
  return path(x, pts, { w: x.cw, h: x.ch, x: 0, y: o.y ?? 0, fill: o.color, name: o.name ?? 'Ribbon', at: o.at, anim: o.anim ?? anim('wipe-right-in', 0.8) });
}

/** Crop marks / corner ticks around a box (one path per corner). */
export function corners(x: Ctx, o: { w: number; h: number; x?: number; y?: number; len: number; width: number; color: string; at: number; anim?: ClipAnimations }): ShapeClip[] {
  const cx = o.x ?? 0;
  const cy = o.y ?? 0;
  const out: ShapeClip[] = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const px = cx + (sx * o.w) / 2;
    const py = cy + (sy * o.h) / 2;
    out.push(rect(x, { w: o.len, h: o.width, x: px - (sx * o.len) / 2, y: py, fill: o.color, at: o.at, anim: o.anim, name: 'Corner' }));
    out.push(rect(x, { w: o.width, h: o.len, x: px, y: py - (sy * o.len) / 2, fill: o.color, at: o.at, anim: o.anim, name: 'Corner' }));
  }
  return out;
}

/** A plus / crosshair mark. */
export function plus(x: Ctx, o: { size: number; width: number; x: number; y: number; color: string; at: number; anim?: ClipAnimations }): ShapeClip[] {
  return [
    rect(x, { w: o.size, h: o.width, x: o.x, y: o.y, fill: o.color, at: o.at, anim: o.anim, name: 'Mark' }),
    rect(x, { w: o.width, h: o.size, x: o.x, y: o.y, fill: o.color, at: o.at, anim: o.anim, name: 'Mark' }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------------------------

export interface POpts {
  w: number;
  h: number;
  x?: number;
  y?: number;
  name?: string;
  kind?: 'rect' | 'ellipse';
  radius?: number;
  rotation?: number;
  at?: number;
  until?: number;
  anim?: ClipAnimations;
  /** Black and white. */
  bw?: boolean;
  border?: Stroke;
  shadow?: boolean;
  /** Slow push in over its life. */
  push?: boolean;
  opacity?: number;
}

/** A photo / video placeholder (users drop media on it). */
export function photo(x: Ctx, o: POpts): ShapeClip {
  const sp = span(x, o.at ?? 0, o.until);
  const effects = [];
  if (o.bw) effects.push(makeEffect('black-and-white', {}));
  if (o.shadow) effects.push(makeEffect('drop-shadow', { amount: 0.5, dist: 18, angle: 70, softness: 30, color: '#000000' }));
  const clip = makeSlot({
    name: o.name ?? 'Photo',
    ...sp,
    width: Math.round(o.w),
    height: Math.round(o.h),
    x: Math.round(o.x ?? 0),
    y: Math.round(o.y ?? 0),
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
    radius: Math.round(o.radius ?? 0),
    fill: slotFill(x.env),
    ...(o.border ? { stroke: o.border } : {}),
    effects,
    ...(o.anim ? { anim: o.anim } : {}),
    ...(o.push ? { keyframes: push(sp.duration, 1, 1.07) } : {}),
  });
  if (o.kind === 'ellipse') clip.shape.kind = 'ellipse';
  return clip;
}

/** A person placeholder: the photo dropped in is cut out of its background. */
export function person(x: Ctx, o: POpts & { outline?: string }): ShapeClip {
  const p = photo(x, { ...o, name: o.name ?? 'Person' });
  p.cutout = { enabled: true, feather: 0.2, choke: 0 };
  if (o.outline) p.effects.unshift(makeEffect('stroke', { width: 8, color: o.outline, amount: 1 }));
  if (!o.shadow) p.effects.push(makeEffect('drop-shadow', { amount: 0.45, dist: 20, angle: 70, softness: 34, color: '#000000' }));
  return p;
}

/** A full-frame photo background with a slow push in. */
export function backdropPhoto(x: Ctx, o: { name?: string; bw?: boolean; at?: number; dim?: number } = {}): Clip[] {
  const p = photo(x, { name: o.name ?? 'Background photo', w: x.cw, h: x.ch, push: true, bw: o.bw, at: o.at ?? 0, anim: anim('fade-in', 0.6, null) });
  const out: Clip[] = [p];
  if (o.dim) out.push(rect(x, { w: x.cw, h: x.ch, fill: alpha('#000000', o.dim), name: 'Dim' }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Backgrounds & finishing
// ---------------------------------------------------------------------------------------------

export function solid(x: Ctx, color: string, name = 'Background'): ShapeClip {
  return rect(x, { w: x.cw, h: x.ch, fill: color, name });
}

export function generator(
  x: Ctx,
  id: string,
  params: Record<string, string | number | boolean>,
  o: { name?: string; at?: number; opacity?: number; blend?: 'normal' | 'multiply' | 'screen' | 'overlay' } = {},
): Clip {
  return makeGenerator(id, { name: o.name ?? 'Background', ...span(x, o.at ?? 0), params, opacity: o.opacity ?? 1, ...(o.blend ? { blendMode: o.blend } : {}) });
}

/** Film grain + vignette over everything below. */
export function filmLook(x: Ctx, o: { grain?: number; vignette?: number } = {}): Clip {
  const effects = [];
  if (o.grain !== 0) effects.push(makeEffect('film-grain', { amount: o.grain ?? 0.18, size: 1.4, chroma: 0.08 }));
  if (o.vignette !== 0) effects.push(makeEffect('vignette', { amount: o.vignette ?? 0.4, size: 0.55, feather: 0.6, roundness: 0.3, color: '#000000' }));
  return makeAdjustment({ name: 'Film look', duration: x.d, effects });
}

/** Gradient scrim for text over pictures. */
export function scrim(x: Ctx, side: 'bottom' | 'top' | 'left' | 'right' | 'full', strength = 0.7, extent = 0.6): ShapeClip {
  const col = '#05060a';
  const clear = alpha(col, 0);
  const dense = alpha(col, strength);
  const mid = alpha(col, strength * 0.55);
  if (side === 'full') return rect(x, { w: x.cw, h: x.ch, fill: dense, name: 'Scrim' });
  const vertical = side === 'top' || side === 'bottom';
  const w = vertical ? x.cw : Math.round(x.cw * extent);
  const h = vertical ? Math.round(x.ch * extent) : x.ch;
  const fill: Paint =
    side === 'bottom' ? linear(90, clear, mid, dense) : side === 'top' ? linear(90, dense, mid, clear) : side === 'left' ? linear(0, dense, mid, clear) : linear(0, clear, mid, dense);
  return rect(x, { w, h, x: side === 'left' ? -x.hw + w / 2 : side === 'right' ? x.hw - w / 2 : 0, y: side === 'top' ? -x.hh + h / 2 : side === 'bottom' ? x.hh - h / 2 : 0, fill, name: 'Scrim' });
}

/** A soft radial glow (light source) behind something. */
export function glow(x: Ctx, o: { size: number; x?: number; y?: number; color: string; strength?: number; at?: number }): ShapeClip {
  return ellipse(x, { w: o.size, h: o.size, x: o.x ?? 0, y: o.y ?? 0, fill: radial(alpha(o.color, o.strength ?? 0.55), alpha(o.color, 0)), name: 'Glow', at: o.at ?? 0, anim: anim('fade-in', 1.2) });
}

export function sticker(x: Ctx, id: string, o: { size: number; x: number; y: number; rotation?: number; colors?: string[]; at: number; anim?: ClipAnimations; name?: string }): Clip {
  return makeSticker(id, {
    name: o.name ?? 'Sticker',
    ...span(x, o.at),
    size: Math.round(o.size),
    x: Math.round(o.x),
    y: Math.round(o.y),
    rotation: o.rotation ?? 0,
    ...(o.colors ? { colors: o.colors } : {}),
    anim: o.anim ?? anim('pop-in', 0.5),
  });
}

/** A brand-logo placeholder (filled from the brand kit). */
export function logo(x: Ctx, o: { size: number; x: number; y: number; at: number; round?: boolean; fill?: string }): ShapeClip {
  const s = makeSlot({
    name: 'Logo',
    ...span(x, o.at),
    width: Math.round(o.size),
    height: Math.round(o.size),
    x: Math.round(o.x),
    y: Math.round(o.y),
    radius: Math.round(o.round ? o.size / 2 : o.size * 0.2),
    ...(o.fill ? { fill: o.fill } : {}),
    anim: anim('fade-in', 0.6),
  });
  return s;
}

/** A pill (rounded box + label). Returns both clips; position with `place`. */
export function pill(
  x: Ctx,
  content: string,
  o: {
    size: number;
    fill: string;
    color?: string;
    at: number;
    upper?: boolean;
    family?: string;
    weight?: number;
    padX?: number;
    padY?: number;
    radius?: number;
    stroke?: Stroke;
    anim?: ClipAnimations;
    name?: string;
    rotation?: number;
  },
): { box: ShapeClip; label: Txt; w: number; h: number } {
  const t = text(x, 'body', content, {
    size: o.size,
    color: o.color ?? inkOn(x, o.fill, 3.5),
    at: o.at + 0.08,
    upper: o.upper ?? true,
    track: (o.upper ?? true) ? 0.1 : 0,
    weight: o.weight ?? 700,
    family: o.family,
    anim: o.anim ?? anim('fade-in', 0.4),
    name: o.name ?? content,
    lh: 1.15,
  });
  const padX = o.padX ?? o.size * 0.9;
  const padY = o.padY ?? o.size * 0.45;
  const w = Math.round(t.metrics.inkWidth + padX * 2);
  const h = Math.round(t.metrics.height + padY * 2);
  const box = rect(x, { w, h, fill: o.fill, radius: o.radius ?? h / 2, stroke: o.stroke, at: o.at, anim: o.anim ?? anim('pop-in', 0.45), name: `${o.name ?? content} box`, rotation: o.rotation });
  t.transform.rotation = o.rotation ?? 0;
  return { box, label: t, w, h };
}

/** Put clips at a position (their centre). */
export function place(clips: { transform: { x: number; y: number } }[], px: number, py: number): void {
  for (const c of clips) {
    c.transform.x = Math.round(px);
    c.transform.y = Math.round(py);
  }
}
