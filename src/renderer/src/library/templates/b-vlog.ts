import { makeAdjustment, makeEffect, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, hrow, label, lay, mix, pill, popOnDark, scrim, setXY, strong, textOn, till, vstack, type Pill, type Txt } from './_lib/b-kit';
import { chance, pick } from './_lib/kit';

const shadow = { color: alpha('#000000', 0.5), blur: 18, x: 0, y: 4 };

/** A pill with an emoji sticker tucked over its left end. */
function iconPill(env: TemplateEnv, icon: string, text: string, o: { size: number; fill: string; color: string; start: number; d: number }): { p: Pill; icon: Clip; w: number; h: number; place: (x: number, y: number) => void } {
  const p = pill(env, text, { size: o.size, fill: o.fill, color: o.color, padX: o.size * 1.45, start: o.start, duration: till(o.d, o.start), weight: 600, anim: A('pop-in', 0.45, 'pop-out', 0.3) });
  const is = Math.round(o.size * 1.5);
  const ic = makeSticker(icon, { name: 'Icon', start: o.start + 0.1, duration: till(o.d, o.start + 0.1), size: is, rotation: -8, anim: A('twist-pop-in', 0.5, 'pop-out', 0.3) });
  const place = (x: number, y: number): void => {
    setXY(p.clips, x, y);
    // Shift the label right to make room for the icon.
    p.text.transform.x = Math.round(x + o.size * 0.3);
    setXY([ic], x - p.w / 2 + o.size * 0.75, y - 2);
  };
  return { p, icon: ic, w: p.w, h: p.h, place };
}

