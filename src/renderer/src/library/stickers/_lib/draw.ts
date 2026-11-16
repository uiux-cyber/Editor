/**
 * Shared Canvas 2D helpers for the vector sticker packs.
 *
 * Lives in `_lib/` because the library registry imports the default export of every
 * `stickers/*.ts` file; helper modules must stay out of that glob.
 */

import { Ease, clamp01, lerp, seededRandom } from '@/core/easing';
import { cssFamily, type BundledFontFamily } from '../../fonts';
import type { CanvasStickerDef, StickerCategory, StickerDrawEnv } from '../../types';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Paint = string | CanvasGradient;

export const PI = Math.PI;
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Sticker builder
// ---------------------------------------------------------------------------------------------

export interface StickerSpec {
  id: string;
  name: string;
  category: StickerCategory;
  /** Space-separated lower-case search terms. */
  keywords: string;
  /** width / height (default 1). */
  aspect?: number;
  /** Loop length in seconds. Omit for a static sticker. */
  period?: number;
  /** Key colours (2-4 hex strings); the user may override any of them. */
  colors: string[];
  /**
   * `p` is the loop phase in [0, 1) (always 0 for static stickers), so every frame is a pure
   * function of the phase and the frame at `t = period` equals the frame at `t = 0`.
   * `c` holds the resolved colours (`env.colors[i] ?? default`).
   */
  draw: (ctx: Ctx, p: number, env: StickerDrawEnv, c: string[]) => void;
}

export function sticker(spec: StickerSpec): CanvasStickerDef {
  const { period, colors, draw } = spec;
  const def: CanvasStickerDef = {
    id: spec.id,
    kind: 'canvas',
    name: spec.name,
    category: spec.category,
    keywords: spec.keywords.split(' ').filter(Boolean),
    aspect: spec.aspect ?? 1,
    animated: period !== undefined,
    colors,
    draw: (ctx, t, env) => {
      let p = 0;
      if (period) {
        p = (t % period) / period;
        if (!(p >= 0)) p = p < 0 ? p + 1 : 0;
      }
      const c = colors.map((d, i) => env.colors[i] ?? d);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      draw(ctx, p, env, c);
      ctx.restore();
    },
  };
  if (period !== undefined) def.period = period;
  return def;
}

// ---------------------------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------------------------

export const fract = (v: number): number => v - Math.floor(v);
/** Progress 0..1 of `p` through the sub-range [a, b]. */
export const seg = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));
/** 0 → 1 → 0 across [a, b], zero outside. */
export const bump = (p: number, a: number, b: number): number => Math.sin(seg(p, a, b) * PI);
/** Sine of the phase: -1..1, one full cycle per loop. */
export const wave = (p: number, shift = 0): number => Math.sin((p + shift) * TAU);
/** 0 → 1 → 0 once per loop (cosine bell). */
export const bell01 = (p: number, shift = 0): number => 0.5 - 0.5 * Math.cos((p + shift) * TAU);

/**
 * Loop envelope for "draw-on" strokes. The stroke is complete at p = 0 (so posters look right),
 * fades out, is drawn again and then holds. Returns [fraction drawn, alpha].
 */
export function drawOn(p: number): [number, number] {
  if (p < 0.3) return [1, 1];
  if (p < 0.42) return [1, 1 - seg(p, 0.3, 0.42)];
  if (p < 0.46) return [0, 0];
  if (p < 0.84) return [Ease.easeInOutCubic(seg(p, 0.46, 0.84)), 1];
  return [1, 1];
}

/** Damped spring-like overshoot: 0 → 1 with a little bounce. */
export const pop = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : Ease.easeOutBack(u));

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

type RGBA = [number, number, number, number];
const parsed = new Map<string, RGBA | null>();

function parse(color: string): RGBA | null {
  const hit = parsed.get(color);
  if (hit !== undefined) return hit;
  let out: RGBA | null = null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
    if (h.length === 6 || h.length === 8) {
      const n = parseInt(h.slice(0, 6), 16);
      out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
  }
  if (parsed.size > 2000) parsed.clear();
  parsed.set(color, out);
  return out;
}

const css = (r: number, g: number, b: number, a: number): string =>
  a >= 0.999 ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})` : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, a).toFixed(3)})`;

