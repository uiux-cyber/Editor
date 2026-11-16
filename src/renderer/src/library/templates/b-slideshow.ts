import { kf, makeAdjustment, makeEffect, makeShape, makeSlot } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, backdrop, column, label, lay, mix, pItem, pill, popOnDark, scrim, setXY, tItem, textOn, till, vivid, vstack, type Txt } from './_lib/b-kit';
import { chance, pick, range } from './_lib/kit';

/** Start times of `n` equal segments between `lead` and `d - tail`. */
function segments(d: number, n: number, lead = 0, tail = 0): { starts: number[]; seg: number } {
  const seg = (d - lead - tail) / n;
  return { starts: Array.from({ length: n }, (_, i) => lead + i * seg), seg };
}

const ROT = (deg: number): number => (deg * Math.PI) / 180;

/** Rotates layer offsets around a centre and adds the angle to each layer. */
function rotateAround(clips: { transform: { x: number; y: number; rotation: number } }[], cx: number, cy: number, deg: number): void {
  const a = ROT(deg);
  for (const c of clips) {
    const dx = c.transform.x - cx;
    const dy = c.transform.y - cy;
    c.transform.x = Math.round(cx + dx * Math.cos(a) - dy * Math.sin(a));
    c.transform.y = Math.round(cy + dx * Math.sin(a) + dy * Math.cos(a));
    c.transform.rotation += deg;
  }
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Story-style swipe slideshow
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-swipe-story',
    name: 'Swipe Story',
    category: 'slideshow',
    tags: ['story', 'slideshow', 'swipe', 'progress', 'travel', 'photos', 'reel'],
    duration: 12,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const d = env.duration;
      const r = env.rng;
      const n = 4;
      const { starts, seg } = segments(d, n);
      const accent = popOnDark(env);
      const dir = pick(r, ['left', 'up'] as const);
      const captions = ['Sunrise at the lake', 'Coffee before the climb', 'Above the clouds', 'Worth every step'];

      const slots = starts.map((s, i) =>
        makeSlot({
          name: `Slide ${i + 1}`,
          start: s,
          duration: i === n - 1 ? till(d, s) : Math.min(seg + 0.7, d - s),
          width: L.cw,
          height: L.ch,
          anim: i === 0 ? A('fade-in', 0.5, undefined, 0, 'slow-zoom', seg * 2.4) : A(dir === 'left' ? 'fly-left-in' : 'fly-up-in', 0.7, i === n - 1 ? 'fade-out' : undefined, 0.5, 'slow-zoom', seg * 2.4),
        }),
      );
      const shade = scrim(env, 'bottom', { duration: d, strength: 0.75, extent: 0.45 });
      const topShade = scrim(env, 'top', { duration: d, strength: 0.45, extent: 0.22 });

      const gap = 10;
      const barW = (L.s.w - gap * (n - 1)) / n;
      const barY = -L.s.hh + (L.portrait ? -40 : -30);
      const bars: Clip[] = [];
      starts.forEach((s, i) => {
        const x = -L.s.hw + barW / 2 + i * (barW + gap);
        bars.push(makeShape('rect', { name: `Progress ${i + 1} track`, start: 0.1, duration: till(d, 0.1), width: Math.round(barW), height: 8, radius: 4, x, y: barY, fill: alpha('#ffffff', 0.35), anim: A('fade-in', 0.4, 'fade-out', 0.4) }));
        bars.push(makeShape('rect', { name: `Progress ${i + 1}`, start: s, duration: till(d, s), width: Math.round(barW), height: 8, radius: 4, x, y: barY, fill: '#ffffff', anim: A('wipe-right-in', Math.max(0.3, seg - 0.05), 'fade-out', 0.4) }));
      });

      const handle = pill(env, '@wanderlog', { size: L.wide ? 30 : 32, fill: alpha('#000000', 0.35), color: '#ffffff', start: 0.4, duration: till(d, 0.4), anim: A('fade-in', 0.5, 'fade-out', 0.4) });
      setXY(handle.clips, -L.s.hw + handle.w / 2, barY + 40 + handle.h / 2);

      const left = -L.s.hw;
      const capW = L.wide ? L.s.w * 0.6 : L.s.w;
      const caps: Txt[] = [];
      const nums: Txt[] = [];
      starts.forEach((s, i) => {
        const end = i === n - 1 ? d : s + seg;
        const num = label(env, `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, { start: s + 0.35, duration: end - s - 0.35, size: L.wide ? 28 : 30, color: accent, track: 0.2, style: { align: 'left' }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.3) });
        const cap = H(env, captions[i], { name: `Caption ${i + 1}`, start: s + 0.45, duration: end - s - 0.45, size: L.tall ? 104 : L.wide ? 96 : 84, color: '#ffffff', maxWidth: capW, maxLines: 2, style: { align: 'left' }, textAnim: { in: { id: 'word-rise-in', duration: 0.7 } }, anim: A(undefined, 0, 'fade-out', 0.3) });
        vstack([{ clips: [num], h: num.metrics.height, gap: 16 }, { clips: [cap], h: cap.metrics.height }], { bottom: L.s.hh });
        alignLeft(num, left);
        alignLeft(cap, left);
        caps.push(cap);
        nums.push(num);
      });

      return [...slots, shade, topShade, ...bars, ...handle.clips, ...nums, ...caps];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. Polaroid stack
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-polaroid-stack',
    name: 'Polaroid Stack',
    category: 'slideshow',
    tags: ['polaroid', 'collage', 'memories', 'scrapbook', 'photos', 'instant', 'summer'],
    duration: 10,
    poster: 0.72,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['paper', 'dots', 'linear'] as const), { duration: d });
      const n = 4;
      const { starts } = segments(d * 0.62, n, 0.9);
      const out = A(undefined, 0, 'fade-out', 0.5);
      const pop = vivid(env, c.bg);

      const title = H(env, 'Our summer, in four frames', { name: 'Title', start: 0.2, duration: till(d, 0.2), size: L.tall ? 92 : L.wide ? 76 : 64, maxWidth: L.wide ? 1300 : L.s.w, maxLines: 2, textAnim: { in: { id: 'word-rise-in', duration: 0.8 } }, anim: out });
      const sub = label(env, 'July 2026 · Amalfi Coast', { start: 0.5, duration: till(d, 0.5), size: L.tall ? 30 : 26, color: pop, track: 0.2, anim: A('fade-in', 0.6, 'fade-out', 0.4) });
      const titleH = vstack([{ clips: [title], h: title.metrics.height, gap: 14 }, { clips: [sub], h: sub.metrics.height }], { top: -L.s.hh });

      const areaTop = -L.s.hh + titleH + (L.tall ? 60 : 40);
      const areaBottom = L.portrait ? L.s.hh : L.hh - 40;
      const areaH = areaBottom - areaTop;
      const areaCY = (areaTop + areaBottom) / 2;
      const pw = Math.round(L.wide ? Math.min(460, areaH / 1.2) : L.tall ? 580 : L.mid ? 440 : Math.min(400, areaH / 1.22));
      const m = Math.round(pw * 0.06);
      const ph = Math.round(pw + m + pw * 0.2);
      const photo = pw - m * 2;
      const captions = ['First swim', 'Lemon groves', 'Golden hour', 'Last night'];

      // Keep every (slightly rotated) print inside the area below the title.
      const sy = Math.max(0, (areaH - ph) / 2 - 30);
      const sx = Math.max(0, L.s.hw - pw / 2 - 10);
      const positions: [number, number][] = L.wide
        ? [-1.5, -0.5, 0.5, 1.5].map((k) => [k * pw * 0.86 + range(r, -30, 30), areaCY + range(r, -1, 1) * Math.min(50, sy)])
        : [
            [-Math.min(sx, pw * 0.36), areaCY - sy],
            [Math.min(sx, pw * 0.38), areaCY - sy / 3],
            [-Math.min(sx, pw * 0.3), areaCY + sy / 3],
            [Math.min(sx, pw * 0.34), areaCY + sy],
          ];
      const out2: Clip[] = [];
      positions.forEach(([px, py], i) => {
        const s = starts[i];
        const deg = (i % 2 === 0 ? -1 : 1) * range(r, 3, 8);
        const dur = till(d, s);
        const frame = makeShape('rect', { name: `Polaroid ${i + 1}`, start: s, duration: dur, width: pw, height: ph, radius: 6, x: px, y: py, fill: '#fbfaf6', shadow: { color: alpha('#000000', 0.32), blur: 30, x: 0, y: 14 }, anim: out });
        const slot = makeSlot({ name: `Photo ${i + 1}`, start: s, duration: dur, width: photo, height: photo, x: px, y: py - ph / 2 + m + photo / 2, filter: { id: 'instant-photo', intensity: 0.7 }, anim: out });
        const cap = H(env, captions[i], { name: `Caption ${i + 1}`, start: s, duration: dur, size: Math.round(pw * 0.085), color: '#2b2a28', maxWidth: photo, maxLines: 1, x: px, y: py + ph / 2 - (ph - photo - m) / 2, style: { uppercase: false, letterSpacing: 0 }, anim: out });
        const tape = makeShape('rect', { name: `Tape ${i + 1}`, start: s, duration: dur, width: Math.round(pw * 0.32), height: Math.round(pw * 0.09), x: px + range(r, -pw * 0.1, pw * 0.1), y: py - ph / 2 + 4, rotation: range(r, -8, 8), fill: alpha(mix(c.secondary, '#ffffff', 0.4), 0.72), anim: out });
        const group = [frame, slot, cap, tape];
        rotateAround(group, px, py, deg);
        const drop = L.ch * 0.9;
        for (const g of group) {
          const y = g.transform.y;
          const x = g.transform.x;
          const sx = i % 2 === 0 ? -120 : 120;
          g.keyframes = {
            y: [kf(0, y - drop, 'easeOutCubic'), kf(0.7, y + 10, 'easeInOut'), kf(0.85, y, 'easeInOut')],
            x: [kf(0, x + sx, 'easeOutCubic'), kf(0.7, x, 'easeInOut')],
            rotation: [kf(0, g.transform.rotation - deg * 2.5, 'easeOutCubic'), kf(0.75, g.transform.rotation, 'easeInOut')],
          };
        }
        out2.push(...group);
      });

      return [bg, title, sub, ...out2];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Gallery grid with a title card
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-grid-gallery',
    name: 'Gallery Grid',
    category: 'slideshow',
    tags: ['grid', 'gallery', 'mosaic', 'photos', 'collage', 'memories', 'recap'],
    duration: 8,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, 'solid', { duration: d });
      const cols = L.wide ? 3 : 2;
      const rows = L.wide ? 2 : L.square ? 2 : 3;
      const g = L.wide ? 18 : 14;
      const cellW = (L.cw - g * (cols + 1)) / cols;
      const cellH = (L.ch - g * (rows + 1)) / rows;
      const order = Array.from({ length: cols * rows }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const ins = ['zoom-soft-in', 'pop-soft-in', 'focus-in'] as const;
      const inId = pick(r, ins);
      const slots: ShapeClip[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const k = row * cols + col;
          const s = 0.15 + order.indexOf(k) * 0.16;
          slots.push(
            makeSlot({
              name: `Photo ${k + 1}`,
              start: s,
              duration: till(d, s + order.indexOf(k) * 0.05),
              width: Math.round(cellW),
              height: Math.round(cellH),
              radius: 22,
              x: -L.hw + g + cellW / 2 + col * (cellW + g),
              y: -L.hh + g + cellH / 2 + row * (cellH + g),
              anim: A(inId, 0.55, 'zoom-soft-out', 0.4, 'slow-zoom', 8 + k),
            }),
          );
        }
      }

      const cardW = L.wide ? 980 : L.s.w - 40;
      const title = H(env, 'Summer Memories', { name: 'Title', start: 1.6, duration: till(d, 1.6), size: L.tall ? 120 : L.wide ? 116 : 88, maxWidth: cardW - 120, maxLines: 2, textAnim: { in: { id: 'char-rise-in', duration: 0.8 } }, anim: A(undefined, 0, 'fade-out', 0.4) });
      const sub = label(env, '2026 · Lisbon · Porto', { start: 2.0, duration: till(d, 2.0), size: L.tall ? 32 : 28, color: vivid(env, c.surface), track: 0.22, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const cardH = Math.round(title.metrics.height + sub.metrics.height + 18 + 110);
      const card = makeShape('rect', { name: 'Title card', start: 1.4, duration: till(d, 1.4), width: cardW, height: cardH, radius: 40, fill: alpha(c.surface, 0.95), shadow: { color: alpha('#000000', 0.35), blur: 40, x: 0, y: 16 }, anim: A('pop-soft-in', 0.5, 'pop-soft-out', 0.4) });
      vstack([{ clips: [title], h: title.metrics.height, gap: 18 }, { clips: [sub], h: sub.metrics.height }], { centerY: 0 });
      void chance;
      return [bg, ...slots, card, title, sub];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Cinematic Ken Burns
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-ken-burns',
    name: 'Cinematic Ken Burns',
    category: 'slideshow',
    tags: ['cinematic', 'ken burns', 'letterbox', 'film', 'travel', 'crossfade', 'documentary'],
    duration: 14,
    poster: 0.2,
    build: (env) => {
      const L = lay(env);
      const d = env.duration;
      const r = env.rng;
      const n = 4;
      const { starts, seg } = segments(d, n);
      const accent = popOnDark(env, ['secondary', 'accent', 'primary']);
      const filmGrade = pick(r, ['teal-orange', 'warm-blockbuster', 'golden-hour', 'faded-film'] as const);

      const slots = starts.map((s, i) =>
        makeSlot({
          name: `Scene ${i + 1}`,
          start: s,
          duration: i === n - 1 ? till(d, s) : Math.min(seg + 1.0, d - s),
          width: L.cw,
          height: L.ch,
          filter: { id: filmGrade, intensity: 0.6 },
          anim: A(i === 0 ? 'fade-in' : 'fade-in', i === 0 ? 1.0 : 1.0, i === n - 1 ? 'fade-out' : undefined, 0.8, 'slow-zoom', seg * 2.2 + 2),
        }),
      );
      const grain = makeAdjustment({ name: 'Film grain', duration: d, effects: [makeEffect('film-grain', { amount: 0.22, size: 1.5, chroma: 0.1 })] });

      const barH = Math.round(L.wide ? (L.ch - L.cw / 2.39) / 2 : L.ch * (L.tall ? 0.17 : 0.1));
      const bars = [-1, 1].map((s) => makeShape('rect', { name: s < 0 ? 'Letterbox top' : 'Letterbox bottom', start: 0, duration: d, width: L.cw, height: barH + 4, y: s * (L.hh - barH / 2 + 2), fill: '#000000', anim: A(s < 0 ? 'wipe-down-in' : 'wipe-up-in', 0.9) }));

      const title = H(env, 'A Weekend in Lisbon', { name: 'Title', start: 0.8, duration: Math.min(seg, d - 0.8) - 0.6, size: L.tall ? 120 : L.wide ? 120 : 96, color: '#ffffff', maxWidth: L.wide ? 1300 : L.s.w, maxLines: 2, style: { shadow: { color: alpha('#000000', 0.5), blur: 24, x: 0, y: 6 } }, textAnim: { in: { id: 'char-blur-in', duration: 1.4 } }, anim: A(undefined, 0, 'blur-out', 0.6) });
      const kicker = label(env, 'A short film', { start: 0.5, duration: Math.min(seg, d - 0.5) - 0.3, size: L.wide ? 28 : 30, color: accent, track: 0.4, textAnim: { in: { id: 'tracking-in', duration: 1.2 } }, anim: A(undefined, 0, 'fade-out', 0.6) });
      vstack([{ clips: [kicker], h: kicker.metrics.height, gap: 22 }, { clips: [title], h: title.metrics.height }], { centerY: 0 });

      const names = ['Alfama at dawn', 'Tram 28', 'Miradouro da Graça', 'Back home'];
      // On vertical video keep captions on the inner part of the bars, clear of platform UI.
      const capY = L.tall ? L.hh - barH * 0.62 : L.hh - barH / 2;
      const caps: Clip[] = [];
      starts.forEach((s, i) => {
        if (i === 0) return;
        const end = i === n - 1 ? d : s + seg;
        const capSize = Math.min(L.wide ? 44 : 48, Math.round(barH * 0.42));
        const cap = B(env, names[i], { name: `Caption ${i + 1}`, start: s + 0.6, duration: end - s - 0.6, size: capSize, color: '#ffffff', maxWidth: L.s.w, maxLines: 1, y: capY, style: { letterSpacing: 0.12, uppercase: true }, anim: A('fade-in', 0.8, 'fade-out', 0.5) });
        caps.push(cap);
      });
      const chap = starts.slice(1).map((s, i) => label(env, `Part ${i + 2}`, { start: s + 0.4, duration: (i + 1 === n - 1 ? d : s + seg) - s - 0.4, size: Math.min(26, Math.round(barH * 0.24)), color: accent, track: 0.3, y: L.tall ? -L.hh + barH * 0.62 : -L.hh + barH / 2, anim: A('fade-in', 0.8, 'fade-out', 0.5) }));

      return [...slots, grain, ...bars, kicker, title, ...chap, ...caps];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 5. Split panels
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-split-panels',
    name: 'Split Panels',
    category: 'slideshow',
    tags: ['panels', 'triptych', 'split', 'collage', 'brand', 'lookbook', 'three photos'],
    duration: 8,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, 'solid', { duration: d });
      const vertical = !L.tall;
      const n = 3;
      const g = 12;
      const pw = vertical ? (L.cw - g * (n - 1)) / n : L.cw;
      const phh = vertical ? L.ch : (L.ch - g * (n - 1)) / n;
      const panels = Array.from({ length: n }, (_, i) => {
        const s = 0.1 + i * 0.3;
        return makeSlot({
          name: `Panel ${i + 1}`,
          start: s,
          duration: till(d, s, (n - 1 - i) * 0.12),
          width: Math.round(pw),
          height: Math.round(phh),
          x: vertical ? -L.hw + pw / 2 + i * (pw + g) : 0,
          y: vertical ? 0 : -L.hh + phh / 2 + i * (phh + g),
          anim: A(vertical ? (i % 2 ? 'mask-up-in' : 'mask-down-in') : i % 2 ? 'mask-left-in' : 'mask-right-in', 0.8, vertical ? 'wipe-up-out' : 'wipe-left-out', 0.5, 'slow-zoom', 9 + i),
        });
      });
      const nums = panels.map((p, i) =>
        label(env, `0${i + 1}`, { start: 1.2 + i * 0.15, duration: till(d, 1.2 + i * 0.15, (n - 1 - i) * 0.12), size: L.wide ? 30 : 28, color: '#ffffff', track: 0.2, x: p.transform.x - (vertical ? 0 : L.s.hw - 40), y: vertical ? L.s.hh : Math.max(-L.s.hh + 20, p.transform.y - phh / 2 + 50), style: { shadow: { color: alpha('#000000', 0.6), blur: 10, x: 0, y: 2 } }, anim: A('fade-in', 0.5, 'fade-out', 0.35) }),
      );
      if (!vertical) nums.forEach((t) => alignLeft(t, -L.s.hw));

      const bandFill = pick(r, ['surface', 'primary'] as const);
      const fill = bandFill === 'primary' ? c.primary : c.surface;
      const ink = bandFill === 'primary' ? textOn(env, c.primary) : c.text;
      const bandW = L.wide ? 1100 : L.s.w;
      const title = H(env, 'Made by Hand', { name: 'Title', start: 1.6, duration: till(d, 1.6), size: L.tall ? 128 : L.wide ? 128 : 96, color: ink, maxWidth: bandW - 120, maxLines: 2, textAnim: { in: { id: 'char-slide-in', duration: 0.8 } }, anim: A(undefined, 0, 'fade-out', 0.4) });
      const sub = B(env, 'Small-batch ceramics from our Porto studio', { name: 'Subtitle', start: 2.0, duration: till(d, 2.0), size: L.tall ? 42 : L.wide ? 38 : 34, color: alpha(ink, 0.8), maxWidth: bandW - 120, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const bandH = Math.round(title.metrics.height + sub.metrics.height + 16 + 110);
      const band = makeShape('rect', { name: 'Title band', start: 1.4, duration: till(d, 1.4), width: bandW, height: bandH, radius: 28, fill, shadow: { color: alpha('#000000', 0.35), blur: 40, x: 0, y: 16 }, anim: A('wipe-center-in', 0.6, 'collapse-h-out', 0.45) });
      vstack([{ clips: [title], h: title.metrics.height, gap: 16 }, { clips: [sub], h: sub.metrics.height }], { centerY: 0 });

      return [bg, ...panels, ...nums, band, title, sub];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 6. Card carousel
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-slideshow-card-carousel',
    name: 'Card Carousel',
    category: 'slideshow',
    tags: ['carousel', 'cards', 'slideshow', 'portfolio', 'recap', 'photos', 'deck'],
    duration: 12,
    poster: 0.55,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'aurora', 'flow'] as const), { duration: d });
      const n = 4;
      const { starts, seg } = segments(d, n, 0.2, 0.1);
      const pop = vivid(env, c.bg);
      const titles = ['Morning light', 'The workshop', 'Fresh from the kiln', 'Ready to ship'];

      const cardAspect = L.wide ? 1.5 : L.square ? 1.25 : 0.8;
      const capSpace = L.wide ? 170 : L.tall ? 260 : 190;
      const maxH = L.s.h - capSpace;
      let cw = L.wide ? Math.min(1100, L.s.w * 0.62) : L.s.w * (L.tall ? 0.92 : 0.8);
      let ch = cw / cardAspect;
      if (ch > maxH) {
        ch = maxH;
        cw = ch * cardAspect;
      }
      const cy = -L.s.hh + ch / 2 + (L.tall ? 40 : 0);
      const capTop = cy + ch / 2 + (L.tall ? 60 : 40);

      const out: Clip[] = [];
      const bigNums: Txt[] = [];
      starts.forEach((s, i) => {
        const end = i === n - 1 ? d : s + seg;
        const deg = i === 0 ? 0 : (i % 2 ? 1 : -1) * range(r, 2, 4);
        const big = H(env, String(i + 1).padStart(2, '0'), { name: `Number ${i + 1}`, start: s, duration: end - s, size: L.wide ? 520 : 460, maxWidth: L.s.w * (L.wide ? 0.36 : 0.6), maxLines: 1, minSize: 120, color: alpha(c.text, c.dark ? 0.07 : 0.06), style: { letterSpacing: 0, uppercase: false, lineHeight: 0.9 }, anim: A('fade-in', 0.6, 'fade-out', 0.4) });
        big.transform.x = Math.round(L.hw - L.s.mx * 0.6 - big.metrics.inkWidth / 2);
        big.transform.y = Math.round(-L.hh + L.s.my * 0.6 + big.metrics.height / 2);
        bigNums.push(big);
        out.push(
          makeSlot({
            name: `Card ${i + 1}`,
            start: s,
            duration: till(d, s),
            width: Math.round(cw),
            height: Math.round(ch),
            radius: 40,
            y: cy,
            rotation: deg,
            shadow: { color: alpha('#000000', c.dark ? 0.5 : 0.22), blur: 40, x: 0, y: 18 },
            anim: A(i === 0 ? 'zoom-soft-in' : 'fly-left-in', 0.7, 'fade-out', 0.4),
          }),
        );
      });
      const caps: Clip[] = [];
      starts.forEach((s, i) => {
        const end = i === n - 1 ? d : s + seg;
        const counter = label(env, `${i + 1} of ${n}`, { start: s + 0.3, duration: end - s - 0.3, size: L.tall ? 30 : 26, color: c.textMuted, track: 0.2, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.3) });
        const cap = H(env, titles[i], { name: `Caption ${i + 1}`, start: s + 0.4, duration: end - s - 0.4, size: L.tall ? 92 : L.wide ? 76 : 64, maxWidth: L.s.w, maxLines: 1, textAnim: { in: { id: 'word-rise-in', duration: 0.6 } }, anim: A(undefined, 0, 'fade-out', 0.3) });
        vstack([{ clips: [counter], h: counter.metrics.height, gap: 12 }, { clips: [cap], h: cap.metrics.height }], { top: capTop });
        caps.push(counter, cap);
      });
      const dots = Array.from({ length: n }, (_, i) =>
        makeShape('ellipse', { name: `Dot ${i + 1}`, start: starts[i], duration: till(d, starts[i]), width: 14, height: 14, x: (i - (n - 1) / 2) * 30, y: L.s.hh - 7, fill: c.text, anim: A('pop-in', 0.35, 'fade-out', 0.3) }),
      );
      void mix;
      return [bg, ...bigNums, ...out, ...caps, ...dots];
    },
  },
];

export default templates;
