/**
 * Thumbnail designs (Templates ▸ Thumbnail): still cover pictures for videos, built the way top
 * creators make them — a big face cut out of its background with a white outline, two or three
 * huge words with a thick outline, one highlighted word, an arrow or ring pointing at the
 * subject, and the video frame behind it all. No animation: every frame is the picture.
 *
 * Placeholders: `Background` receives the captured video frame; `Person` (and named variants)
 * removes the background of the photo dropped in and outlines it; other placeholders are plain.
 */

import { linear, makeEffect, makeShape, makeSlot, makeSticker, radial } from '@/core/factory';
import type { Clip, ShapeClip, StickerClip, TextClip } from '@/core/types';
import type { TextMetrics } from '@/engine/sources/textLayout';
import { BRAND_FONTS_ID } from '../brand';
import { nearestWeight } from '../fonts';
import type { TemplateDef, TemplateEnv } from '../types';
import { slotFill } from './_lib/a-kit';
import { heading } from './_lib/kit';
import { alpha, contrast, luminance, mix } from './_lib/kit';

type T = TextClip & { metrics: TextMetrics };

const D = 5;

// ---------------------------------------------------------------------------------------------
// A small kit for thumbnails
// ---------------------------------------------------------------------------------------------

/** Heavy faces that read at thumbnail size. */
const PUNCHY = ['Anton', 'Archivo Black', 'Montserrat', 'Bebas Neue', 'Poppins', 'Rubik'];
const GOOD = new Set(['Anton', 'Archivo Black', 'Bebas Neue', 'Bangers', 'Montserrat', 'Poppins', 'Inter', 'Rubik', 'Oswald', 'Syne', 'Righteous', 'Shrikhand', 'Abril Fatface', 'DM Serif Display', 'Playfair Display', 'Space Grotesk']);

interface Face {
  family: string;
  weight: number;
}

/** The headline face: the brand's heading, the pair's heading when it is heavy enough, else a punchy one. */
function punch(env: TemplateEnv): Face {
  const h = env.fonts.heading;
  if (env.fonts.id === BRAND_FONTS_ID || GOOD.has(h.family)) return { family: h.family, weight: nearestWeight(h.family, 900) };
  const f = PUNCHY[Math.floor(env.rng() * PUNCHY.length) % PUNCHY.length];
  return { family: f, weight: nearestWeight(f, 900) };
}