/** Blend two hex colours (returns `a` untouched when it is not a hex colour). */
export function mix(a: string, b: string, t: number): string {
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return a;
  return css(lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t), lerp(ca[3], cb[3], t));
}
export const lighten = (c: string, t: number): string => mix(c, '#ffffff', t);
export const darken = (c: string, t: number): string => mix(c, '#05060d', t);
/** Colour with its alpha multiplied by `a`. */
export function alpha(c: string, a: number): string {
  const v = parse(c);
  return v ? css(v[0], v[1], v[2], v[3] * a) : c;
}
/** Perceived lightness 0..1 (0.5 for non-hex colours). */
export function luma(c: string): number {
  const v = parse(c);
  return v ? (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 : 0.5;
}
/** A readable ink colour for text placed on `c`. */
export const inkOn = (c: string, light = '#ffffff', dark = '#14161f'): string => (luma(c) > 0.62 ? dark : light);

// ---------------------------------------------------------------------------------------------
// Paints
// ---------------------------------------------------------------------------------------------

export function lgrad(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, ...cols: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const n = cols.length - 1;
  for (let i = 0; i <= n; i++) g.addColorStop(n === 0 ? 0 : i / n, cols[i]);
  return g;
}
export const vgrad = (ctx: Ctx, y0: number, y1: number, ...cols: string[]): CanvasGradient => lgrad(ctx, 0, y0, 0, y1, ...cols);
export const hgrad = (ctx: Ctx, x0: number, x1: number, ...cols: string[]): CanvasGradient => lgrad(ctx, x0, 0, x1, 0, ...cols);
export function rgrad(ctx: Ctx, cx: number, cy: number, r0: number, r1: number, ...cols: string[]): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  const n = cols.length - 1;
  for (let i = 0; i <= n; i++) g.addColorStop(n === 0 ? 0 : i / n, cols[i]);
  return g;
}
/** Top-lit vertical gradient derived from one base colour — the pack's standard "body" fill. */
export const body = (ctx: Ctx, c: string, y0: number, y1: number, amt = 1): CanvasGradient =>
  vgrad(ctx, y0, y1, lighten(c, 0.2 * amt), c, darken(c, 0.16 * amt));

/** Soft drop shadow, resolution independent (canvas shadows ignore the current transform). */
export function shadow(ctx: Ctx, blur = 14, dy = 6, color = 'rgba(8,10,25,0.32)'): void {
  const m = ctx.getTransform();
  const s = Math.hypot(m.a, m.b);
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * s;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = dy * s;
}
export function noShadow(ctx: Ctx): void {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** Cheap ground shadow (no shadowBlur): a squashed radial gradient. */
export function groundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.28): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = rgrad(ctx, 0, 0, 0, rx, `rgba(8,10,25,${a})`, `rgba(8,10,25,${a * 0.5})`, 'rgba(8,10,25,0)');
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Paths (every helper starts a new path unless noted)
// ---------------------------------------------------------------------------------------------

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}
export function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}
export function poly(ctx: Ctx, pts: ArrayLike<number>, close = true): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
}
/** n-pointed star / starburst. */
export function star(ctx: Ctx, cx: number, cy: number, n: number, R: number, r: number, rot = -PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * PI) / n;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
/** Four-point sparkle with concave sides. */
export function sparkle(ctx: Ctx, cx: number, cy: number, R: number, waist = 0.16): void {
  const w = R * waist;
  ctx.beginPath();
  ctx.moveTo(cx, cy - R);
  ctx.quadraticCurveTo(cx + w, cy - w, cx + R, cy);
  ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + R);
  ctx.quadraticCurveTo(cx - w, cy + w, cx - R, cy);
  ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - R);
  ctx.closePath();
}
/** Heart centred on (cx, cy); `s` is roughly the half size. */
export function heart(ctx: Ctx, cx: number, cy: number, s: number): void {
  const k = s / 100;
  const X = (v: number): number => cx + v * k;
  const Y = (v: number): number => cy + v * k;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(96));
  ctx.bezierCurveTo(X(-128), Y(8), X(-108), Y(-108), X(-50), Y(-98));
  ctx.bezierCurveTo(X(-20), Y(-94), X(-5), Y(-74), X(0), Y(-54));
  ctx.bezierCurveTo(X(5), Y(-74), X(20), Y(-94), X(50), Y(-98));
  ctx.bezierCurveTo(X(108), Y(-108), X(128), Y(8), X(0), Y(96));
  ctx.closePath();
}
/** Check mark polyline (stroke it). `s` is roughly the half width. */
export function check(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.9, cy + s * 0.05);
  ctx.lineTo(cx - s * 0.28, cy + s * 0.62);
  ctx.lineTo(cx + s * 0.9, cy - s * 0.6);
}
/** Block arrow centred on the origin, pointing along +x. */
export function blockArrow(ctx: Ctx, len: number, shaft: number, headW: number, headL: number): void {
  const x0 = -len / 2;
  const x1 = len / 2;
  const xn = x1 - headL;
  ctx.beginPath();
  ctx.moveTo(x0, -shaft / 2);
  ctx.lineTo(xn, -shaft / 2);
  ctx.lineTo(xn, -headW / 2);
  ctx.lineTo(x1, 0);
  ctx.lineTo(xn, headW / 2);
  ctx.lineTo(xn, shaft / 2);
  ctx.lineTo(x0, shaft / 2);
  ctx.closePath();
}
/**
 * Flame silhouette centred on (cx, cy) with half-height `s`. `sway` (-1..1) bends the tip
 * sideways, `lick` (-1..1) stretches the tongues — animate both for a flicker.
 */
