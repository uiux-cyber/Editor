/**
 * Generated layouts, part B: dark glow minimal, technical grids, split screens, floating
 * cards, orbits of people and quotes.
 */

import type { CounterSettings } from '@/core/types';
import { type Archetype, darkPalette, lightPalette } from './archetype';
import {
  B,
  H,
  type Txt,
  add,
  alpha,
  anim,
  atBottom,
  atLeft,
  atRight,
  atTop,
  backdropPhoto,
  between,
  chance,
  ellipse,
  filmLook,
  generator,
  giant,
  glow,
  hand,
  inkOn,
  label,
  luminance,
  mix,
  mono,
  paperInk,
  person,
  photo,
  pick,
  pill,
  place,
  plus,
  quietOn,
  rect,
  ring,
  rule,
  scrim,
  shape,
  shuffled,
  signalOn,
  signals,
  solid,
  stackText,
  text,
  th,
  tw,
  voice,
} from './parts';

const WHITE = '#ffffff';

/** A count-up for numbers like "34,092", "+148%", "4.9" or "£349" (null when it is not a number). */
function counterFor(s: string): CounterSettings | null {
  const m = /^([^\d]*?)([\d][\d,]*(?:\.\d+)?)(.*)$/.exec(s.trim());
  if (!m) return null;
  const to = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(to)) return null;
  const decimals = m[2].includes('.') ? m[2].split('.')[1].length : 0;
  return { from: 0, to, decimals, prefix: m[1], suffix: m[3], separator: m[2].includes(','), ease: 'easeOut', duration: 1.6 };
}

// ---------------------------------------------------------------------------------------------
// Glow minimal — black, a few words at a time, soft light.
// ---------------------------------------------------------------------------------------------

export const glowMinimal: Archetype = {
  id: 'glow',
  name: 'Glow Minimal',
  categories: ['intro', 'title', 'quote', 'outro', 'social'],
  tags: ['minimal', 'dark', 'glow', 'cinematic', 'elegant', 'light', 'words'],
  fonts: ['air-raleway', 'whisper-montserrat', 'serif-journal', 'editorial', 'playfair-modern', 'grotesk-studio', 'maison-luxe'],
  palettes: darkPalette,
  duration: 6,
  poster: 0.55,
  build(x, k) {
    const c = x.c;
    const sig = signalOn(x, '#050608', 3);
    const bg = mix(c.bg, '#000000', 0.65);
    add(x, solid(x, bg));
    const light = pick(x, ['leaks', 'dust', 'spot', 'stars', 'none'] as const);
    if (light === 'leaks') add(x, generator(x, 'light-leaks', { colorBg: bg, colorA: c.primary, colorB: c.accent, colorC: c.secondary, size: 0.8 }, { opacity: 0.5, name: 'Light leaks' }));
    else if (light === 'dust') add(x, generator(x, 'floating-dust', { colorBg: bg, colorA: mix(WHITE, sig, 0.3), colorB: bg }, { name: 'Dust' }));
    else if (light === 'spot') add(x, generator(x, 'spotlight', { colorBg: bg, colorA: mix(bg, sig, 0.35), posX: 0.5, posY: 0.42, radius: 0.45, softness: 0.7, haze: 0.4 }, { name: 'Spotlight' }));
    else if (light === 'stars') add(x, generator(x, 'starfield', { colorBg: bg, colorA: '#d8dde8', colorB: bg }, { name: 'Stars', opacity: 0.6 }));
    add(x, glow(x, { size: Math.min(x.cw, x.ch) * 1.1, color: sig, strength: 0.28, at: 0.2 }));
    const serif = chance(x, 0.45);
    const face = serif ? { family: pick(x, ['Playfair Display', 'DM Serif Display']), italic: chance(x, 0.5), weight: 400 } : {};
    const d = x.d;
    const b1 = [0.3, d * 0.34];
    const b2 = [d * 0.34, d * 0.78];
    const b3 = [d * 0.78, d];
    const g = { color: alpha(sig, 0.9), blur: 28 };
    const ins = pick(x, ['word-blur-in', 'tracking-expand-in', 'char-fade-in', 'char-blur-in'] as const);
    const outs = ins === 'tracking-expand-in' ? 'tracking-out' : ins === 'char-fade-in' ? 'char-fade-out' : 'word-blur-out';
    const beat = (s: string, size: number, at: number, until: number, title: boolean): Txt =>
      text(x, 'heading', s, {
        size,
        color: title ? WHITE : '#e8e8ee',
        maxWidth: x.s.w * 0.86,
        maxLines: title ? 3 : 2,
        glow: g,
        upper: title && !serif ? chance(x, 0.5) : undefined,
        track: title && !serif ? 0.06 : undefined,
        at,
        until,
        lh: 1.08,
        textAnim: { in: { id: ins, duration: 0.9 }, out: { id: outs, duration: 0.5 } },
        ...face,
      });
    const t1 = beat(k.kicker, x.wide ? 64 : 58, b1[0], b1[1], false);
    const t2 = beat(k.title, x.wide ? 128 : 112, b2[0], b2[1], true);
    const t3 = beat(pick(x, [k.cta, k.sub]), x.wide ? 60 : 54, b3[0], b3[1], false);
    const line = rule(x, { w: Math.min(260, tw(t2) * 0.4), h: 2, color: sig, y: th(t2) / 2 + 40, at: b2[0] + 0.4, until: b2[1], anim: anim('wipe-center-in', 0.8, 'fade-out', 0.4) });
    const name = label(x, k.name, { size: 20, color: '#ffffff80', track: 0.5, at: 0.6, anim: anim('fade-in', 1) });
    atBottom(name, x.hh - x.s.my * 0.8);
    add(x, t1, t2, line, t3, name);
    add(x, filmLook(x, { grain: 0.14, vignette: 0.5 }));
  },
};

