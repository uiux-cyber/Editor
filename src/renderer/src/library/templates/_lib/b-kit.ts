/**
 * Building blocks shared by the `b-*` template packs: an aspect-aware layout frame, animation
 * shorthands, measured pills / buttons / chips, row & column placement, scrims, palette-aware
 * backgrounds and contrast-safe colour picks.
 *
 * Everything is pure and deterministic; variation always comes from `env.rng`.
 */

import { linear, makeGenerator, makeShape } from '@/core/factory';
import type { ClipAnimations, GeneratorClip, Paint, Shadow, ShapeClip, Stroke, TextClip, TextStyle } from '@/core/types';
import type { TextMetrics } from '@/engine/sources/text';
import { nearestWeight } from '../../fonts';
import type { TemplateEnv } from '../../types';
import { alpha, body, contrast, heading, mix, readableOn, safeArea, type Role, type Safe, type TypeOpts } from './kit';

export type Txt = TextClip & { metrics: TextMetrics };
/** Anything with a transform we can place. */
export type Placeable = { transform: { x: number; y: number } };

// ---------------------------------------------------------------------------------------------
// Animation shorthands
// ---------------------------------------------------------------------------------------------

/** Clip animation refs: entrance, exit and optional loop. */
export function A(inId?: string, inDur = 0.6, outId?: string, outDur = 0.45, loopId?: string, loopDur = 3): ClipAnimations {
  const a: ClipAnimations = {};
  if (inId) a.in = { id: inId, duration: inDur };
  if (outId) a.out = { id: outId, duration: outDur };
  if (loopId) a.loop = { id: loopId, duration: loopDur };
  return a;
}

/** Duration of a layer that starts at `start` and ends `pad` seconds before the end. */
export const till = (d: number, start: number, pad = 0): number => Math.max(0.2, d - pad - start);

// ---------------------------------------------------------------------------------------------
// Layout frame
// ---------------------------------------------------------------------------------------------

export interface Lay {
  cw: number;
  ch: number;
  hw: number;
  hh: number;
  s: Safe;
  /** 16:9 */
  wide: boolean;
  /** 9:16 */
  tall: boolean;
  /** 1:1 */
  square: boolean;
  /** 4:5 */
  mid: boolean;
  /** Any portrait frame (4:5 or 9:16). */
  portrait: boolean;
  /** ch / cw */
  k: number;
}

export function lay(env: TemplateEnv): Lay {
  const s = safeArea(env);
  return {
    cw: env.cw,
    ch: env.ch,
    hw: env.cw / 2,
    hh: env.ch / 2,
    s,
    wide: env.cw > env.ch * 1.2,
    tall: env.ch > env.cw * 1.5,
    square: env.square,
    mid: env.portrait && env.ch <= env.cw * 1.5,
    portrait: env.portrait,
    k: env.ch / env.cw,
  };
}

/** Vertical stack of rows; each row's clips get the row's centre y. Returns the total height. */
export interface Row {
  clips: Placeable[];
  h: number;
  gap?: number;
}
export function vstack(rows: Row[], o: { centerY?: number; top?: number; bottom?: number; gap?: number } = {}): number {
  const gap = o.gap ?? 24;
  const total = rows.reduce((s, r, i) => s + r.h + (i < rows.length - 1 ? (r.gap ?? gap) : 0), 0);
  let y = o.top !== undefined ? o.top : o.bottom !== undefined ? o.bottom - total : (o.centerY ?? 0) - total / 2;
  rows.forEach((r, i) => {
    for (const c of r.clips) c.transform.y = Math.round(y + r.h / 2);
    y += r.h + (i < rows.length - 1 ? (r.gap ?? gap) : 0);
  });
  return total;
}