export function flame(ctx: Ctx, cx: number, cy: number, s: number, sway = 0, lick = 0): void {
  const k = s / 110;
  const X = (x: number, y: number): number => {
    const up = clamp01((105 - y) / 217);
    return cx + (x + sway * 34 * up * up) * k;
  };
  const Y = (y: number): number => cy + (y < 0 ? y * (1 + lick * 0.1) : y) * k;
  const C = (ax: number, ay: number, bx: number, by: number, x: number, y: number): void =>
    ctx.bezierCurveTo(X(ax, ay), Y(ay), X(bx, by), Y(by), X(x, y), Y(y));
  ctx.beginPath();
  ctx.moveTo(X(0, 105), Y(105));
  C(-62, 105, -92, 60, -88, 14);
  C(-86, -18, -66, -40, -52, -64);
  C(-48, -38, -38, -24, -24, -20);
  C(-32, -60, -8, -98, 20, -112);
  C(16, -80, 40, -62, 58, -38);
  C(80, -10, 92, 20, 88, 50);
  C(84, 84, 50, 105, 0, 105);
  ctx.closePath();
}
/** Bell (dome + rim) with unit half-height `s`, centred on the origin. Fill it. */
export function bell(ctx: Ctx, s: number): void {
  ctx.beginPath();
  ctx.moveTo(-0.72 * s, 0.5 * s);
  ctx.bezierCurveTo(-0.42 * s, 0.26 * s, -0.58 * s, -0.78 * s, 0, -0.78 * s);
  ctx.bezierCurveTo(0.58 * s, -0.78 * s, 0.42 * s, 0.26 * s, 0.72 * s, 0.5 * s);
  ctx.quadraticCurveTo(0.78 * s, 0.64 * s, 0.62 * s, 0.64 * s);
  ctx.lineTo(-0.62 * s, 0.64 * s);
  ctx.quadraticCurveTo(-0.78 * s, 0.64 * s, -0.72 * s, 0.5 * s);
  ctx.closePath();
  ctx.moveTo(0.11 * s, -0.86 * s);
  ctx.arc(0, -0.86 * s, 0.11 * s, 0, TAU);
}
/** Cloud made of overlapping circles on a flat base; centred on (cx, cy), `w` wide. */
export function cloud(ctx: Ctx, cx: number, cy: number, w: number): void {
  const u = w / 200;
  ctx.beginPath();
  const blob = (x: number, y: number, r: number): void => {
    ctx.moveTo(cx + (x + r) * u, cy + y * u);
    ctx.arc(cx + x * u, cy + y * u, r * u, 0, TAU);
  };
  blob(-56, 8, 34);
  blob(-16, -18, 44);
  blob(36, -4, 36);
  blob(68, 14, 24);
  ctx.roundRect(cx - 90 * u, cy - 6 * u, 182 * u, 48 * u, 24 * u);
}
/** Bolt polygon centred on (cx, cy) with half-height `s`. */
export function bolt(ctx: Ctx, cx: number, cy: number, s: number): void {
  const k = s / 100;
  poly(ctx, [18, -100, -52, 12, -8, 12, -24, 100, 54, -22, 8, -22, 30, -100].map((v, i) => (i % 2 === 0 ? cx + v * k : cy + v * k)));
}

// ---------------------------------------------------------------------------------------------
// Hand-drawn strokes
// ---------------------------------------------------------------------------------------------