/** Viewfinder corner brackets around a box. */
function corners(w: number, h: number, len: number, thick: number, color: string, start: number, d: number): ShapeClip[] {
  const out: ShapeClip[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = (sx * w) / 2;
      const cy = (sy * h) / 2;
      out.push(makeShape('rect', { name: 'Corner', start, duration: till(d, start), width: len, height: thick, x: cx - (sx * len) / 2 + (sx * thick) / 2, y: cy, fill: color, anim: A('fade-in', 0.4, 'fade-out', 0.35) }));
      out.push(makeShape('rect', { name: 'Corner', start, duration: till(d, start), width: thick, height: len, x: cx, y: cy - (sy * len) / 2 + (sy * thick) / 2, fill: color, anim: A('fade-in', 0.4, 'fade-out', 0.35) }));
    }
  }
  return out;
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Day in my life opener
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-vlog-day-in-life',
    name: 'Day in My Life Opener',
    category: 'vlog',
    tags: ['vlog', 'day in my life', 'opener', 'lifestyle', 'morning', 'routine', 'diary'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const accent = popOnDark(env);
      const centered = chance(r, 0.5);
      const media = makeSlot({ name: 'Morning clip', width: L.cw, height: L.ch, duration: d, filter: { id: pick(r, ['golden-hour', 'dreamy', 'instant-photo']), intensity: 0.5 }, anim: A('fade-in', 0.6, undefined, 0, 'slow-zoom', 10) });
      const shade = scrim(env, centered ? 'full' : 'bottom', { duration: d, strength: centered ? 0.35 : 0.7, extent: 0.6, anim: A('fade-in', 0.6) });
      const recS = L.tall ? 84 : 68;
      const rec = makeSticker('rec-indicator', { name: 'REC', start: 0.2, duration: till(d, 0.2), size: recS, x: -L.s.hw + (recS * 2.4) / 2, y: -L.s.hh + recS / 2, anim: A('fade-in', 0.3, 'fade-out', 0.3) });
      const date = label(env, 'Tue · March 3', { start: 0.3, duration: till(d, 0.3), size: L.tall ? 32 : 28, color: '#ffffff', track: 0.2, style: { shadow }, anim: A('fade-in', 0.5, 'fade-out', 0.3) });
      date.transform.y = Math.round(-L.s.hh + recS / 2);
      date.transform.x = Math.round(L.s.hw - date.metrics.width / 2);

      const w = L.wide ? 1300 : L.s.w;
      const title = H(env, 'a day in my life', { name: 'Title', start: 0.6, duration: till(d, 0.6), size: L.tall ? 168 : L.wide ? 160 : 128, color: '#ffffff', maxWidth: w, maxLines: 3, style: { align: centered ? 'center' : 'left', shadow }, textAnim: { in: { id: pick(r, ['char-drop-in', 'word-spring-in', 'char-pop-in']), duration: 1.0 } }, anim: A(undefined, 0, 'fade-out', 0.4) });
      const size = L.tall ? 44 : L.wide ? 38 : 32;
      const chipFill = alpha('#ffffff', 0.92);
      const time = iconPill(env, 'emoji-2600-fe0f', '6:30 AM', { size, fill: chipFill, color: '#16181d', start: 1.4, d });
      const place = iconPill(env, 'emoji-1f4cd', 'Brooklyn, NY', { size, fill: accent, color: textOn(env, accent), start: 1.6, d });
      const chipH = Math.max(time.h, place.h);
      const rows = [
        { clips: [title], h: title.metrics.height, gap: 36 },
        { clips: [], h: chipH },
      ];
      if (centered) vstack(rows, { centerY: L.tall ? 60 : 30 });
      else vstack(rows, { bottom: L.s.hh });
      const cy = title.transform.y + title.metrics.height / 2 + 36 + chipH / 2;
      const gap = 24;
      const total = time.w + gap + place.w;
      const left = centered ? -total / 2 : -L.s.hw + size * 0.3;
      if (!centered) alignLeft(title, -L.s.hw);
      time.place(left + time.w / 2, cy);
      place.place(left + time.w + gap + place.w / 2, cy);
      void c;
      void hrow;
      return [media, shade, rec, date, title, ...time.p.clips, time.icon, ...place.p.clips, place.icon];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. Location stamp
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-vlog-location-stamp',
    name: 'Location Stamp',
    category: 'vlog',
    tags: ['location', 'travel', 'city', 'coordinates', 'vlog', 'destination', 'viewfinder'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const d = env.duration;
      const r = env.rng;
      const accent = popOnDark(env, ['secondary', 'accent', 'primary']);
      const media = makeSlot({ name: 'City footage', width: L.cw, height: L.ch, duration: d, anim: A('fade-in', 0.5, undefined, 0, 'slow-zoom', 10) });
      const shade = scrim(env, 'full', { duration: d, strength: 0.32, anim: A('fade-in', 0.6) });
      const thick = L.tall ? 6 : 5;
      const len = L.tall ? 90 : 70;
      const finder = corners(L.cw - L.s.mx * 1.2, L.ch - L.s.my * 1.2, len, thick, alpha('#ffffff', 0.9), 0.2, d);

      const size = L.wide ? 240 : L.tall ? 210 : 170;
      const pin = makeSticker('emoji-1f4cd', { name: 'Pin', start: 0.4, duration: till(d, 0.4), size: Math.round(size * 0.55), anim: A('drop-in', 0.8, 'pop-out', 0.3) });
      const city = H(env, 'Kyoto', { name: 'City', start: 0.7, duration: till(d, 0.7), size, color: '#ffffff', maxWidth: L.s.w, maxLines: 1, style: { uppercase: true, letterSpacing: 0.14, shadow }, textAnim: { in: { id: 'tracking-in', duration: 1.2 } }, anim: A(undefined, 0, 'fade-out', 0.4) });
      const country = label(env, 'Japan', { start: 1.3, duration: till(d, 1.3), size: L.tall ? 40 : 34, color: accent, track: 0.5, style: { shadow }, anim: A('fade-in', 0.6, 'fade-out', 0.35) });
      const coords = B(env, '35.0116° N   135.7681° E', { name: 'Coordinates', start: 1.7, duration: till(d, 1.7), size: L.tall ? 34 : 30, color: alpha('#ffffff', 0.85), style: { letterSpacing: 0.12, shadow }, anim: A('fade-in', 0.6, 'fade-out', 0.35) });
      const stamp = pill(env, '04 · 11 · 2026', { size: L.tall ? 30 : 26, fill: alpha('#000000', 0.35), color: '#ffffff', stroke: { color: alpha('#ffffff', 0.6), width: 2 }, upper: true, track: 0.16, start: 2.0, duration: till(d, 2.0), anim: A('pop-soft-in', 0.45, 'fade-out', 0.35) });
      vstack(
        [
          { clips: [pin], h: Math.round(size * 0.55), gap: 10 },
          { clips: [city], h: city.metrics.height, gap: 14 },
          { clips: [country], h: country.metrics.height, gap: 28 },
          { clips: [coords], h: coords.metrics.height, gap: 30 },
          { clips: stamp.clips, h: stamp.h },
        ],
        { centerY: 0 },
      );
      const rules = [-1, 1].map((s) =>
        makeShape('rect', { name: 'Rule', start: 1.5, duration: till(d, 1.5), width: L.tall ? 120 : 100, height: 3, x: s * (country.metrics.inkWidth / 2 + 40 + (L.tall ? 60 : 50)), y: country.transform.y, fill: alpha(accent, 0.9), anim: A(s < 0 ? 'wipe-left-in' : 'wipe-right-in', 0.6, 'fade-out', 0.35) }),
      );
      void r;
      return [media, shade, ...finder, pin, city, country, ...rules, coords, ...stamp.clips];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Chapter card over blurred footage
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-vlog-chapter',
    name: 'Vlog Chapter Card',
    category: 'vlog',
    tags: ['chapter', 'part', 'vlog', 'road trip', 'episode', 'section', 'blur'],
    duration: 5,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const accent = popOnDark(env);
      const media = makeSlot({ name: 'Footage (blurred)', width: L.cw, height: L.ch, duration: d, effects: [makeEffect('gaussian-blur', { radius: 28 })], anim: A('fade-in', 0.4, undefined, 0, 'slow-zoom', 9) });
      const tint = makeShape('rect', { name: 'Tint', duration: d, width: L.cw, height: L.ch, fill: alpha(mix(c.dark ? c.bg : c.primary, '#000000', c.dark ? 0.4 : 0.62), 0.58), anim: A('fade-in', 0.5) });
      const big = L.tall ? 420 : L.wide ? 360 : 300;
      const heavy = ['Anton', 'Archivo Black', 'Bangers', 'Shrikhand', 'Abril Fatface', 'Righteous', 'Bebas Neue'].includes(env.fonts.heading.family) || env.fonts.heading.weight >= 700;
      const hollow = heavy && chance(r, 0.6);
      const num = H(env, '02', { name: 'Part number', start: 0.2, duration: till(d, 0.2), size: big, color: hollow ? alpha('#ffffff', 0) : accent, style: { letterSpacing: 0.02, uppercase: false, lineHeight: 0.92, ...(hollow ? { stroke: { color: '#ffffff', width: Math.round(big * 0.016) } } : {}) }, anim: A('zoom-blur-in', 0.7, 'zoom-soft-out', 0.4) });
      const part = label(env, 'Part two', { start: 0.6, duration: till(d, 0.6), size: L.tall ? 36 : 30, color: '#ffffff', track: 0.4, textAnim: { in: { id: 'tracking-in', duration: 0.9 } }, anim: A(undefined, 0, 'fade-out', 0.35) });
      const title = H(env, 'The road north', { name: 'Chapter title', start: 0.8, duration: till(d, 0.8), size: L.tall ? 128 : L.wide ? 120 : 96, color: '#ffffff', maxWidth: L.wide ? 1300 : L.s.w, maxLines: 2, style: { shadow }, textAnim: { in: { id: 'word-blur-in', duration: 0.9 } }, anim: A(undefined, 0, 'fade-out', 0.35) });
      const meta = pill(env, 'Day 3 · 214 km', { size: L.tall ? 32 : 28, fill: alpha('#ffffff', 0.16), color: '#ffffff', stroke: { color: alpha('#ffffff', 0.4), width: 2 }, start: 1.3, duration: till(d, 1.3), anim: A('pop-soft-in', 0.45, 'fade-out', 0.35) });
      vstack(
        [
          { clips: [num], h: num.metrics.height * 0.86, gap: L.tall ? 30 : 18 },
          { clips: [part], h: part.metrics.height, gap: 14 },
          { clips: [title], h: title.metrics.height, gap: 30 },
          { clips: meta.clips, h: meta.h },
        ],
        { centerY: 0 },
      );
      return [media, tint, num, part, title, ...meta.clips];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Cinematic letterbox title
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-vlog-cinematic-letterbox',
    name: 'Cinematic Letterbox Title',
    category: 'vlog',
    tags: ['cinematic', 'letterbox', 'film', 'title', 'travel', 'moody', 'widescreen'],
    duration: 7,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const d = env.duration;
      const r = env.rng;
      const accent = popOnDark(env, ['secondary', 'accent', 'primary']);
      const grade = pick(r, ['teal-orange', 'cold-thriller', 'warm-blockbuster', 'moody-blue'] as const);
      const media = makeSlot({ name: 'Footage', width: L.cw, height: L.ch, duration: d, filter: { id: grade, intensity: 0.65 }, anim: A('fade-in', 0.8, 'fade-out', 0.5, 'slow-zoom', 12) });
      const look = makeAdjustment({ name: 'Film look', duration: d, effects: [makeEffect('film-grain', { amount: 0.2, size: 1.4, chroma: 0.1 }), makeEffect('vignette', { amount: 0.45, size: 0.5, feather: 0.6, roundness: 0.3, color: '#000000' })] });

      const winH = L.wide ? L.cw / 2.39 : L.square ? L.cw / 2 : L.tall ? L.cw : L.cw * (9 / 16);
      const barH = Math.round((L.ch - winH) / 2);
      const bars = [-1, 1].map((s) =>
        makeShape('rect', { name: s < 0 ? 'Top bar' : 'Bottom bar', start: 0.2, duration: till(d, 0.2), width: L.cw, height: barH + 2, y: s * (L.hh - barH / 2), fill: '#000000', anim: A(s < 0 ? 'slide-down-in' : 'slide-up-in', 1.0, s < 0 ? 'slide-up-out' : 'slide-down-out', 0.6) }),
      );
      const inBars = barH > 240;
      const titleSize = L.wide ? 104 : L.tall ? 104 : L.square ? 84 : 92;
      const title = H(env, 'The Quiet Hours', { name: 'Title', start: 1.1, duration: till(d, 1.1), size: titleSize, color: '#ffffff', maxWidth: L.s.w, maxLines: 1, style: { uppercase: true, letterSpacing: 0.22, shadow: inBars ? undefined : shadow }, textAnim: { in: { id: 'tracking-expand-in', duration: 1.6 } }, anim: A(undefined, 0, 'blur-out', 0.6) });
      const by = B(env, 'a film by Lena Park', { name: 'Credit', start: 1.9, duration: till(d, 1.9), size: L.tall ? 36 : 30, color: alpha('#ffffff', 0.8), style: { italic: true, letterSpacing: 0.06 }, anim: A('fade-in', 0.8, 'fade-out', 0.5) });
      const chapter = label(env, 'Chapter one', { start: 1.5, duration: till(d, 1.5), size: inBars ? 30 : Math.min(26, Math.round(barH * 0.22)), color: accent, track: 0.5, anim: A('fade-in', 0.8, 'fade-out', 0.5) });
      chapter.transform.y = Math.round(inBars ? L.hh - barH * 0.6 : -L.hh + barH / 2);
      const rule = makeShape('rect', { name: 'Rule', start: 1.6, duration: till(d, 1.6), width: 120, height: 2, fill: alpha(accent, 0.9), anim: A('wipe-center-in', 0.7, 'fade-out', 0.4) });
      const rows = [
        { clips: [title], h: title.metrics.height, gap: 22 },
        { clips: [rule], h: 2, gap: 22 },
        { clips: [by], h: by.metrics.height },
      ];
      // Tall frames: title in the top bar (the bottom of vertical video is covered by platform UI).
      vstack(rows, { centerY: inBars ? -L.hh + barH * 0.58 : 0 });
      void strong;
      return [media, look, ...bars, chapter, title, rule, by];
    },
  },
];

export default templates;