/** Horizontal row of items; each item's clips get the item's centre x. Returns the total width. */
export interface Col {
  clips: Placeable[];
  w: number;
  gap?: number;
}
export function hrow(cols: Col[], o: { centerX?: number; left?: number; right?: number; gap?: number } = {}): number {
  const gap = o.gap ?? 24;
  const total = cols.reduce((s, c, i) => s + c.w + (i < cols.length - 1 ? (c.gap ?? gap) : 0), 0);
  let x = o.left !== undefined ? o.left : o.right !== undefined ? o.right - total : (o.centerX ?? 0) - total / 2;
  cols.forEach((c, i) => {
    for (const clip of c.clips) clip.transform.x = Math.round(x + c.w / 2);
    x += c.w + (i < cols.length - 1 ? (c.gap ?? gap) : 0);
  });
  return total;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Splits the safe area into a media zone and a copy zone: side by side on landscape and square
 * frames (and 4:5 when `sideMid`), stacked on portrait frames.
 */
export function split(
  L: Lay,
  o: { media?: number; gap?: number; mediaSide?: 'left' | 'right'; mediaFirst?: boolean; sideMid?: boolean } = {},
): { media: Box; text: Box; stacked: boolean } {
  const f = o.media ?? 0.46;
  const gap = o.gap ?? (L.wide ? 80 : 56);
  const side = L.wide || L.square || (L.mid && o.sideMid);
  if (side) {
    const mw = Math.round(L.s.w * f - gap / 2);
    const tw = L.s.w - mw - gap;
    const right = (o.mediaSide ?? 'right') === 'right';
    return {
      media: { x: right ? L.s.hw - mw / 2 : -L.s.hw + mw / 2, y: 0, w: mw, h: L.s.h },
      text: { x: right ? -L.s.hw + tw / 2 : L.s.hw - tw / 2, y: 0, w: tw, h: L.s.h },
      stacked: false,
    };
  }
  const mh = Math.round(L.s.h * f - gap / 2);
  const th = L.s.h - mh - gap;
  const top = o.mediaFirst ?? true;
  return {
    media: { x: 0, y: top ? -L.s.hh + mh / 2 : L.s.hh - mh / 2, w: L.s.w, h: mh },
    text: { x: 0, y: top ? L.s.hh - th / 2 : -L.s.hh + th / 2, w: L.s.w, h: th },
    stacked: true,
  };
}

/** Largest w × h of the given aspect (w / h) inside a box, optionally capped. */
export function fitAspect(box: { w: number; h: number }, aspect: number, cap = 1): { w: number; h: number } {
  let w = box.w * cap;
  let h = w / aspect;
  if (h > box.h * cap) {
    h = box.h * cap;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

export function setXY(clips: Placeable[], x?: number, y?: number): void {
  for (const c of clips) {
    if (x !== undefined) c.transform.x = Math.round(x);
    if (y !== undefined) c.transform.y = Math.round(y);
  }
}

/** An item of a column: its layers, its width and height. */
export interface Item {
  clips: Placeable[];
  w: number;
  h: number;
  gap?: number;
}
export const tItem = (t: Txt, gap?: number): Item => ({ clips: [t], w: t.metrics.width, h: t.metrics.height, gap });
/** A placeholder position used to lay out composite rows; read its transform after layout. */
export const holder = (): Placeable => ({ transform: { x: 0, y: 0 } });
export const pItem = (p: { clips: Placeable[]; w: number; h: number }, gap?: number): Item => ({ clips: p.clips, w: p.w, h: p.h, gap });

/** Stacks items inside a zone with left / centre / right alignment. Returns the total height. */
export function column(items: Item[], zone: Box, align: 'left' | 'center' | 'right' = 'left', o: { gap?: number; valign?: 'center' | 'top' | 'bottom' } = {}): number {
  const v = o.valign ?? 'center';
  const total = vstack(
    items.map((it) => ({ clips: it.clips, h: it.h, gap: it.gap })),
    v === 'top' ? { top: zone.y - zone.h / 2, gap: o.gap } : v === 'bottom' ? { bottom: zone.y + zone.h / 2, gap: o.gap } : { centerY: zone.y, gap: o.gap },
  );
  for (const it of items) {
    const x = align === 'left' ? zone.x - zone.w / 2 + it.w / 2 : align === 'right' ? zone.x + zone.w / 2 - it.w / 2 : zone.x;
    for (const c of it.clips) c.transform.x = Math.round(x);
  }
  return total;
}

/** Places a text block so its left edge sits at `left` (works for any alignment). */
export function alignLeft(t: Txt, left: number): void {
  t.transform.x = Math.round(left + t.metrics.width / 2);
}
export function alignRight(t: Txt, right: number): void {
  t.transform.x = Math.round(right - t.metrics.width / 2);
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Text colour for a solid fill (uses the palette's onPrimary on the primary colour). */
export function textOn(env: TemplateEnv, fill: string): string {
  if (same(fill, env.palette.primary) && contrast(env.palette.onPrimary, fill) >= 3) return env.palette.onPrimary;
  return readableOn(fill);
}

/** The first of primary / accent / secondary that reads on `on` (contrast ≥ min), else plain ink. */
export function vivid(env: TemplateEnv, on: string, min = 2.6, order: ('primary' | 'accent' | 'secondary')[] = ['primary', 'accent', 'secondary']): string {
  for (const k of order) if (contrast(env.palette[k], on) >= min) return env.palette[k];
  return readableOn(on);
}

/** Brand colour that pops on dark imagery (for overlays on media). */
export const popOnDark = (env: TemplateEnv, order?: ('primary' | 'accent' | 'secondary')[]): string => vivid(env, '#16181d', 3, order);

export { alpha, mix, readableOn, contrast };

// ---------------------------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------------------------

/** Nearest available weight of a role's family. */
export const wt = (env: TemplateEnv, role: Role, w: number): number => nearestWeight(env.fonts[role].family, w);

/** Small upper-case tracked label in the body face. */
export function label(env: TemplateEnv, content: string, o: TypeOpts & { track?: number; weight?: number }): Txt {
  const { track, weight, style, ...rest } = o;
  return body(env, content, { ...rest, style: { uppercase: true, letterSpacing: track ?? 0.16, fontWeight: wt(env, 'body', weight ?? 700), ...style } }) as Txt;
}

/** Body copy at a stronger weight. */
export function strong(env: TemplateEnv, content: string, o: TypeOpts & { weight?: number }): Txt {
  const { weight, style, ...rest } = o;
  return body(env, content, { ...rest, style: { fontWeight: wt(env, 'body', weight ?? 700), ...style } }) as Txt;
}

export const H = (env: TemplateEnv, content: string, o: TypeOpts): Txt => heading(env, content, o) as Txt;
export const B = (env: TemplateEnv, content: string, o: TypeOpts): Txt => body(env, content, o) as Txt;

// ---------------------------------------------------------------------------------------------
// Pills, buttons, chips
// ---------------------------------------------------------------------------------------------

export interface PillOpts {
  size: number;
  fill: string | Paint;
  /** Text colour; default: readable on the fill. */
  color?: string;
  role?: Role;
  weight?: number;
  upper?: boolean;
  track?: number;
  padX?: number;
  padY?: number;
  /** Default: fully rounded. */
  radius?: number;
  stroke?: Stroke;
  shadow?: Shadow;
  minWidth?: number;
  maxWidth?: number;
  start: number;
  duration: number;
  anim?: ClipAnimations;
  /** Animation of the label (default: same as the box). */
  labelAnim?: ClipAnimations;
  textAnim?: ClipAnimations;
  /** Label starts this much later than the box. */
  delay?: number;
  name?: string;
  style?: Partial<TextStyle>;
}

export interface Pill {
  box: ShapeClip;
  text: Txt;
  w: number;
  h: number;
  clips: [ShapeClip, Txt];
}

const paintColor = (p: string | Paint): string => (typeof p === 'string' ? p : p.type === 'solid' ? p.color : p.stops[Math.floor(p.stops.length / 2)].color);

/** A measured label on a rounded box. Position it with `setXY(p.clips, x, y)`. */
export function pill(env: TemplateEnv, content: string, o: PillOpts): Pill {
  const role = o.role ?? 'body';
  const padX = o.padX ?? o.size * 0.95;
  const padY = o.padY ?? o.size * 0.42;
  const delay = o.delay ?? 0;
  const color = o.color ?? textOn(env, paintColor(o.fill).slice(0, 7));
  const style: Partial<TextStyle> = { fontWeight: wt(env, role, o.weight ?? (role === 'body' ? 700 : env.fonts.heading.weight)) };
  if (o.upper) Object.assign(style, { uppercase: true, letterSpacing: o.track ?? 0.12 });
  const text = (role === 'heading' ? heading : body)(env, content, {
    name: o.name ? `${o.name} label` : content,
    start: o.start + delay,
    duration: Math.max(0.2, o.duration - delay),
    size: o.size,
    color,
    ...(o.maxWidth ? { maxWidth: o.maxWidth - padX * 2, maxLines: 1 } : {}),
    style: { lineHeight: 1.2, ...style, ...o.style },
    anim: o.labelAnim ?? o.anim,
    ...(o.textAnim ? { textAnim: o.textAnim } : {}),
  }) as Txt;
  const w = Math.round(Math.max(o.minWidth ?? 0, text.metrics.inkWidth + padX * 2));
  const h = Math.round(text.metrics.height + padY * 2);
  const box = makeShape('rect', {
    name: o.name ?? `${content} pill`,
    start: o.start,
    duration: o.duration,
    width: w,
    height: h,
    radius: o.radius ?? h / 2,
    fill: o.fill,
    ...(o.stroke ? { stroke: o.stroke } : {}),
    ...(o.shadow ? { shadow: o.shadow } : {}),
    ...(o.anim ? { anim: o.anim } : {}),
  });
  return { box, text, w, h, clips: [box, text] };
}

// ---------------------------------------------------------------------------------------------
// Overlays and backgrounds
// ---------------------------------------------------------------------------------------------

/** Gradient scrim that makes text readable over media. */
export function scrim(
  env: TemplateEnv,
  side: 'bottom' | 'top' | 'left' | 'right' | 'full',
  o: { start?: number; duration: number; strength?: number; extent?: number; color?: string; anim?: ClipAnimations; name?: string },
): ShapeClip {
  const col = o.color ?? '#05060a';
  const s = o.strength ?? 0.72;
  const e = o.extent ?? 0.55;
  const clear = alpha(col, 0);
  const dense = alpha(col, s);
  let w = env.cw;
  let h = env.ch;
  let x = 0;
  let y = 0;
  let fill: Paint;
  if (side === 'bottom') {
    h = Math.round(env.ch * e);
    y = env.ch / 2 - h / 2;
    fill = linear(90, clear, alpha(col, s * 0.55), dense);
  } else if (side === 'top') {
    h = Math.round(env.ch * e);
    y = -env.ch / 2 + h / 2;
    fill = linear(90, dense, alpha(col, s * 0.55), clear);
  } else if (side === 'left') {
    w = Math.round(env.cw * e);
    x = -env.cw / 2 + w / 2;
    fill = linear(0, dense, alpha(col, s * 0.55), clear);
  } else if (side === 'right') {
    w = Math.round(env.cw * e);
    x = env.cw / 2 - w / 2;
    fill = linear(0, clear, alpha(col, s * 0.55), dense);
  } else {
    fill = { type: 'solid', color: alpha(col, s) };
  }
  return makeShape('rect', { name: o.name ?? 'Scrim', start: o.start ?? 0, duration: o.duration, x, y, width: w, height: h, fill, ...(o.anim ? { anim: o.anim } : {}) });
}

export type BgKind =
  | 'aurora'
  | 'mesh'
  | 'glow'
  | 'flow'
  | 'solid'
  | 'grid'
  | 'dots'
  | 'bokeh'
  | 'silk'
  | 'waves'
  | 'stripes'
  | 'sunburst'
  | 'halftone'
  | 'dust'
  | 'spot'
  | 'studio'
  | 'paper'
  | 'confetti'
  | 'leaks'
  | 'stars'
  | 'topo'
  | 'linear';

/** A palette-aware animated background. */
export function backdrop(env: TemplateEnv, kind: BgKind, o: { start?: number; duration: number; name?: string; anim?: ClipAnimations; tint?: string } = { duration: 5 }): GeneratorClip {
  const c = env.palette;
  const dk = c.dark;
  const tint = o.tint ?? c.primary;
  let id = 'solid';
  let params: Record<string, number | string | boolean> = { colorA: c.bg };
  switch (kind) {
    case 'aurora':
      id = 'aurora';
      params = dk
        ? { colorA: c.primary, colorB: c.secondary, colorC: c.accent, colorBg: c.bg, speed: 0.6 }
        : { colorA: mix(c.bg, c.primary, 0.35), colorB: mix(c.bg, c.secondary, 0.4), colorC: mix(c.bg, c.accent, 0.3), colorBg: c.bg, speed: 0.6 };
      break;
    case 'mesh':
      id = 'mesh-gradient';
      params = dk
        ? { colorA: mix(c.bg, tint, 0.5), colorB: c.bg2, colorC: mix(c.bg, c.secondary, 0.3), colorD: c.bg, warp: 0.7, speed: 0.6 }
        : { colorA: mix(c.bg, tint, 0.2), colorB: c.bg, colorC: mix(c.bg, c.secondary, 0.22), colorD: c.bg2, warp: 0.7, speed: 0.6 };
      break;
    case 'glow':
      id = 'radial-glow';
      params = { colorA: dk ? mix(c.bg2, tint, 0.3) : mix(c.bg, '#ffffff', 0.7), colorB: dk ? c.bg : c.bg2, centerX: 0.5, centerY: 0.42, radius: 0.85, speed: 0.6 };
      break;
    case 'flow':
      id = 'gradient-flow';
      params = { colorA: c.bg, colorB: c.bg2, colorC: mix(c.bg2, tint, dk ? 0.45 : 0.25), angle: 35, flow: 0.6, speed: 0.6 };
      break;
    case 'linear':
      id = 'linear-gradient';
      params = { colorA: c.bg, colorB: c.bg2, angle: 60 };
      break;
    case 'grid':
      id = 'grid-lines';
      params = { colorBg: c.bg, colorA: mix(c.bg, c.text, dk ? 0.16 : 0.12), size: 64, major: 4, lineWidth: 1.5, fade: 0.7 };
      break;
    case 'dots':
      id = 'polka-dots';
      params = { colorA: mix(c.bg, tint, dk ? 0.3 : 0.18), colorB: c.bg, size: 9, spacing: 54, stagger: true, wave: 0.15 };
      break;
    case 'bokeh':
      id = 'bokeh';
      params = { colorBg: c.bg, colorA: c.primary, colorB: c.accent, colorC: c.secondary };
      break;
    case 'silk':
      id = 'flowing-silk';
      params = { colorA: c.bg, colorB: mix(c.bg, tint, 0.55), colorC: mix(c.bg2, c.secondary, 0.45), sheen: 0.5 };
      break;
    case 'waves':
      id = 'soft-waves';
      params = { colorA: dk ? tint : mix(c.bg, tint, 0.45), colorB: dk ? c.secondary : mix(c.bg, c.secondary, 0.45), colorBg: c.bg, amplitude: 0.7 };
      break;
    case 'stripes':
      id = 'stripes';
      params = { colorA: c.bg, colorB: mix(c.bg, tint, dk ? 0.16 : 0.1), width: 46, softness: 0 };
      break;
    case 'sunburst':
      id = 'sunburst';
      params = { colorA: tint, colorB: mix(tint, c.bg, 0.22), colorC: mix(tint, '#ffffff', 0.3), rays: 18, centerX: 0.5, centerY: 0.5, twist: 0, glow: 0.4 };
      break;
    case 'halftone':
      id = 'halftone';
      params = { colorA: mix(c.bg, tint, dk ? 0.45 : 0.3), colorB: c.bg, size: 26 };
      break;
    case 'dust':
      id = 'floating-dust';
      params = { colorBg: c.bg, colorA: mix(c.text, c.accent, 0.3), colorB: c.bg2 };
      break;
    case 'spot':
      id = 'spotlight';
      params = { colorBg: c.bg, colorA: dk ? mix(c.bg2, tint, 0.45) : mix(c.bg, '#ffffff', 0.85), posX: 0.5, posY: 0.45, radius: 0.42, softness: 0.6, haze: 0.3 };
      break;
    case 'studio':
      id = 'studio-backdrop';
      params = dk ? { colorA: mix(c.bg2, c.text, 0.14), colorB: c.bg, lightX: 0.5, lightY: 0.38, spread: 0.8, floorLine: 0.74 } : { colorA: mix(c.bg, '#ffffff', 0.75), colorB: c.bg2, lightX: 0.5, lightY: 0.38, spread: 0.8, floorLine: 0.74 };
      break;
    case 'paper':
      id = 'paper';
      params = { colorA: c.bg, colorB: c.bg2 };
      break;
    case 'confetti':
      id = 'confetti';
      params = { colorBg: c.bg, colorA: c.primary, colorB: c.secondary, colorC: c.accent, colorD: mix(c.primary, '#ffffff', 0.5) };
      break;
    case 'leaks':
      id = 'light-leaks';
      params = { colorBg: c.bg, colorA: tint, colorB: c.accent, colorC: c.secondary };
      break;
    case 'stars':
      id = 'starfield';
      params = { colorBg: c.bg, colorA: mix(c.text, '#ffffff', 0.5), colorB: c.bg2 };
      break;
    case 'topo':
      id = 'topographic';
      params = { colorBg: c.bg, colorA: mix(c.bg, tint, 0.28), colorB: mix(c.bg, c.secondary, 0.5) };
      break;
    case 'solid':
    default:
      id = 'solid';
      params = { colorA: c.bg };
  }
  return makeGenerator(id, { name: o.name ?? 'Background', start: o.start ?? 0, duration: o.duration, params, ...(o.anim ? { anim: o.anim } : {}) });
}