/** Sample a parametric curve into a flat [x0, y0, x1, y1, …] polyline. */
export function sample(n: number, fn: (u: number) => [number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = fn(i / n);
    out.push(x, y);
  }
  return out;
}
/** Cubic Bézier as a parametric function. */
export function bez(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): (u: number) => [number, number] {
  return (u) => {
    const v = 1 - u;
    const a = v * v * v;
    const b = 3 * v * v * u;
    const c = 3 * v * u * u;
    const d = u * u * u;
    return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
  };
}
/** Adds smooth, seeded low-frequency jitter so a polyline looks drawn by hand. */
export function wobble(pts: number[], amp: number, seed: number, knots = 9): number[] {
  const rnd = seededRandom(seed);
  const kx: number[] = [];
  const ky: number[] = [];
  for (let i = 0; i <= knots + 1; i++) {
    kx.push((rnd() - 0.5) * 2 * amp);
    ky.push((rnd() - 0.5) * 2 * amp);
  }
  const n = pts.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / Math.max(1, n - 1)) * knots;
    const j = Math.floor(f);
    const u = f - j;
    const e = u * u * (3 - 2 * u);
    out.push(pts[i * 2] + lerp(kx[j], kx[j + 1], e), pts[i * 2 + 1] + lerp(ky[j], ky[j + 1], e));
  }
  return out;
}
/** Stroke the first fraction `f` of a polyline with the current stroke settings. */
export function strokePts(ctx: Ctx, pts: ArrayLike<number>, f = 1): void {
  const n = pts.length / 2;
  if (n < 2 || f <= 0) return;
  const last = (n - 1) * Math.min(1, f);
  const i1 = Math.floor(last);
  const fr = last - i1;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i <= i1; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  if (fr > 0 && i1 < n - 1) ctx.lineTo(lerp(pts[i1 * 2], pts[i1 * 2 + 2], fr), lerp(pts[i1 * 2 + 1], pts[i1 * 2 + 3], fr));
  ctx.stroke();
}
/** Marker stroke with a faint offset shade so it reads on light and dark footage. */
export function ink(ctx: Ctx, pts: ArrayLike<number>, f: number, color: string, width: number, a = 1, shade = '#080a19'): void {
  if (f <= 0 || a <= 0) return;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(width * 0.16, width * 0.3);
  ctx.strokeStyle = alpha(shade, 0.24 * a);
  strokePts(ctx, pts, f);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.strokeStyle = color;
  strokePts(ctx, pts, f);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

export interface TextOpts {
  size: number;
  /** Shrinks the font until the text fits this width. */
  maxW?: number;
  family?: BundledFontFamily;
  weight?: number;
  fill?: Paint | null;
  stroke?: Paint;
  strokeW?: number;
  /** Letter spacing in em. */
  spacing?: number;
}

const families = new Map<string, string>();
function familyCss(name: BundledFontFamily): string {
  let v = families.get(name);
  if (!v) {
    v = cssFamily(name);
    families.set(name, v);
  }
  return v;
}

/**
 * Draws a short label centred on (x, y) — optically centred from the real glyph bounds so caps
 * sit in the middle of their shape with any font. Returns the font size actually used.
 */
export function text(ctx: Ctx, str: string, x: number, y: number, o: TextOpts): number {
  const fam = familyCss(o.family ?? 'Montserrat');
  const weight = o.weight ?? 800;
  const sp = o.spacing ?? 0;
  let size = o.size;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const apply = (): TextMetrics => {
    ctx.font = `${weight} ${size}px ${fam}`;
    ctx.letterSpacing = `${(sp * size).toFixed(2)}px`;
    return ctx.measureText(str);
  };
  let m = apply();
  if (o.maxW && m.width > o.maxW) {
    size = Math.max(4, (size * o.maxW) / m.width);
    m = apply();
  }
  const tx = x + (sp * size) / 2;
  const ty = y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.strokeW ?? size * 0.14;
    ctx.strokeStyle = o.stroke;
    ctx.strokeText(str, tx, ty);
  }
  if (o.fill !== null) {
    ctx.fillStyle = o.fill ?? '#ffffff';
    ctx.fillText(str, tx, ty);
  }
  ctx.letterSpacing = '0px';
  return size;
}

// ---------------------------------------------------------------------------------------------
// Composite pieces reused by several stickers
// ---------------------------------------------------------------------------------------------