// ---------------------------------------------------------------------------------------------
// Technical grid — a measured, HUD-like layout: grid, coordinates, a counter or a circled subject.
// ---------------------------------------------------------------------------------------------

export const technical: Archetype = {
  id: 'grid',
  name: 'Technical Grid',
  categories: ['business', 'intro', 'title', 'youtube', 'news'],
  tags: ['technical', 'grid', 'data', 'hud', 'modern', 'numbers', 'stats'],
  fonts: ['signal-mono', 'grotesk-studio', 'terminal-mono', 'modern-bold', 'gallery-syne', 'impact-black'],
  duration: 6,
  poster: 0.62,
  build(x, k) {
    const v = voice(x, ['typed', 'crisp', 'kinetic']);
    const dark = chance(x, 0.5);
    const { paper, ink } = paperInk(x);
    const bg = dark ? mix(x.c.bg, '#07080b', 0.7) : mix(paper, '#e9e9ea', 0.5);
    const fg = dark ? '#e9ecf2' : ink;
    const sig = signalOn(x, bg, 2.6);
    add(x, solid(x, bg));
    add(x, generator(x, 'grid-lines', { colorBg: bg, colorA: mix(bg, fg, dark ? 0.12 : 0.1), size: 54, major: 5, lineWidth: 1, fade: 0.5 }, { name: 'Grid' }));
    // Corner data.
    const tc = `00:00:${String(Math.floor(between(x, 1, 59))).padStart(2, '0')}:${String(Math.floor(between(x, 0, 24))).padStart(2, '0')}`;
    const corners = [k.name, tc, k.meta[0] ?? k.kicker, k.meta[1] ?? `${between(x, 10, 60).toFixed(4)}° N`];
    const cl = corners.map((s, i) => {
      const t = mono(x, s, { size: 20, color: alpha(fg, 0.75), at: 0.3 + i * 0.1, anim: anim('fade-in', 0.4) });
      if (i % 2 === 0) atLeft(t, -x.s.hw);
      else atRight(t, x.s.hw);
      if (i < 2) atTop(t, -x.hh + x.s.my * 0.7);
      else atBottom(t, x.hh - x.s.my * 0.7);
      return t;
    });
    add(x, ...cl);
    const piece = pick(x, ['counter', 'photo', 'photo', 'word'] as const);
    const side = x.wide ? pick(x, [-1, 1] as const) : 0;
    // Copy + bars.
    const align = x.wide ? 'left' : 'left';
    const textL = x.wide ? (side < 0 ? 0 : -x.s.hw) : -x.s.hw;
    const textW = x.wide ? x.s.hw - 40 : x.s.w;
    const kick = label(x, k.kicker, { size: 24, color: sig, align, at: 0.9, anim: anim(v.label, 0.5) });
    const title = H(x, k.title, {
      size: x.wide ? 80 : 84,
      color: fg,
      maxWidth: textW,
      maxLines: 3,
      align,
      weight: 700,
      at: 1,
      textAnim: { in: { id: v.title, duration: 0.9 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    const bars = k.points.map((p, i) => {
      const t = mono(x, p, { size: 20, color: alpha(fg, 0.8), align: 'left', at: 1.4 + i * 0.12, anim: anim('fade-in', 0.3) });
      return t;
    });
    // Centre piece: beside the copy on wide frames, above it otherwise (sized to the room left).
    let D = Math.round(Math.min(x.cw, x.ch) * (x.portrait ? 0.62 : 0.46));
    const cx = side * x.cw * 0.2;
    let cy = -20;
    if (!x.wide) {
      const copyH = th(kick) + 18 + th(title) + 50 + bars.length * 62;
      const top = -x.hh + x.s.my * 0.7 + 70;
      const bottom = x.hh - x.s.my * 0.7 - 50 - copyH;
      D = Math.round(Math.min(D, (bottom - top) / 1.5));
      cy = (top + bottom) / 2;
    }
    add(x, ring(x, { w: D * 1.18, h: D * 1.18, x: cx, y: cy, width: 2, color: alpha(fg, 0.35), at: 0.4, anim: anim('zoom-soft-in', 0.8, 'fade-out', 0.4, 'spin', 24), name: 'Orbit' }));
    add(
      x,
      ...plus(x, { size: 36, width: 2, x: cx - D * 0.72, y: cy - D * 0.72, color: sig, at: 0.6, anim: anim('pop-in', 0.4) }),
      ...plus(x, { size: 36, width: 2, x: cx + D * 0.72, y: cy + D * 0.72, color: sig, at: 0.7, anim: anim('pop-in', 0.4) }),
    );
    if (piece === 'photo') {
      add(x, photo(x, { w: D, h: D, x: cx, y: cy, kind: 'ellipse', at: 0.5, push: true, anim: anim(v.photo, 0.8), name: 'Subject' }));
      const tag = pill(x, k.numberLabel, { size: 22, fill: sig, at: 1.3 });
      place([tag.box, tag.label], cx + D * 0.42, cy - D * 0.42);
      add(x, tag.box, tag.label);
    } else if (piece === 'counter') {
      const num = H(x, k.number, { size: x.wide ? 240 : 200, color: sig, weight: 800, at: 0.6, x: cx, y: cy - 20, anim: anim('fade-in', 0.4) });
      const ct = counterFor(k.number);
      if (ct) num.counter = ct;
      // Never wider than the circle (the count's widest value is the final one).
      const k2 = Math.min(1, (D * 1.05) / Math.max(1, num.metrics.inkWidth));
      num.transform.scaleX = k2;
      num.transform.scaleY = k2;
      const cap = mono(x, k.numberLabel, { size: 26, color: fg, at: 1, x: cx, anim: anim('fade-in', 0.5) });
      cap.transform.y = Math.round(num.transform.y + th(num) / 2 + 30);
      add(x, num, cap);
    } else {
      const w = giant(x, 'heading', k.accent.toUpperCase(), D * 0.92, {
        color: '#00000000',
        stroke: { color: fg, width: 4 },
        upper: true,
        at: 0.6,
        maxH: D * 0.5,
        textAnim: { in: { id: 'char-fade-in', duration: 0.8 } },
        anim: anim(undefined, 0, 'fade-out', 0.4),
      });
      place([w], cx, cy);
      add(x, w);
    }
    const items = [kick, title];
    if (x.wide) stackText(items, { cy: -60, gaps: [20] });
    else stackText(items, { top: cy + D * 0.7 + 30, gaps: [18] });
    for (const t of items) atLeft(t, textL);
    let by = title.transform.y + th(title) / 2 + 50;
    const barW = Math.min(textW, 520);
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      atLeft(b, textL);
      b.transform.y = Math.round(by);
      const frac = [0.82, 0.56, 0.68][i] ?? 0.5;
      const track = rect(x, { w: barW, h: 8, x: textL + barW / 2, y: by + 24, fill: alpha(fg, 0.12), at: 1.4 + i * 0.12, anim: anim('fade-in', 0.3), name: 'Bar track' });
      const fill = rect(x, { w: barW * frac, h: 8, x: textL + (barW * frac) / 2, y: by + 24, fill: i === 0 ? sig : alpha(fg, 0.7), at: 1.5 + i * 0.12, anim: anim('wipe-right-in', 0.7), name: 'Bar' });
      add(x, b, track, fill);
      by += 62;
    }
    add(x, ...items);
    add(x, filmLook(x, { grain: dark ? 0.12 : 0.06, vignette: dark ? 0.3 : 0 }));
  },
};

// ---------------------------------------------------------------------------------------------
// Split screen — two or three panels side by side (stacked on tall frames).
// ---------------------------------------------------------------------------------------------

export const splitScreen: Archetype = {
  id: 'split',
  name: 'Split Screen',
  categories: ['social', 'promo', 'vlog', 'youtube'],
  tags: ['split', 'before after', 'comparison', 'photos', 'panels', 'triptych'],
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['crisp', 'kinetic', 'editorial', 'bouncy']);
    const c = x.c;
    const n = chance(x, 0.5) ? 2 : 3;
    const framed = chance(x, 0.5);
    const bg = framed ? (c.dark ? c.bg : mix(c.bg, '#ffffff', 0.4)) : '#000000';
    const fg = inkOn(x, bg);
    const sig = signals(x)[0];
    add(x, solid(x, bg));
    const vertical = x.portrait;
    const gap = framed ? 24 : 0;
    const pad = framed ? x.s.mx * 0.7 : 0;
    // Room for the headline: a band at the top (framed) or an overlay (full bleed).
    const head = framed ? (vertical ? 300 : 240) : 0;
    const areaW = x.cw - pad * 2;
    const areaH = x.ch - pad * 2 - head;
    const areaTop = -x.hh + pad + head;
    const labels = n === 2 ? ['Before', 'After'] : k.points;
    const panels: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < n; i++) {
      const w = vertical ? areaW : (areaW - gap * (n - 1)) / n;
      const h = vertical ? (areaH - gap * (n - 1)) / n : areaH;
      panels.push({ w, h, x: vertical ? 0 : -x.cw / 2 + pad + w / 2 + i * (w + gap), y: vertical ? areaTop + h / 2 + i * (h + gap) : areaTop + h / 2 });
    }
    panels.forEach((p, i) => {
      add(
        x,
        photo(x, {
          ...p,
          radius: framed ? 26 : 0,
          bw: n === 2 && i === 0 && chance(x, 0.5),
          push: true,
          at: 0.2 + i * 0.25,
          anim: anim(pick(x, ['wipe-right-in', 'box-open-in', 'unfold-in']), 0.7),
          name: labels[i] ?? `Photo ${i + 1}`,
        }),
      );
      const tag = pill(x, labels[i] ?? '', { size: 26, fill: i === n - 1 ? sig : '#ffffff', at: 0.8 + i * 0.25, anim: anim('pop-in', 0.4) });
      place([tag.box, tag.label], p.x - p.w / 2 + 30 + tag.w / 2, p.y - p.h / 2 + 30 + tag.h / 2);
      add(x, tag.box, tag.label);
    });
    if (n === 2 && !framed) {
      const lineW = vertical ? x.cw : 6;
      const lineH = vertical ? 6 : x.ch;
      add(x, rect(x, { w: lineW, h: lineH, fill: WHITE, at: 0.6, anim: anim('fade-in', 0.4), name: 'Divider' }));
      add(x, ellipse(x, { w: 84, h: 84, fill: WHITE, at: 0.7, anim: anim('pop-in', 0.4), name: 'Handle' }));
      add(x, text(x, 'body', '‹ ›', { size: 40, color: '#111111', weight: 700, at: 0.75, y: -3, anim: anim('pop-in', 0.4), name: 'Arrows' }));
    }
    if (framed) {
      const kick = label(x, k.kicker, { size: 24, color: signalOn(x, bg, 2.4), align: 'left', at: 0.3, anim: anim(v.label, 0.5) });
      const title = H(x, k.title, {
        size: vertical ? 84 : 76,
        color: fg,
        maxWidth: areaW * (vertical ? 1 : 0.7),
        maxLines: 2,
        align: 'left',
        at: 0.4,
        textAnim: { in: { id: v.title, duration: 0.9 } },
        anim: anim(undefined, 0, 'fade-out', 0.4),
      });
      stackText([kick, title], { cy: -x.hh + pad + head / 2 - 10, gaps: [14] });
      atLeft(kick, -x.cw / 2 + pad);
      atLeft(title, -x.cw / 2 + pad);
      add(x, kick, title);
      if (!vertical) {
        const h = mono(x, k.meta[0] ?? k.name, { size: 22, color: quietOn(x, bg), at: 0.6, anim: anim('fade-in', 0.5) });
        atRight(h, x.cw / 2 - pad);
        h.transform.y = title.transform.y;
        add(x, h);
      }
    } else {
      add(x, scrim(x, 'bottom', 0.75, 0.5));
      const title = H(x, k.title, {
        size: x.wide ? 92 : 86,
        color: WHITE,
        maxWidth: x.s.w,
        maxLines: 2,
        upper: chance(x, 0.5),
        at: 1,
        textAnim: { in: { id: v.title, duration: 0.9 } },
        anim: anim(undefined, 0, 'fade-out', 0.4),
        shadow: { color: '#00000088', blur: 20, x: 0, y: 4 },
      });
      atBottom(title, x.hh - x.s.my);
      const cta = label(x, k.cta, { size: 24, color: sig, at: 1.4, anim: anim('fade-in', 0.5) });
      atBottom(cta, title.transform.y - th(title) / 2 - 20);
      add(x, title, cta);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Floating cards — three cards fanned over a colour, a giant outlined word behind.
// ---------------------------------------------------------------------------------------------

export const cards: Archetype = {
  id: 'cards',
  name: 'Floating Cards',
  categories: ['business', 'promo', 'social', 'title'],
  tags: ['cards', 'ui', 'depth', 'modern', 'features', 'steps', '3d'],
  fonts: ['grotesk-studio', 'impact-black', 'modern-bold', 'gallery-syne', 'signal-mono', 'geometric-pop', 'headline-condensed'],
  duration: 6,
  poster: 0.62,
  build(x, k) {
    const v = voice(x, ['bouncy', 'kinetic', 'crisp']);
    const sig = signals(x)[0];
    const dark = chance(x, 0.35);
    const bg = dark ? '#111216' : sig;
    const fg = inkOn(x, bg, 4);
    add(x, solid(x, bg));
    // Giant outlined word behind everything.
    const word = giant(x, 'heading', k.accent.toUpperCase(), x.cw * 1.12, {
      color: '#00000000',
      stroke: { color: alpha(fg, 0.6), width: 4 },
      upper: true,
      maxH: x.ch * 0.42,
      at: 0.1,
      anim: anim('fade-in', 0.8),
    });
    word.transform.y = Math.round(x.portrait ? -x.hh * 0.42 : 0);
    add(x, word);
    // Cards.
    const arrangement = pick(x, ['fan', 'row', 'cascade'] as const);
    // Three cards always fit across the safe area.
    const across = arrangement === 'row' ? 3.3 : arrangement === 'fan' ? 2.95 : 2.2;
    const cw = Math.round(Math.min(x.cw * (x.portrait ? 0.34 : 0.2), x.ch * 0.36, (x.s.w * 1.04) / across));
    const ch = Math.round(cw * 1.38);
    const cy = x.portrait ? x.hh * 0.08 : 30;
    const icons = shuffled(x, ['triangle', 'half', 'plus', 'star', 'ellipse', 'diamond'] as const).slice(0, 3);
    const light = '#f4f2ee';
    const darkCard = '#1b1c21';
    for (let i = 0; i < 3; i++) {
      const o = i - 1;
      const rot = arrangement === 'fan' ? o * 9 : arrangement === 'cascade' ? -6 : 0;
      const px = arrangement === 'cascade' ? o * cw * 0.5 : o * cw * (arrangement === 'fan' ? 0.92 : 1.12);
      const py = cy + (arrangement === 'fan' ? Math.abs(o) * 34 : arrangement === 'cascade' ? o * ch * 0.18 : 0);
      const hero = i === 1;
      const fill = hero ? light : darkCard;
      const ink = hero ? '#141414' : '#f4f2ee';
      const at = 0.5 + (hero ? 0.3 : i * 0.15);
      const a = anim(pick(x, ['card-spin-in', 'rise-in', 'flip-h-in']), 0.7, 'fade-out', 0.4, 'hover', 4 + i);
      const card = rect(x, { w: cw, h: ch, x: px, y: py, radius: 22, fill, rotation: rot, shadow: { color: '#00000066', blur: 40, x: 0, y: 18 }, at, anim: a, name: `Card ${i + 1}` });
      const iconKind = icons[i];
      const isz = cw * 0.42;
      const rad = (rot * Math.PI) / 180;
      const off = (dx: number, dy: number): [number, number] => [px + dx * Math.cos(rad) - dy * Math.sin(rad), py + dx * Math.sin(rad) + dy * Math.cos(rad)];
      const [ix, iy] = off(0, -ch * 0.08);
      const icon =
        iconKind === 'half'
          ? shape(x, 'ellipse', { w: isz, h: isz, x: ix, y: iy, fill: hero ? sig : ink, rotation: rot, at: at + 0.15, anim: a, name: 'Icon' })
          : shape(x, iconKind === 'plus' ? 'cross' : iconKind, { w: isz, h: isz, x: ix, y: iy, fill: hero ? sig : ink, rotation: rot, at: at + 0.15, anim: a, name: 'Icon' });
      const [nx, ny] = off(-cw / 2 + 40, -ch / 2 + 34);
      const num = mono(x, `0${i + 1}`, { size: 22, color: ink, x: nx, y: ny, rotation: rot, at: at + 0.2, anim: a });
      const [lx, ly] = off(0, ch / 2 - 46);
      const lab = label(x, k.points[i] ?? '', { size: 22, color: ink, maxWidth: cw - 40, maxLines: 1, x: lx, y: ly, rotation: rot, at: at + 0.2, anim: a });
      add(x, card, icon, num, lab);
    }
    // Header / footer.
    const kick = label(x, k.kicker, { size: 24, color: fg, align: 'left', at: 0.2, anim: anim(v.label, 0.5) });
    atTop(atLeft(kick, -x.s.hw), -x.hh + x.s.my * 0.7);
    const meta = mono(x, k.meta[0] ?? k.name, { size: 20, color: fg, at: 0.2, anim: anim('fade-in', 0.5) });
    atTop(atRight(meta, x.s.hw), -x.hh + x.s.my * 0.7);
    const title = H(x, k.title, {
      size: x.wide ? 64 : 70,
      color: fg,
      maxWidth: x.s.w * (x.wide ? 0.5 : 1),
      maxLines: 2,
      align: 'left',
      at: 1.4,
      textAnim: { in: { id: v.title, duration: 0.8 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    atBottom(atLeft(title, -x.s.hw), x.hh - x.s.my * 0.7 - 40);
    const hr = rule(x, { w: x.s.w, h: 2, y: x.hh - x.s.my * 0.7 - 10, color: alpha(fg, 0.6), at: 1.2, anim: anim('wipe-right-in', 0.7) });
    const idx = mono(x, `${k.number} / ${k.numberLabel}`, { size: 20, color: fg, at: 1.6, anim: anim('fade-in', 0.4) });
    atRight(idx, x.s.hw);
    idx.transform.y = Math.round(title.transform.y + th(title) / 2 - th(idx) / 2);
    add(x, kick, meta, title, hr);
    if (x.wide) add(x, idx);
  },
};

// ---------------------------------------------------------------------------------------------
// Orbit — a person in the middle, people and pictures circling on rings.
// ---------------------------------------------------------------------------------------------

export const orbit: Archetype = {
  id: 'orbit',
  name: 'Orbit',
  categories: ['social', 'business', 'intro', 'event'],
  tags: ['circles', 'people', 'community', 'orbit', 'network', 'team'],
  palettes: lightPalette,
  duration: 6,
  poster: 0.62,
  build(x, k) {
    const v = voice(x, ['bouncy', 'calm', 'crisp']);
    const { paper, ink } = paperInk(x);
    const bg = paper;
    const sig = signalOn(x, bg, 2.4);
    add(x, solid(x, bg));
    // Copy first: on wide frames it sits on the left, otherwise on top; the orbit takes the rest.
    const align = x.wide ? 'left' : 'center';
    const kick = label(x, k.kicker, { size: 24, color: sig, align, at: 0.3, anim: anim(v.label, 0.5) });
    const title = H(x, k.title, {
      size: x.wide ? 90 : 84,
      color: ink,
      maxWidth: x.wide ? x.cw * 0.36 : x.s.w,
      maxLines: 3,
      align,
      at: 0.5,
      textAnim: { in: { id: v.title, duration: 0.9 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    const sub = B(x, k.sub, { size: 30, color: quietOn(x, bg), maxWidth: x.wide ? x.cw * 0.34 : x.s.w, maxLines: 2, align, at: 0.9, anim: anim('fade-in', 0.6) });
    let R: number;
    let ox: number;
    let oy: number;
    if (x.wide) {
      stackText([kick, title, sub], { cy: 0, gaps: [20, 26] });
      for (const t of [kick, title, sub]) atLeft(t, -x.s.hw);
      R = x.ch * 0.36;
      ox = x.cw * 0.2;
      oy = 10;
    } else {
      const h = stackText([kick, title, sub], { top: -x.hh + x.s.my, gaps: [18, 20] });
      const top = -x.hh + x.s.my + h + 50;
      const bottom = x.hh - x.s.my * 0.6;
      // Satellites reach about 1.2 R from the centre.
      R = Math.min(x.cw * 0.4, (bottom - top) / 2.45);
      ox = 0;
      oy = (top + bottom) / 2;
    }
    for (let i = 0; i < 3; i++)
      add(
        x,
        ring(x, { w: R * (0.9 + i * 0.55), h: R * (0.9 + i * 0.55), x: ox, y: oy, width: 2, color: alpha(ink, 0.18 - i * 0.04), at: 0.1 + i * 0.1, anim: anim('zoom-soft-in', 0.8), name: 'Ring' }),
      );
    add(x, person(x, { w: R * 0.78, h: R * 0.78, x: ox, y: oy, kind: 'ellipse', at: 0.4, anim: anim(v.photo, 0.7), name: 'Person' }));
    const count = 5;
    const a0 = between(x, 0, Math.PI * 2);
    for (let i = 0; i < count; i++) {
      const ang = a0 + (i / count) * Math.PI * 2;
      const rr = R * (i % 2 ? 0.72 : 0.98);
      const sz = R * (i % 2 ? 0.3 : 0.38);
      add(
        x,
        photo(x, {
          w: sz,
          h: sz,
          x: ox + Math.cos(ang) * rr,
          y: oy + Math.sin(ang) * rr * 0.94,
          kind: 'ellipse',
          at: 0.7 + i * 0.15,
          border: { color: '#ffffff', width: 6 },
          shadow: true,
          anim: anim('pop-soft-in', 0.5, 'fade-out', 0.4, 'bob', 3 + i * 0.4),
          name: `Photo ${i + 1}`,
        }),
      );
    }
    k.points.slice(0, 2).forEach((p, i) => {
      const t = pill(x, p, { size: 22, fill: i ? '#ffffff' : sig, color: i ? ink : undefined, at: 1.6 + i * 0.2, stroke: i ? { color: alpha(ink, 0.15), width: 2 } : undefined });
      place([t.box, t.label], ox + (i ? -R * 0.95 : R * 0.95), oy + (i ? R * 0.55 : -R * 0.62));
      add(x, t.box, t.label);
    });
    add(x, kick, title, sub);
  },
};

// ---------------------------------------------------------------------------------------------
// Quote — big marks, the words, the author.
// ---------------------------------------------------------------------------------------------

export const quote: Archetype = {
  id: 'quote',
  name: 'Quote',
  categories: ['quote', 'social'],
  tags: ['quote', 'words', 'serif', 'minimal', 'inspiration', 'typography'],
  fonts: ['serif-journal', 'editorial', 'fashion-fatface', 'playfair-modern', 'maison-luxe', 'grotesk-studio', 'air-raleway', 'notebook-caveat'],
  duration: 7,
  poster: 0.7,
  build(x, k, cat) {
    const v = voice(x, ['calm', 'editorial', 'typed']);
    const mode = pick(x, ['paper', 'dark', 'photo', 'signal'] as const);
    const { paper, ink } = paperInk(x);
    const sig = signals(x)[0];
    let bg = paper;
    if (mode === 'paper') add(x, solid(x, paper), generator(x, 'paper', { colorA: paper, colorB: mix(paper, ink, 0.05) }, { opacity: 0.8, name: 'Paper' }));
    else if (mode === 'dark') add(x, solid(x, (bg = '#101114')));
    else if (mode === 'signal') add(x, solid(x, (bg = sig)));
    else {
      bg = '#101114';
      add(x, ...backdropPhoto(x, { bw: chance(x, 0.5) }), scrim(x, 'full', 0.62));
    }
    const fg = inkOn(x, bg, 4.5);
    const hot = mode === 'signal' ? fg : signalOn(x, bg, 2.6);
    const words = cat === 'quote' ? k.title : k.sub;
    const author = cat === 'quote' ? k.sub : k.name;
    const align = pick(x, ['left', 'center'] as const);
    const W = x.s.w * (x.wide ? 0.72 : 0.94);
    const mark = text(x, 'heading', '“', { family: pick(x, ['Playfair Display', 'DM Serif Display', 'Abril Fatface']), size: 420, color: hot, at: 0.2, lh: 1, anim: anim('pop-soft-in', 0.6) });
    const q = H(x, words, {
      size: x.wide ? 92 : 84,
      color: fg,
      maxWidth: W,
      maxLines: 5,
      align,
      lh: 1.12,
      at: 0.6,
      textAnim: { in: { id: pick(x, ['word-fade-in', 'line-rise-in', 'word-blur-in']), duration: 1.6 } },
      anim: anim(undefined, 0, 'fade-out', 0.5),
    });
    const line = rule(x, { w: 90, h: 4, color: hot, at: 1.8, anim: anim('wipe-right-in', 0.6) });
    const who = label(x, author, { size: 26, color: fg, at: 2, align, anim: anim(v.label, 0.6) });
    const topY = -q.metrics.height / 2;
    stackText([q, who], { cy: x.portrait ? 40 : 30, gaps: [70] });
    line.transform.y = Math.round(who.transform.y - th(who) / 2 - 30);
    if (align === 'left') {
      const L = -W / 2 - (x.wide ? x.s.hw - W / 2 : 0);
      atLeft(q, L);
      atLeft(who, L);
      line.transform.x = Math.round(L + 45);
      atLeft(mark, L - 10);
    } else mark.transform.x = 0;
    mark.transform.y = Math.round(q.transform.y - th(q) / 2 - 40);
    void topY;
    add(x, mark, q, line, who);
    const kick = label(x, k.kicker, { size: 22, color: alpha(fg, 0.7), at: 0.3, anim: anim('fade-in', 0.6) });
    atTop(kick, -x.hh + x.s.my * 0.8);
    if (align === 'left') atLeft(kick, -x.s.hw);
    const handle = mono(x, k.meta[0] ?? '', { size: 20, color: alpha(fg, 0.7), at: 0.3, anim: anim('fade-in', 0.6) });
    atBottom(handle, x.hh - x.s.my * 0.8);
    if (align === 'left') atLeft(handle, -x.s.hw);
    add(x, kick, handle);
    if (chance(x, 0.4) && mode !== 'photo') {
      const p = photo(x, { w: 150, h: 150, kind: 'ellipse', at: 2.2, anim: anim('pop-in', 0.5), name: 'Author' });
      p.transform.y = who.transform.y;
      p.transform.x = align === 'left' ? Math.round(who.transform.x + tw(who) / 2 + 110) : Math.round(tw(who) / 2 + 110);
      if (align === 'center') {
        p.transform.x = 0;
        p.transform.y = Math.round(who.transform.y + th(who) / 2 + 110);
      }
      add(x, p);
    }
    void hand;
    void luminance;
  },
};