/** Saturation (0..1) of a hex colour. */
function saturation(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** The palette colour that pops most on a photo (bright and saturated), with a yellow fallback. */
function pop(env: TemplateEnv): string {
  const c = env.palette;
  const score = (x: string): number => saturation(x) + luminance(x) * 0.6;
  const list = [c.accent, c.primary, c.secondary].filter((x) => luminance(x) > 0.2 && saturation(x) > 0.35);
  return list.sort((a, b) => score(b) - score(a))[0] ?? '#ffd43b';
}

/** A second strong colour for panels / badges (the primary, unless it is too dark or too close to white). */
function strong(env: TemplateEnv): string {
  const c = env.palette;
  return [c.primary, c.secondary, c.accent].find((x) => luminance(x) > 0.06 && luminance(x) < 0.75) ?? '#e63946';
}

const ink = (fill: string): string => (contrast('#ffffff', fill) >= contrast('#111318', fill) ? '#ffffff' : '#111318');

interface WordOpts {
  size: number;
  color: string;
  maxWidth: number;
  x: number;
  y: number;
  align?: 'left' | 'center' | 'right';
  /** Outline colour (default near-black); null for none. */
  outline?: string | null;
  /** Hard drop shadow. */
  shadow?: boolean;
  /** A solid box behind the words. */
  box?: string;
  rotation?: number;
  glow?: string;
  face?: Face;
  name?: string;
  /** Lines allowed before shrinking (default 1). */
  lines?: number;
}

/** A line of headline words: heavy, upper case, outlined, with a hard shadow. */
function words(env: TemplateEnv, content: string, opts: WordOpts): T {
  // Text layers stay within the editor's size range: giant glyphs are drawn smaller and scaled up.
  const k = opts.size > 560 ? opts.size / 560 : 1;
  const o = k === 1 ? opts : { ...opts, size: 560, maxWidth: opts.maxWidth / k };
  const face = o.face ?? punch(env);
  const outline = o.outline === undefined ? '#0b0b0f' : o.outline;
  const box = o.box;
  const t = heading(env, content, {
    name: o.name ?? content.slice(0, 30),
    duration: D,
    size: o.size,
    maxWidth: o.maxWidth,
    maxLines: o.lines ?? 1,
    minSize: Math.round(o.size * 0.35),
    color: o.color,
    rotation: o.rotation ?? 0,
    style: {
      fontFamily: face.family,
      fontWeight: face.weight,
      uppercase: true,
      align: o.align ?? 'center',
      lineHeight: 0.98,
      letterSpacing: 0.005,
      ...(outline && !box ? { stroke: { color: outline, width: Math.max(4, Math.round(o.size * 0.075)) } } : {}),
      ...(o.shadow !== false && !box ? { shadow: { color: '#000000b3', blur: Math.round(o.size * 0.05), x: 0, y: Math.round(o.size * 0.07) } } : {}),
      ...(box ? { background: { color: box, opacity: 1, padX: Math.round(o.size * 0.22), padY: Math.round(o.size * 0.08), radius: Math.round(o.size * 0.12) } } : {}),
      ...(o.glow ? { glow: { color: o.glow, blur: Math.round(o.size * 0.35) } } : {}),
    },
  }) as T;
  if (k !== 1) t.transform.scaleX = t.transform.scaleY = k;
  const w = t.metrics.width * k;
  t.transform.x = Math.round(o.align === 'left' ? o.x + w / 2 : o.align === 'right' ? o.x - w / 2 : o.x);
  t.transform.y = Math.round(o.y);
  return t;
}

/** Height of a words layer (its box, scaled). */
const hOf = (t: T): number => t.metrics.height * Math.abs(t.transform.scaleY);
/** Width of a words layer (its box, scaled). */
const wOf = (t: T): number => t.metrics.width * Math.abs(t.transform.scaleX);

/** The full-frame placeholder that receives the captured video frame. */
function background(env: TemplateEnv, name = 'Background'): ShapeClip {
  return makeSlot({ name, duration: D, width: env.cw, height: env.ch, fill: slotFill(env) });
}

/**
 * A placeholder for a person: the photo dropped in has its background removed and gets a white
 * outline and a soft shadow (the classic thumbnail face).
 */
function person(env: TemplateEnv, o: { name?: string; width: number; height: number; x: number; y: number; outline?: string; flip?: boolean }): ShapeClip {
  const slot = makeSlot({
    name: o.name ?? 'Person',
    duration: D,
    width: Math.round(o.width),
    height: Math.round(o.height),
    x: Math.round(o.x),
    y: Math.round(o.y),
    radius: Math.round(Math.min(o.width, o.height) * 0.06),
    fill: slotFill(env),
    flipH: !!o.flip,
    effects: [makeEffect('stroke', { width: 9, color: o.outline ?? '#ffffff', amount: 1 }), makeEffect('drop-shadow', { amount: 0.6, dist: 18, angle: 70, softness: 30, color: '#000000' })],
  });
  slot.cutout = { enabled: true, feather: 0.2, choke: 0 };
  return slot;
}

/** A photo placeholder (plain: no background removal). */
function photo(env: TemplateEnv, o: { name: string; width: number; height: number; x: number; y: number; radius?: number; rotation?: number; border?: string }): ShapeClip {
  return makeSlot({
    name: o.name,
    duration: D,
    width: Math.round(o.width),
    height: Math.round(o.height),
    x: Math.round(o.x),
    y: Math.round(o.y),
    rotation: o.rotation ?? 0,
    radius: Math.round(o.radius ?? 0),
    fill: slotFill(env),
    ...(o.border ? { stroke: { color: o.border, width: Math.max(6, Math.round(Math.min(o.width, o.height) * 0.02)) } } : {}),
    effects: [makeEffect('drop-shadow', { amount: 0.55, dist: 16, angle: 70, softness: 28, color: '#000000' })],
  });
}

/** Darkening across the frame (or one side) so words read on any footage. */
function shade(env: TemplateEnv, side: 'left' | 'right' | 'bottom' | 'top' | 'all', strength = 0.65): ShapeClip {
  const clear = alpha('#000000', 0);
  const dense = alpha('#000000', strength);
  const fill =
    side === 'left' ? linear(0, dense, alpha('#000000', strength * 0.5), clear) : side === 'right' ? linear(0, clear, alpha('#000000', strength * 0.5), dense) : side === 'bottom' ? linear(90, clear, dense) : side === 'top' ? linear(90, dense, clear) : radial(alpha('#000000', strength * 0.25), dense);
  return makeShape('rect', { name: 'Shade', duration: D, width: env.cw, height: env.ch, fill });
}

/** An emoji sticker by character. */
function emoji(char: string, o: { size: number; x: number; y: number; rotation?: number }): StickerClip {
  const cps: string[] = [];
  for (const ch of char) cps.push(ch.codePointAt(0)!.toString(16));
  return makeSticker('emoji-' + cps.join('-'), { name: 'Emoji', duration: D, size: Math.round(o.size * 1.7), x: Math.round(o.x), y: Math.round(o.y), rotation: o.rotation ?? 0, effects: [makeEffect('drop-shadow', { amount: 0.5, dist: 10, angle: 70, softness: 16, color: '#000000' })] });
}

/** A rating: `n` gold stars out of five (the rest faded). */
function stars(n: number, o: { size: number; x: number; y: number; gap: number }): Clip[] {
  return Array.from({ length: 5 }, (_, i) => {
    const st = emoji('⭐', { size: o.size, x: o.x + i * o.gap, y: o.y });
    if (i >= n) st.transform.opacity = 0.3;
    return st;
  });
}

/** A hand-drawn style arrow. */
function arrow(o: { size: number; x: number; y: number; rotation: number; color: string; flip?: boolean }): Clip {
  return makeSticker('arrow-swoosh', {
    name: 'Arrow',
    duration: D,
    size: Math.round(o.size),
    x: Math.round(o.x),
    y: Math.round(o.y),
    rotation: o.rotation,
    flipH: !!o.flip,
    colors: [o.color, o.color],
    effects: [makeEffect('stroke', { width: 6, color: '#0b0b0f', amount: 1 }), makeEffect('drop-shadow', { amount: 0.5, dist: 10, angle: 70, softness: 14, color: '#000000' })],
  });
}

/** A highlight ring around something in the frame. */
function ring(o: { w: number; h: number; x: number; y: number; color: string }): ShapeClip {
  return makeShape('ellipse', {
    name: 'Highlight ring',
    duration: D,
    width: Math.round(o.w),
    height: Math.round(o.h),
    x: Math.round(o.x),
    y: Math.round(o.y),
    fill: '#00000000',
    stroke: { color: o.color, width: Math.max(10, Math.round(Math.min(o.w, o.h) * 0.06)) },
    shadow: { color: '#000000aa', blur: 18, x: 0, y: 6 },
  });
}

/** A rounded pill label. */
function pill(env: TemplateEnv, content: string, o: { size: number; x: number; y: number; fill: string; align?: 'left' | 'center' | 'right'; rotation?: number }): T {
  return words(env, content, { size: o.size, color: ink(o.fill), box: o.fill, maxWidth: env.cw * 0.6, x: o.x, y: o.y, align: o.align, rotation: o.rotation, name: content });
}

const safe = (env: TemplateEnv): { mx: number; my: number; left: number; right: number; top: number; bottom: number } => {
  const mx = Math.round(env.cw * (env.portrait ? 0.07 : 0.045));
  const my = Math.round(env.ch * (env.portrait ? 0.05 : 0.07));
  return { mx, my, left: -env.cw / 2 + mx, right: env.cw / 2 - mx, top: -env.ch / 2 + my, bottom: env.ch / 2 - my };
};

const thumb = (o: Omit<TemplateDef, 'category' | 'duration' | 'poster'>): TemplateDef => ({ ...o, category: 'thumbnail', duration: D, poster: 0.5 });

// ---------------------------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------------------------

const templates: TemplateDef[] = [
  // Big face on one side, two lines of huge words on the other, an arrow between them.
  thumb({
    id: 'thumb-shock',
    name: 'Shock Reaction',
    tags: ['thumbnail', 'reaction', 'face', 'youtube', 'cover', 'arrow', 'bold'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [background(env), shade(env, env.portrait ? 'top' : 'left', 0.7)];
      if (env.portrait) {
        const ph = env.ch * 0.56;
        out.push(person(env, { width: ph * 0.85, height: ph, x: 0, y: env.ch / 2 - ph / 2 }));
        const l1 = words(env, "I can't", { size: 190, color: '#ffffff', maxWidth: env.cw - s.mx * 2, x: 0, y: s.top + 150, face });
        const l2 = words(env, 'believe it', { size: 200, color: hi, maxWidth: env.cw - s.mx * 2, x: 0, y: l1.transform.y + hOf(l1) * 0.5 + 110, face });
        out.push(l1, l2, arrow({ size: 240, x: env.cw * 0.3, y: l2.transform.y + hOf(l2) / 2 + 190, rotation: 110, color: hi }));
        return out;
      }
      const ph = env.ch * 0.94;
      out.push(person(env, { width: ph * 0.8, height: ph, x: s.right - ph * 0.36, y: env.ch / 2 - ph / 2 }));
      const w = env.cw * (env.square ? 0.6 : 0.52);
      const l1 = words(env, "I can't", { size: env.square ? 150 : 200, color: '#ffffff', maxWidth: w, x: s.left, y: -env.ch * 0.14, align: 'left', face, rotation: -3 });
      const l2 = words(env, 'believe it', { size: env.square ? 160 : 215, color: hi, maxWidth: w, x: s.left, y: l1.transform.y + hOf(l1) * 0.5 + (env.square ? 90 : 120), align: 'left', face, rotation: -3 });
      out.push(l1, l2, arrow({ size: env.square ? 240 : 300, x: s.left + w * 0.86, y: env.ch * 0.3, rotation: -12, color: hi }), emoji('😱', { size: env.square ? 150 : 180, x: s.left + 90, y: s.top + 60, rotation: -12 }));
      return out;
    },
  }),

  // Two sides, a VS badge in the middle, a label under each.
  thumb({
    id: 'thumb-versus',
    name: 'Versus',
    tags: ['thumbnail', 'vs', 'versus', 'comparison', 'battle', 'which is better'],
    build: (env) => {
      const hi = pop(env);
      const bar = strong(env);
      const face = punch(env);
      const out: Clip[] = [];
      const lbl = (txt: string, x: number, y: number, fill: string): T => pill(env, txt, { size: env.portrait ? 92 : 84, x, y, fill });
      if (env.portrait) {
        const h = env.ch / 2;
        out.push(photo(env, { name: 'Photo 1', width: env.cw, height: h, x: 0, y: -h / 2 }), photo(env, { name: 'Photo 2', width: env.cw, height: h, x: 0, y: h / 2 }));
        out.push(makeShape('rect', { name: 'Divider', duration: D, width: env.cw * 1.2, height: 26, rotation: -4, fill: '#ffffff' }));
        out.push(lbl('iPhone', 0, -h + 150, bar), lbl('Android', 0, h - 150, hi));
      } else {
        const w = env.cw / 2;
        out.push(photo(env, { name: 'Photo 1', width: w + 40, height: env.ch, x: -w / 2 - 20, y: 0 }), photo(env, { name: 'Photo 2', width: w + 40, height: env.ch, x: w / 2 + 20, y: 0 }));
        out.push(makeShape('rect', { name: 'Divider', duration: D, width: 24, height: env.ch * 1.3, rotation: 7, fill: '#ffffff' }));
        out.push(lbl('iPhone', -w / 2, env.ch / 2 - 120, bar), lbl('Android', w / 2, env.ch / 2 - 120, hi));
      }
      const r = env.portrait ? 300 : 300;
      out.push(makeShape('ellipse', { name: 'VS badge', duration: D, width: r, height: r, fill: linear(135, hi, mix(hi, '#000000', 0.25)), stroke: { color: '#ffffff', width: 14 }, shadow: { color: '#000000aa', blur: 30, x: 0, y: 12 } }));
      out.push(words(env, 'VS', { size: 170, color: ink(hi), outline: null, shadow: false, maxWidth: r * 0.86, x: 0, y: 6, face }));
      return out;
    },
  }),

  // A giant outlined number with a two-line promise.
  thumb({
    id: 'thumb-number',
    name: 'Big Number List',
    tags: ['thumbnail', 'list', 'top 10', 'number', 'tips', 'listicle'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [background(env), shade(env, env.portrait ? 'bottom' : 'left', 0.78)];
      if (env.portrait) {
        const n = words(env, '7', { size: 760, color: '#00000000', outline: hi, shadow: false, maxWidth: env.cw, x: 0, y: env.ch * 0.06, face });
        n.text.stroke = { color: hi, width: Math.round(22 / n.transform.scaleX) };
        const a = words(env, 'Things I wish', { size: 150, color: '#ffffff', maxWidth: env.cw - s.mx * 2, x: 0, y: env.ch * 0.3, face });
        const b = words(env, 'I knew sooner', { size: 150, color: hi, maxWidth: env.cw - s.mx * 2, x: 0, y: env.ch * 0.3 + hOf(a) * 0.5 + 95, face });
        out.push(n, a, b);
        return out;
      }
      const n = words(env, '7', { size: env.ch * 1.05, color: '#00000000', outline: hi, shadow: false, maxWidth: env.cw * 0.4, x: s.left + 10, y: env.ch * 0.03, align: 'left', face });
      n.text.stroke = { color: hi, width: Math.round(24 / n.transform.scaleX) };
      const x = s.left + wOf(n) + env.cw * 0.03;
      const w = s.right - x;
      const a = words(env, 'Things I wish', { size: 175, color: '#ffffff', maxWidth: w, x, y: -env.ch * 0.12, align: 'left', face });
      const b = words(env, 'I knew sooner', { size: 175, color: hi, maxWidth: w, x, y: a.transform.y + hOf(a) * 0.5 + 115, align: 'left', face });
      out.push(n, a, b);
      return out;
    },
  }),

  // Before / after split with labels and an arrow across.
  thumb({
    id: 'thumb-before-after',
    name: 'Before / After',
    tags: ['thumbnail', 'before after', 'transformation', 'makeover', 'results', 'glow up'],
    build: (env) => {
      const hi = pop(env);
      const out: Clip[] = [];
      if (env.portrait) {
        const h = env.ch / 2;
        out.push(photo(env, { name: 'Before', width: env.cw, height: h, x: 0, y: -h / 2 }), photo(env, { name: 'After', width: env.cw, height: h, x: 0, y: h / 2 }));
        out.push(makeShape('rect', { name: 'Seam', duration: D, width: env.cw, height: 14, fill: '#ffffff' }));
        out.push(pill(env, 'Before', { size: 96, x: -env.cw / 2 + 60, y: -h + 120, fill: '#111318', align: 'left' }), pill(env, 'After', { size: 96, x: -env.cw / 2 + 60, y: 120, fill: hi, align: 'left' }));
        out.push(makeShape('ellipse', { name: 'Arrow badge', duration: D, width: 220, height: 220, fill: hi, stroke: { color: '#ffffff', width: 12 }, shadow: { color: '#000000aa', blur: 30, x: 0, y: 12 } }));
        out.push(words(env, '↓', { size: 160, color: ink(hi), outline: null, shadow: false, maxWidth: 200, x: 0, y: -4, face: { family: 'Inter', weight: 900 } }));
        return out;
      }
      const w = env.cw / 2;
      out.push(photo(env, { name: 'Before', width: w, height: env.ch, x: -w / 2, y: 0 }), photo(env, { name: 'After', width: w, height: env.ch, x: w / 2, y: 0 }));
      out.push(makeShape('rect', { name: 'Seam', duration: D, width: 14, height: env.ch, fill: '#ffffff' }));
      out.push(pill(env, 'Before', { size: 96, x: -env.cw / 2 + 60, y: -env.ch / 2 + 110, fill: '#111318', align: 'left' }), pill(env, 'After', { size: 96, x: 60, y: -env.ch / 2 + 110, fill: hi, align: 'left' }));
      out.push(makeShape('ellipse', { name: 'Arrow badge', duration: D, width: 230, height: 230, fill: hi, stroke: { color: '#ffffff', width: 12 }, shadow: { color: '#000000aa', blur: 30, x: 0, y: 12 } }));
      out.push(words(env, '→', { size: 170, color: ink(hi), outline: null, shadow: false, maxWidth: 200, x: 0, y: -6, face: { family: 'Inter', weight: 900 } }));
      return out;
    },
  }),

  // A solid panel with the promise, the frame beside it, the person over the seam.
  thumb({
    id: 'thumb-howto',
    name: 'How-To Panel',
    tags: ['thumbnail', 'tutorial', 'how to', 'guide', 'education', 'course'],
    build: (env) => {
      const s = safe(env);
      const panel = strong(env);
      const on = ink(panel);
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [background(env)];
      if (env.portrait) {
        const ph = env.ch * 0.42;
        out.push(makeShape('rect', { name: 'Panel', duration: D, width: env.cw, height: env.ch * 0.42, y: -env.ch * 0.29, fill: linear(135, panel, mix(panel, '#000000', 0.3)) }));
        const k = pill(env, 'Step by step', { size: 70, x: 0, y: -env.ch / 2 + 110, fill: hi });
        const a = words(env, 'Edit 10× faster', { size: 190, color: on, outline: null, maxWidth: env.cw - s.mx * 2, x: 0, y: -env.ch * 0.28, face, lines: 2 });
        out.push(k, a, person(env, { width: ph * 0.85, height: ph, x: 0, y: env.ch / 2 - ph / 2 }));
        return out;
      }
      const pw = env.cw * (env.square ? 0.56 : 0.47);
      out.push(makeShape('rect', { name: 'Panel', duration: D, width: pw, height: env.ch * 1.3, x: -env.cw / 2 + pw / 2 - 30, rotation: -4, fill: linear(160, panel, mix(panel, '#000000', 0.32)), shadow: { color: '#00000088', blur: 40, x: 10, y: 0 } }));
      const w = pw - s.mx * 1.6;
      const k = pill(env, 'Step by step', { size: 62, x: s.left, y: -env.ch * 0.3, fill: hi, align: 'left' });
      const a = words(env, 'How to edit', { size: 120, color: on, outline: null, shadow: false, maxWidth: w, x: s.left, y: -env.ch * 0.1, align: 'left', face });
      const b = words(env, '10× faster', { size: 200, color: hi, outline: '#0b0b0f', maxWidth: w, x: s.left, y: a.transform.y + hOf(a) * 0.5 + 130, align: 'left', face });
      const ph = env.ch * 0.9;
      out.push(k, a, b, person(env, { width: ph * 0.78, height: ph, x: -env.cw / 2 + pw + ph * 0.18, y: env.ch / 2 - ph / 2 }));
      return out;
    },
  }),

  // The frame with a ring around the detail and an arrow from the words.
  thumb({
    id: 'thumb-circle',
    name: 'Circle & Arrow',
    tags: ['thumbnail', 'look', 'detail', 'circle', 'arrow', 'wait for it', 'did you notice'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const red = '#ff2d3d';
      const out: Clip[] = [background(env), shade(env, 'all', 0.4)];
      const rx = env.portrait ? 0 : env.cw * 0.18;
      const ry = env.portrait ? env.ch * 0.12 : env.ch * 0.08;
      const rw = env.portrait ? env.cw * 0.6 : env.ch * 0.62;
      out.push(ring({ w: rw, h: rw * 0.86, x: rx, y: ry, color: red }));
      const t = words(env, 'Did you see that?', { size: env.portrait ? 120 : 130, color: '#111318', box: '#ffffff', maxWidth: env.portrait ? env.cw - s.mx * 2 : env.cw * 0.5, x: env.portrait ? 0 : s.left, y: env.portrait ? s.top + 110 : s.top + 90, align: env.portrait ? 'center' : 'left', rotation: -2, lines: 2 });
      out.push(t);
      out.push(arrow({ size: env.portrait ? 280 : 320, x: env.portrait ? -env.cw * 0.18 : rx - rw * 0.75, y: env.portrait ? ry - rw * 0.6 : ry - env.ch * 0.06, rotation: env.portrait ? 70 : 18, color: red }));
      out.push(emoji('👀', { size: env.portrait ? 170 : 170, x: env.portrait ? env.cw * 0.3 : s.right - 90, y: env.portrait ? env.ch * 0.38 : s.bottom - 80, rotation: 10 }));
      void hi;
      return out;
    },
  }),

  // Huge words behind the person: depth, the modern way.
  thumb({
    id: 'thumb-behind',
    name: 'Words Behind',
    tags: ['thumbnail', 'depth', 'text behind', 'challenge', 'money', 'bold', 'modern'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [background(env), shade(env, 'all', 0.55)];
      const big = words(env, '$10,000', { size: env.portrait ? 300 : 360, color: hi, outline: null, glow: alpha(hi, 0.6), maxWidth: env.cw - s.mx * 2, x: 0, y: env.portrait ? -env.ch * 0.22 : -env.ch * 0.12, face });
      out.push(big);
      const ph = env.portrait ? env.ch * 0.62 : env.ch * 0.92;
      out.push(person(env, { width: ph * 0.8, height: ph, x: 0, y: env.ch / 2 - ph / 2 }));
      out.push(pill(env, 'Last to leave wins', { size: env.portrait ? 84 : 76, x: 0, y: s.bottom - 40, fill: '#ffffff' }));
      return out;
    },
  }),

  // Two people for interviews and podcasts, the episode in the middle.
  thumb({
    id: 'thumb-podcast',
    name: 'Podcast Duo',
    tags: ['thumbnail', 'podcast', 'interview', 'guest', 'episode', 'talk show'],
    build: (env) => {
      const s = safe(env);
      const c = env.palette;
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [
        makeShape('rect', { name: 'Backdrop', duration: D, width: env.cw, height: env.ch, fill: radial(mix(c.primary, '#000000', 0.25), mix(c.bg, '#000000', 0.55)) }),
        makeShape('ellipse', { name: 'Glow', duration: D, width: env.cw * 0.9, height: env.ch * 0.9, fill: radial(alpha(hi, 0.35), alpha(hi, 0)) }),
      ];
      if (env.portrait) {
        const ph = env.ch * 0.36;
        out.push(person(env, { name: 'Host', width: ph * 0.85, height: ph, x: -env.cw * 0.2, y: env.ch / 2 - ph / 2 }), person(env, { name: 'Guest', width: ph * 0.85, height: ph, x: env.cw * 0.22, y: env.ch / 2 - ph / 2 - 40, flip: true }));
        out.push(pill(env, 'Ep. 42', { size: 90, x: 0, y: s.top + 90, fill: hi }));
        out.push(words(env, 'Why we quit our jobs', { size: 150, color: '#ffffff', maxWidth: env.cw - s.mx * 2, x: 0, y: -env.ch * 0.18, face, lines: 2 }));
        out.push(emoji('🎙️', { size: 160, x: 0, y: env.ch * 0.08 }));
        return out;
      }
      const ph = env.ch * 0.86;
      out.push(person(env, { name: 'Host', width: ph * 0.76, height: ph, x: s.left + ph * 0.3, y: env.ch / 2 - ph / 2 }), person(env, { name: 'Guest', width: ph * 0.76, height: ph, x: s.right - ph * 0.3, y: env.ch / 2 - ph / 2, flip: true }));
      const w = env.cw * (env.square ? 0.5 : 0.38);
      out.push(pill(env, 'Ep. 42', { size: 74, x: 0, y: -env.ch * 0.3, fill: hi }));
      out.push(words(env, 'Why we quit our jobs', { size: 120, color: '#ffffff', maxWidth: w, x: 0, y: -env.ch * 0.02, face, lines: 3 }));
      out.push(emoji('🎙️', { size: 150, x: 0, y: env.ch * 0.33 }));
      return out;
    },
  }),

  // A product on a studio backdrop with a verdict and a price tag.
  thumb({
    id: 'thumb-review',
    name: 'Product Review',
    tags: ['thumbnail', 'review', 'product', 'unboxing', 'tech', 'worth it'],
    build: (env) => {
      const s = safe(env);
      const c = env.palette;
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [makeShape('rect', { name: 'Studio', duration: D, width: env.cw, height: env.ch, fill: linear(160, mix(c.bg2, '#ffffff', 0.08), mix(c.bg, '#000000', 0.3)) })];
      const size = env.portrait ? env.cw * 0.78 : env.ch * 0.72;
      const px = env.portrait ? 0 : env.cw * 0.2;
      const py = env.portrait ? env.ch * 0.1 : env.ch * 0.02;
      out.push(makeShape('ellipse', { name: 'Floor glow', duration: D, width: size * 1.5, height: size * 0.3, x: px, y: py + size * 0.52, fill: radial(alpha('#000000', 0.55), alpha('#000000', 0)) }));
      out.push(photo(env, { name: 'Product', width: size, height: size, x: px, y: py, radius: size * 0.08, rotation: env.portrait ? 0 : 4, border: '#ffffff' }));
      if (env.portrait) {
        out.push(words(env, 'Honest review', { size: 150, color: '#ffffff', maxWidth: env.cw - s.mx * 2, x: 0, y: s.top + 120, face }));
        out.push(...stars(4, { size: 100, x: -2.2 * 110, y: s.top + 290, gap: 110 }));
        out.push(pill(env, '$299', { size: 110, x: env.cw * 0.22, y: py + size * 0.42, fill: hi, rotation: -8 }));
        return out;
      }
      const w = env.cw * 0.44;
      const a = words(env, 'Honest', { size: 150, color: '#ffffff', maxWidth: w, x: s.left, y: -env.ch * 0.2, align: 'left', face });
      const b = words(env, 'review', { size: 190, color: hi, maxWidth: w, x: s.left, y: a.transform.y + hOf(a) * 0.5 + 110, align: 'left', face });
      out.push(a, b, ...stars(4, { size: 84, x: s.left + 50, y: b.transform.y + hOf(b) * 0.5 + 95, gap: 100 }));
      out.push(pill(env, '$299', { size: 100, x: px + size * 0.42, y: py - size * 0.42, fill: hi, rotation: 8 }));
      return out;
    },
  }),

  // A question mark behind the person and a boxed question.
  thumb({
    id: 'thumb-question',
    name: 'Big Question',
    tags: ['thumbnail', 'question', 'worth it', 'should you', 'explained', 'debate'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const face = punch(env);
      const out: Clip[] = [background(env), shade(env, 'all', 0.6)];
      out.push(words(env, '?', { size: env.portrait ? 900 : env.ch * 1.1, color: alpha(hi, 0.9), outline: null, shadow: false, maxWidth: env.cw, x: env.portrait ? 0 : env.cw * 0.2, y: env.portrait ? -env.ch * 0.1 : -env.ch * 0.02, face, rotation: 10 }));
      const ph = env.portrait ? env.ch * 0.56 : env.ch * 0.9;
      out.push(person(env, { width: ph * 0.8, height: ph, x: env.portrait ? 0 : env.cw * 0.2, y: env.ch / 2 - ph / 2 }));
      if (env.portrait) out.push(words(env, 'Is it worth it?', { size: 130, color: '#111318', box: '#ffffff', maxWidth: env.cw - s.mx * 2, x: 0, y: s.top + 110, face, rotation: -2 }));
      else {
        const w = env.cw * 0.42;
        const a = words(env, 'Is it', { size: 150, color: '#ffffff', maxWidth: w, x: s.left, y: -env.ch * 0.12, align: 'left', face });
        out.push(a, words(env, 'worth it?', { size: 170, color: '#111318', box: hi, maxWidth: w, x: s.left, y: a.transform.y + hOf(a) * 0.5 + 115, align: 'left', face, rotation: -2 }));
      }
      return out;
    },
  }),

  // Food or recipes: the dish full frame, a clean card with the dish and a time pill.
  thumb({
    id: 'thumb-recipe',
    name: 'Quick Recipe',
    tags: ['thumbnail', 'recipe', 'food', 'cooking', 'kitchen', 'easy'],
    build: (env) => {
      const s = safe(env);
      const c = env.palette;
      const hi = pop(env);
      const face = punch(env);
      const card = c.dark ? '#ffffff' : c.surface;
      const out: Clip[] = [background(env), shade(env, 'bottom', 0.45)];
      const w = env.portrait ? env.cw - s.mx * 2 : env.cw * 0.42;
      const x = env.portrait ? 0 : s.left;
      const y = env.portrait ? env.ch * 0.26 : env.ch * 0.14;
      const t = words(env, '15-minute pasta', { size: env.portrait ? 170 : 170, color: ink(card), box: card, maxWidth: w, x, y, align: env.portrait ? 'center' : 'left', face, lines: 2, rotation: -2 });
      out.push(t);
      out.push(pill(env, '⏱ 15 min', { size: env.portrait ? 96 : 92, x: env.portrait ? 0 : x, y: y - hOf(t) / 2 - (env.portrait ? 90 : 80), fill: hi, align: env.portrait ? 'center' : 'left', rotation: -2 }));
      out.push(emoji('😋', { size: env.portrait ? 170 : 160, x: env.portrait ? env.cw * 0.3 : x + Math.min(w, t.metrics.width) + 40, y: y + 20, rotation: 12 }));
      return out;
    },
  }),

  // Gaming: neon glow words, the player, a rank badge.
  thumb({
    id: 'thumb-gaming',
    name: 'Neon Clutch',
    tags: ['thumbnail', 'gaming', 'neon', 'clutch', 'highlight', 'stream', 'esports'],
    build: (env) => {
      const s = safe(env);
      const c = env.palette;
      const neonA = luminance(c.primary) > 0.15 ? c.primary : '#ff2bd6';
      const neonB = luminance(c.secondary) > 0.15 ? c.secondary : '#22e4ff';
      const face = punch(env);
      const out: Clip[] = [background(env), shade(env, 'all', 0.62), makeShape('rect', { name: 'Colour wash', duration: D, width: env.cw, height: env.ch, fill: linear(135, alpha(neonA, 0.35), alpha(neonB, 0.25)), blendMode: 'screen' })];
      const ph = env.portrait ? env.ch * 0.55 : env.ch * 0.95;
      out.push(person(env, { width: ph * 0.8, height: ph, x: env.portrait ? 0 : s.left + ph * 0.34, y: env.ch / 2 - ph / 2, outline: neonB }));
      const w = env.portrait ? env.cw - s.mx * 2 : env.cw * 0.5;
      const x = env.portrait ? 0 : s.right;
      const a = words(env, 'Insane', { size: env.portrait ? 170 : 190, color: '#ffffff', outline: neonA, glow: neonA, maxWidth: w, x, y: env.portrait ? s.top + 140 : -env.ch * 0.14, align: env.portrait ? 'center' : 'right', face, rotation: -4 });
      const b = words(env, 'clutch', { size: env.portrait ? 190 : 220, color: '#ffffff', outline: neonB, glow: neonB, maxWidth: w, x, y: a.transform.y + hOf(a) * 0.5 + (env.portrait ? 120 : 135), align: env.portrait ? 'center' : 'right', face, rotation: -4 });
      out.push(a, b);
      out.push(pill(env, '#1 Victory', { size: env.portrait ? 80 : 72, x: env.portrait ? 0 : s.right, y: b.transform.y + hOf(b) * 0.5 + 80, fill: neonA, align: env.portrait ? 'center' : 'right' }));
      return out;
    },
  }),

  // Clean and cinematic: the frame, a soft fade at the bottom, a calm headline.
  thumb({
    id: 'thumb-cinematic',
    name: 'Cinematic Title',
    tags: ['thumbnail', 'cinematic', 'travel', 'documentary', 'vlog', 'minimal', 'clean'],
    build: (env) => {
      const s = safe(env);
      const hi = pop(env);
      const h = env.fonts.heading;
      const face = { family: h.family, weight: nearestWeight(h.family, 800) };
      const out: Clip[] = [background(env), shade(env, 'bottom', 0.8)];
      const w = env.portrait ? env.cw - s.mx * 2 : env.cw * 0.7;
      const x = env.portrait ? 0 : s.left;
      const align = env.portrait ? 'center' : 'left';
      const title = words(env, '48 hours in Lisbon', { size: env.portrait ? 160 : 150, color: '#ffffff', outline: null, maxWidth: w, x, y: s.bottom - (env.portrait ? 200 : 110), align, face, lines: 2 });
      const kicker = words(env, 'A slow travel film', { size: 54, color: hi, outline: null, shadow: false, maxWidth: w, x, y: title.transform.y - hOf(title) / 2 - 56, align, face: { family: env.fonts.body.family, weight: nearestWeight(env.fonts.body.family, 700) } });
      kicker.text.letterSpacing = 0.18;
      out.push(kicker, title);
      out.push(makeShape('rect', { name: 'Accent', duration: D, width: 120, height: 10, radius: 5, x: env.portrait ? 0 : s.left + 60, y: kicker.transform.y - 60, fill: hi }));
      return out;
    },
  }),

  // Breaking news: tag and a white headline bar over the footage.
  thumb({
    id: 'thumb-breaking',
    name: 'Breaking News',
    tags: ['thumbnail', 'news', 'breaking', 'update', 'announcement', 'drama'],
    build: (env) => {
      const s = safe(env);
      const face = punch(env);
      const red = '#e11d2e';
      const out: Clip[] = [background(env), shade(env, 'bottom', 0.6)];
      const w = env.cw - s.mx * 2;
      const head = words(env, 'They finally said it', { size: env.portrait ? 120 : 130, color: '#111318', box: '#ffffff', maxWidth: w, x: env.portrait ? 0 : s.left, y: s.bottom - (env.portrait ? 160 : 90), align: env.portrait ? 'center' : 'left', face, lines: 2 });
      const tag = pill(env, 'Breaking', { size: env.portrait ? 90 : 80, x: env.portrait ? 0 : s.left, y: head.transform.y - hOf(head) / 2 - (env.portrait ? 90 : 80), fill: red, align: env.portrait ? 'center' : 'left' });
      out.push(tag, head, emoji('⚡', { size: env.portrait ? 150 : 140, x: env.portrait ? env.cw * 0.32 : s.right - 70, y: env.portrait ? s.top + 120 : s.top + 70, rotation: 12 }));
      return out;
    },
  }),
];

export default templates;