/** Rounded "button" body: gradient fill, one soft shadow and a subtle top bevel highlight. */
export function button(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: Paint, shadowColor?: string): void {
  shadow(ctx, 16, 8, shadowColor ?? 'rgba(8,10,25,0.32)');
  ctx.fillStyle = fill;
  rrect(ctx, x, y, w, h, r);
  ctx.fill();
  noShadow(ctx);
  bevel(ctx, x, y, w, h, r);
}
/** Thin top-lit inner highlight for a rounded rect. */
export function bevel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, a = 0.5): void {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = vgrad(ctx, y, y + h * 0.7, `rgba(255,255,255,${a})`, 'rgba(255,255,255,0)');
  rrect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, r - 2.5);
  ctx.stroke();
  ctx.restore();
}
/** Diagonal light band sweeping across the current clip region; `u` runs 0 → 1. */
export function sweep(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, u: number, width = 70, a = 0.55): void {
  if (u <= 0 || u >= 1) return;
  const h = y1 - y0;
  const lean = h * 0.4;
  // (x, y1) is the band's bottom-left corner; it travels from fully left of x0 to fully right of x1.
  const x = lerp(x0 - width - lean, x1, u);
  // Gradient axis perpendicular to the leaning edges so the falloff follows the band.
  ctx.fillStyle = lgrad(ctx, x, y1, x + width * 0.862, y1 + width * 0.345, 'rgba(255,255,255,0)', `rgba(255,255,255,${a})`, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.moveTo(x + lean, y0);
  ctx.lineTo(x + width + lean, y0);
  ctx.lineTo(x + width, y1);
  ctx.lineTo(x, y1);
  ctx.closePath();
  ctx.fill();
}
/** A twinkling four-point sparkle: `u` is its own 0..1 phase. */
export function twinkle(ctx: Ctx, x: number, y: number, R: number, u: number, color: Paint): void {
  const k = bell01(u);
  if (k <= 0.02) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((u - 0.5) * 0.9);
  ctx.globalAlpha *= Math.min(1, k * 1.4);
  ctx.fillStyle = color;
  sparkle(ctx, 0, 0, R * (0.35 + 0.65 * k));
  ctx.fill();
  ctx.restore();
}

/**
 * Folded ribbon banner: a band from x0 to x1 (y0..y1) with notched tails dropping behind it.
 * Draws one soft shadow. The caller adds the label.
 */
export function ribbon(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, color: string, drop = 22, tail = 64, fold = 40): void {
  const dark = darken(color, 0.3);
  const tailFill = vgrad(ctx, y0 + drop, y1 + drop, darken(color, 0.06), darken(color, 0.2));
  const notch = (y1 - y0) * 0.3;
  for (const side of [-1, 1]) {
    const xb = side < 0 ? x0 : x1; // band edge
    const xi = xb - side * fold; // inner end of the tail (hidden behind the band)
    const xo = xb + side * tail; // outer end
    ctx.fillStyle = tailFill;
    poly(ctx, [xi, y0 + drop, xo, y0 + drop, xo - side * notch, (y0 + y1) / 2 + drop, xo, y1 + drop, xi, y1 + drop]);
    ctx.fill();
    ctx.fillStyle = dark;
    poly(ctx, [xb, y1, xi, y1, xi, y1 + drop]);
    ctx.fill();
  }
  shadow(ctx, 12, 6, 'rgba(8,10,25,0.28)');
  ctx.fillStyle = body(ctx, color, y0, y1);
  rrect(ctx, x0, y0, x1 - x0, y1 - y0, 6);
  ctx.fill();
  noShadow(ctx);
  ctx.save();
  ctx.setLineDash([10, 9]);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(x0 + 10, y0 + 10);
  ctx.lineTo(x1 - 10, y0 + 10);
  ctx.moveTo(x0 + 10, y1 - 10);
  ctx.lineTo(x1 - 10, y1 - 10);
  ctx.stroke();
  ctx.restore();
}
/**
 * Strokes a line-art path twice — a faint offset shade, then the colour — so thin white or
 * pastel strokes stay readable on light footage. `path` must build the path (beginPath…).
 */
export function shaded(ctx: Ctx, color: Paint, shade: string, lw: number, path: () => void, a = 0.24): void {
  ctx.lineWidth = lw;
  ctx.save();
  ctx.translate(lw * 0.16, lw * 0.3);
  ctx.strokeStyle = alpha(shade, a);
  path();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = color;
  path();
  ctx.stroke();
}
/** Polyline for a hand-drawn "V" arrow head whose tip sits at (x, y) and points along `angle`. */
export function headPts(x: number, y: number, angle: number, len: number, spread = 0.6): number[] {
  const a1 = angle + PI - spread;
  const a2 = angle + PI + spread;
  const out: number[] = [];
  for (let i = 0; i <= 8; i++) out.push(x + Math.cos(a1) * len * (1 - i / 8), y + Math.sin(a1) * len * (1 - i / 8));
  for (let i = 1; i <= 8; i++) out.push(x + (Math.cos(a2) * len * i) / 8, y + (Math.sin(a2) * len * i) / 8);
  return out;
}
