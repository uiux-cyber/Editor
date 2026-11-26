/**
 * Generated layouts, part C: outlined type, retro pop, photo diaries, headline bands and
 * end screens.
 */

import { kf } from '@/core/factory';
import { type Archetype, lightPalette, vividPalette } from './archetype';
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
  logo,
  luminance,
  mix,
  mono,
  paperInk,
  photo,
  pick,
  pill,
  place,
  quietOn,
  rect,
  scrim,
  shape,
  signalOn,
  signals,
  solid,
  stackText,
  sticker,
  tape,
  th,
  tw,
  voice,
} from './parts';

const WHITE = '#ffffff';

// ---------------------------------------------------------------------------------------------
// Outline type — huge outlined words on black, one filled, a tilted sticker.
// ---------------------------------------------------------------------------------------------

export const outline: Archetype = {
  id: 'outline',
  name: 'Outline Type',
  categories: ['promo', 'event', 'intro', 'youtube', 'title'],
  tags: ['outline', 'stroke', 'bold', 'dark', 'typography', 'sale', 'loud'],
  fonts: ['headline-condensed', 'impact-black', 'cinema-bebas', 'poster', 'bulletin-oswald', 'modern-bold'],
  duration: 5,
  poster: 0.66,
  build(x, k) {
    const v = voice(x, ['punchy', 'kinetic', 'crisp']);
    const bg = chance(x, 0.6) ? '#0b0b0d' : mix(x.c.bg, '#000000', 0.55);
    const sig = signalOn(x, bg, 3);
    add(x, solid(x, bg));
    const style = pick(x, ['echo', 'stack', 'tilt'] as const);
    const outro = anim(undefined, 0, 'fade-out', 0.35);
    if (style === 'echo') {
      const word = k.accent.toUpperCase();
      const rows = x.portrait ? 9 : 5;
      const rowH = (x.ch * 1.02) / rows;
      const mid = Math.floor(rows / 2);
      for (let i = 0; i < rows; i++) {
        const dist = Math.abs(i - mid);
        const filled = i === mid;
        const t = giant(x, 'heading', word, x.cw * 0.94, {
          color: filled ? sig : '#00000000',
          stroke: filled ? undefined : { color: alpha(WHITE, Math.max(0.18, 0.9 - dist * 0.2)), width: 4 },
          upper: true,
          maxH: rowH * 1.08,
          lh: 0.88,
          at: 0.15 + dist * 0.12,
          textAnim: filled ? { in: { id: v.title, duration: 0.6 } } : undefined,
          anim: filled ? outro : anim('fade-in', 0.5, 'fade-out', 0.35),
          name: filled ? word : 'Echo',
        });
        t.transform.y = Math.round(-x.hh + rowH * (i + 0.5) - x.ch * 0.01);
        add(x, t);
      }
    } else {
      const words = k.title.toUpperCase().split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      for (const w of words) {
        const last = lines[lines.length - 1];
        if (last && last.length + w.length < 8) lines[lines.length - 1] = `${last} ${w}`;
        else lines.push(w);
      }
      const maxH = (x.s.h * 0.92) / lines.length;
      const accentLine = Math.max(
        0,
        lines.findIndex((l) => l.includes(k.accent.toUpperCase())),
      );
      const ts: Txt[] = lines.map((l, i) =>
        giant(x, 'heading', l, x.s.w * (style === 'tilt' ? 1.1 : 0.94), {
          color: i === accentLine ? sig : '#00000000',
          stroke: i === accentLine ? undefined : { color: WHITE, width: 5 },
          upper: true,
          maxH,
          lh: 0.9,
          at: 0.2 + i * 0.22,
          textAnim: { in: { id: v.title, duration: 0.55 } },
          anim: outro,
        }),
      );
      stackText(ts, { cy: 0, gap: 4 });
      if (style === 'tilt') for (const t of ts) t.transform.rotation = -7;
      add(x, ...ts);
    }
    // Tilted sticker label.
    const tag = pill(x, `${k.number} ${k.numberLabel}`.toUpperCase(), {
      size: x.portrait ? 40 : 36,
      fill: luminance(sig) > 0.5 ? sig : WHITE,
      color: '#111111',
      radius: 6,
      at: 1.3,
      rotation: -6,
      weight: 800,
      anim: anim('stomp-in', 0.45),
    });
    place([tag.box, tag.label], x.portrait ? x.s.hw - tag.w / 2 : x.s.hw * 0.55, x.portrait ? x.hh * 0.32 : x.hh * 0.42);
    tag.box.transform.rotation = -6;
    add(x, tag.box, tag.label);
    const foot = mono(x, k.meta[0] ?? k.name, { size: 22, color: alpha(WHITE, 0.7), at: 0.4, anim: anim('fade-in', 0.4) });
    atBottom(atLeft(foot, -x.s.hw), x.hh - x.s.my * 0.6);
    const cta = label(x, `${k.cta} →`, { size: 24, color: sig, at: 1.6, anim: anim('slide-up-in', 0.4) });
    atBottom(atRight(cta, x.s.hw), x.hh - x.s.my * 0.6);
    const kick = label(x, k.kicker, { size: 24, color: WHITE, at: 0.2, anim: anim('fade-in', 0.4) });
    atTop(atLeft(kick, -x.s.hw), -x.hh + x.s.my * 0.6);
    add(x, foot, cta, kick, filmLook(x, { grain: 0.18, vignette: 0.35 }));
  },
};

// ---------------------------------------------------------------------------------------------
// Retro pop — sunbursts and rings, chunky sticker type with a hard shadow, stars.
// ---------------------------------------------------------------------------------------------

export const retro: Archetype = {
  id: 'retro',
  name: 'Retro Pop',
  categories: ['event', 'promo', 'social', 'intro'],
  tags: ['retro', '70s', 'groovy', 'fun', 'sunburst', 'pop', 'vintage', 'colourful'],
  fonts: ['groove-shrikhand', 'retro-righteous', 'diner-lobster', 'comic-pop', 'sunny-script', 'friendly-round'],
  palettes: (p) => vividPalette(p),
  duration: 6,
  poster: 0.62,
  build(x, k) {
    const c = x.c;
    const sig = signals(x);
    const cream = '#fbf3e2';
    const ink = '#1d1a24';
    const pattern = pick(x, ['sunburst', 'rings', 'checker', 'halftone'] as const);
    const bgCol = sig[0];
    add(x, solid(x, bgCol));
    if (pattern === 'sunburst')
      add(
        x,
        generator(
          x,
          'sunburst',
          {
            colorA: bgCol,
            colorB: mix(bgCol, sig[1], 0.35),
            colorC: mix(bgCol, '#ffffff', 0.25),
            rays: Math.round(between(x, 14, 26)),
            centerX: 0.5,
            centerY: x.portrait ? 0.4 : 0.55,
            twist: 0.2,
            glow: 0.3,
          },
          { name: 'Sunburst' },
        ),
      );
    else if (pattern === 'rings')
      add(x, generator(x, 'concentric-rings', { colorA: bgCol, colorB: mix(bgCol, sig[1], 0.5), centerX: 0.5, centerY: x.portrait ? 0.72 : 1.05, width: 0.06, softness: 0.05 }, { name: 'Rings' }));
    else if (pattern === 'checker') add(x, generator(x, 'checkerboard', { colorA: bgCol, colorB: mix(bgCol, '#000000', 0.12), size: 90 }, { name: 'Checker' }));
    else add(x, generator(x, 'halftone', { colorA: mix(bgCol, sig[1], 0.5), colorB: bgCol, size: 30 }, { name: 'Halftone' }));
    // Optional arched window with a photo.
    const arch = chance(x, 0.5);
    const titleY = arch ? (x.portrait ? x.hh * 0.28 : x.hh * 0.32) : x.portrait ? -x.hh * 0.05 : -20;
    if (arch) {
      const aw = Math.round(Math.min(x.cw * (x.portrait ? 0.7 : 0.32), x.ch * 0.5));
      const ah = Math.round(aw * 1.15);
      const ay = x.portrait ? -x.hh * 0.22 : -x.hh * 0.18;
      add(x, rect(x, { w: aw + 36, h: ah + 36, y: ay, radius: (aw + 36) / 2, fill: cream, at: 0.2, anim: anim('rise-in', 0.6), name: 'Window frame' }));
      const p = photo(x, { w: aw, h: ah, y: ay, radius: aw / 2, at: 0.4, push: true, anim: anim('rise-in', 0.6), name: 'Photo' });
      add(x, p);
    }
    const title = H(x, k.title, {
      size: x.wide ? 140 : 128,
      color: cream,
      maxWidth: x.s.w * (x.wide ? 0.86 : 1),
      maxLines: 3,
      lh: 0.95,
      stroke: { color: ink, width: 10 },
      shadow: { color: ink, blur: 0, x: 10, y: 12 },
      at: 0.6,
      y: titleY,
      textAnim: { in: { id: pick(x, ['char-bounce-in', 'char-spring-in', 'word-pop-in']), duration: 1 }, loop: chance(x, 0.5) ? { id: 'wave', duration: 2.4 } : undefined },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    add(x, title);
    // Stars and a badge.
    for (let i = 0; i < 4; i++) {
      const sz = between(x, 50, 110);
      const sx = (i % 2 ? 1 : -1) * between(x, x.s.hw * 0.55, x.s.hw);
      const sy = (i < 2 ? -1 : 1) * between(x, x.s.hh * 0.45, x.s.hh * 0.9);
      add(
        x,
        shape(x, i % 2 ? 'star' : 'burst', {
          w: sz,
          h: sz,
          x: sx,
          y: sy,
          fill: i % 2 ? cream : sig[2],
          stroke: { color: ink, width: 4 },
          at: 0.9 + i * 0.12,
          anim: anim('pop-in', 0.4, 'fade-out', 0.3, 'spin', 8 + i * 2),
          name: 'Star',
        }),
      );
    }
    const bs = Math.round(Math.min(x.cw, x.ch) * 0.2);
    const bx = x.portrait ? -x.s.hw + bs / 2 : x.s.hw - bs / 2;
    const by = x.portrait ? x.hh * 0.62 : -x.s.hh + bs / 2;
    add(x, ellipse(x, { w: bs, h: bs, x: bx, y: by, fill: cream, stroke: { color: ink, width: 6 }, at: 1.3, rotation: -10, anim: anim('twist-pop-in', 0.5), name: 'Badge' }));
    add(x, H(x, k.number, { size: Math.round(bs * 0.32), color: ink, at: 1.4, x: bx, y: by - bs * 0.07, rotation: -10, anim: anim('pop-in', 0.4) }));
    add(x, label(x, k.numberLabel, { size: Math.round(bs * 0.08), color: ink, maxWidth: bs * 0.7, maxLines: 2, at: 1.45, x: bx, y: by + bs * 0.2, rotation: -10, anim: anim('fade-in', 0.4) }));
    const info = pill(x, k.meta[0] ?? k.cta, { size: 30, fill: ink, color: cream, at: 1.5, anim: anim('pop-in', 0.4) });
    place([info.box, info.label], 0, Math.min(x.hh - x.s.my - info.h / 2, title.transform.y + th(title) / 2 + 70));
    add(x, info.box, info.label);
    void c;
  },
};

// ---------------------------------------------------------------------------------------------
// Photo diary — polaroids taped to paper, handwritten captions, a date stamp.
// ---------------------------------------------------------------------------------------------

export const polaroid: Archetype = {
  id: 'polaroid',
  name: 'Photo Diary',
  categories: ['vlog', 'social', 'event'],
  tags: ['polaroid', 'scrapbook', 'handwritten', 'photos', 'memories', 'diary', 'travel'],
  fonts: ['notebook-caveat', 'marker-zine', 'signature-script', 'serif-journal', 'friendly-round'],
  palettes: lightPalette,
  duration: 7,
  poster: 0.7,
  build(x, k) {
    const { paper, ink } = paperInk(x);
    const bg = chance(x, 0.5) ? paper : mix(paper, '#c9a679', 0.35);
    add(x, solid(x, bg), generator(x, 'paper', { colorA: bg, colorB: mix(bg, ink, 0.07) }, { opacity: 0.9, name: 'Paper' }));
    // The title first: the photos fill the room between it and the footer.
    const title = hand(x, k.title, {
      size: x.wide ? 96 : 92,
      color: ink,
      maxWidth: x.s.w,
      maxLines: 2,
      at: 0.2,
      textAnim: { in: { id: 'char-fade-in', duration: 1.2 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    atTop(title, -x.hh + x.s.my * 0.7);
    const areaTop = title.transform.y + th(title) / 2 + 50;
    const areaBottom = x.hh - x.s.my * 0.6 - 70;
    const areaH = areaBottom - areaTop;
    const areaY = (areaTop + areaBottom) / 2;
    const across = !x.tall;
    const n = x.wide ? pick(x, [2, 3, 3]) : 2;
    const pw = Math.round(across ? Math.min(x.cw / (n + 0.7), areaH / 1.32) : Math.min(x.cw * 0.56, areaH / 2.05));
    const ph = Math.round(pw * 1.2);
    const inset = Math.round(pw * 0.06);
    for (let i = 0; i < n; i++) {
      const rot = between(x, -9, 9);
      const px = across ? (i - (n - 1) / 2) * pw * 1.04 : (i ? 1 : -1) * x.cw * 0.14;
      const py = across ? areaY + (i % 2 ? -20 : 20) : areaY + (i - 0.5) * ph * 0.8;
      const at = 0.3 + i * 0.35;
      const drop = anim(pick(x, ['drop-in', 'rotate-in', 'swing-in']), 0.6);
      add(x, rect(x, { w: pw, h: ph, x: px, y: py, fill: '#fdfcf8', rotation: rot, shadow: { color: '#00000040', blur: 24, x: 0, y: 12 }, at, anim: drop, name: 'Polaroid' }));
      const rad = (rot * Math.PI) / 180;
      const off = (dx: number, dy: number): [number, number] => [px + dx * Math.cos(rad) - dy * Math.sin(rad), py + dx * Math.sin(rad) + dy * Math.cos(rad)];
      const photoH = pw - inset * 2;
      const [qx, qy] = off(0, -ph / 2 + inset + photoH / 2);
      add(x, photo(x, { w: pw - inset * 2, h: photoH, x: qx, y: qy, rotation: rot, at: at + 0.1, anim: drop, name: `Photo ${i + 1}` }));
      const [cx, cy] = off(0, ph / 2 - (ph - photoH - inset) / 2);
      add(
        x,
        hand(x, k.points[i] ?? '', {
          size: Math.round(pw * 0.11),
          color: ink,
          x: cx,
          y: cy,
          rotation: rot,
          at: at + 0.4,
          maxWidth: pw * 0.9,
          maxLines: 1,
          textAnim: { in: { id: 'typewriter', duration: 0.6 } },
        }),
      );
      const [tx, ty] = off(0, -ph / 2);
      add(x, ...tape(x, { w: pw * 0.38, h: pw * 0.11, x: tx, y: ty, rotation: rot + between(x, -8, 8), color: alpha('#f3e6b8', 0.82), at: at + 0.2, anim: anim('fade-in', 0.3) }));
    }
    // Underline, date stamp, place.
    const underline = sticker(x, 'underline-scribble', { size: 90, x: 0, y: title.transform.y + th(title) / 2 + 10, colors: [signalOn(x, bg, 2.4)], at: 1.2, anim: anim('wipe-right-in', 0.6) });
    const stamp = mono(x, `'${between(x, 10, 29).toFixed(0)} ${String(Math.floor(between(x, 1, 12))).padStart(2, '0')} ${String(Math.floor(between(x, 1, 28))).padStart(2, '0')}`, {
      size: 30,
      color: '#ff7a1a',
      glow: { color: '#ff5a00', blur: 10 },
      at: 1.6,
      anim: anim('fade-in', 0.3),
    });
    atBottom(atRight(stamp, x.s.hw), x.hh - x.s.my * 0.6);
    const where = hand(x, k.meta[0] ?? k.sub, { size: 44, color: quietOn(x, bg), at: 1.8, anim: anim('fade-in', 0.6) });
    atBottom(atLeft(where, -x.s.hw), x.hh - x.s.my * 0.6);
    add(x, title, underline, stamp, where);
  },
};

// ---------------------------------------------------------------------------------------------
// Headline band — a photograph crossed by a bold band carrying the headline.
// ---------------------------------------------------------------------------------------------

export const band: Archetype = {
  id: 'band',
  name: 'Headline Band',
  categories: ['news', 'youtube', 'social', 'title', 'promo'],
  tags: ['headline', 'band', 'photo', 'news', 'bold', 'banner', 'breaking'],
  fonts: ['headline-condensed', 'impact-black', 'bulletin-oswald', 'cinema-bebas', 'modern-bold', 'grotesk-studio'],
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['crisp', 'kinetic', 'punchy']);
    const sig = signals(x)[0];
    add(x, ...backdropPhoto(x, { dim: 0.12 }));
    const tilt = pick(x, [0, 0, -3.5, 3.5]);
    const where = pick(x, ['low', 'mid', 'high'] as const);
    const fg = inkOn(x, sig, 4);
    const title = H(x, k.title, {
      size: x.wide ? 104 : 96,
      color: fg,
      maxWidth: x.s.w,
      maxLines: 2,
      upper: true,
      lh: 0.98,
      at: 0.7,
      rotation: tilt,
      textAnim: { in: { id: v.title, duration: 0.8 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    const bh = Math.round(th(title) + 70);
    const by = where === 'low' ? x.hh - x.s.my - bh / 2 - (x.portrait ? x.ch * 0.08 : 40) : where === 'mid' ? 0 : -x.hh + x.s.my + bh / 2 + 70;
    if (where !== 'high') add(x, scrim(x, where === 'low' ? 'bottom' : 'full', where === 'low' ? 0.6 : 0.3, 0.6));
    const bar = rect(x, { w: x.cw * 1.3, h: bh, y: by, fill: sig, rotation: tilt, at: 0.4, anim: anim('wipe-right-in', 0.6), name: 'Band' });
    title.transform.y = Math.round(by);
    const contrastTag = luminance(sig) > 0.5 ? '#111111' : WHITE;
    const tag = pill(x, k.kicker, { size: 28, fill: contrastTag, radius: 4, at: 0.9, weight: 800, anim: anim('slide-up-in', 0.4) });
    place([tag.box, tag.label], -x.s.hw + tag.w / 2, by - bh / 2 - tag.h / 2 - 8);
    for (const c of [tag.box, tag.label]) c.transform.rotation = tilt;
    const sub = B(x, k.sub, { size: 34, color: WHITE, maxWidth: x.s.w, maxLines: 2, align: 'left', at: 1.3, shadow: { color: '#000000aa', blur: 16, x: 0, y: 3 }, anim: anim('fade-in', 0.6) });
    atLeft(sub, -x.s.hw);
    sub.transform.y = Math.round(by + bh / 2 + th(sub) / 2 + 26);
    if (sub.transform.y + th(sub) / 2 > x.hh - 20) sub.transform.y = Math.round(by - bh / 2 - tag.h - th(sub) / 2 - 30);
    add(x, bar, title, tag.box, tag.label, sub);
    add(x, logo(x, { size: Math.round(Math.min(x.cw, x.ch) * 0.1), x: x.s.hw - Math.min(x.cw, x.ch) * 0.05, y: -x.s.hh + Math.min(x.cw, x.ch) * 0.05, at: 0.5 }));
    if (chance(x, 0.6)) {
      // A ticker along the bottom edge.
      const th2 = 52;
      const ty = x.hh - th2 / 2;
      add(x, rect(x, { w: x.cw, h: th2, y: ty, fill: '#0b0b0d', at: 0.6, anim: anim('slide-up-in', 0.4), name: 'Ticker' }));
      const run = `${k.meta.join('   •   ')}   •   ${k.points.join('   •   ')}   •   ${k.cta}`;
      const t = mono(x, `${run}   •   ${run}`, { size: 22, color: '#e8e8ec', at: 0.8, anim: anim('fade-in', 0.3), name: 'Ticker text' });
      const startX = -x.hw + tw(t) / 2 + 20;
      t.transform.x = Math.round(startX);
      t.transform.y = Math.round(ty);
      t.keyframes = { x: [kf(0, startX, 'linear'), kf(t.duration, startX - tw(t) * 0.35, 'linear')] };
      add(x, t);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// End screen — channel, subscribe, two videos to watch next.
// ---------------------------------------------------------------------------------------------

export const endcard: Archetype = {
  id: 'endcard',
  name: 'End Screen',
  categories: ['outro', 'youtube'],
  tags: ['end screen', 'outro', 'subscribe', 'videos', 'channel', 'watch next'],
  duration: 10,
  poster: 0.5,
  build(x, k) {
    const v = voice(x, ['crisp', 'bouncy', 'calm']);
    // Two columns (channel | videos) unless the frame is tall.
    const side = !x.portrait;
    const c = x.c;
    const sig = signals(x)[0];
    const bg = c.dark ? c.bg : mix(c.bg, '#0d0e12', 0.88);
    const fg = inkOn(x, bg);
    add(x, solid(x, bg));
    const look = pick(x, ['gradient-flow', 'aurora', 'bokeh'] as const);
    const a = mix(bg, c.primary, 0.35);
    const b = mix(bg, c.secondary, 0.3);
    const params: Record<string, string | number> =
      look === 'gradient-flow'
        ? { colorA: bg, colorB: a, colorC: b, angle: 30, flow: 0.4, speed: 0.4 }
        : look === 'aurora'
          ? { colorA: a, colorB: b, colorC: mix(bg, c.accent, 0.3), colorBg: bg, speed: 0.4 }
          : { colorBg: bg, colorA: a, colorB: b, colorC: mix(bg, c.accent, 0.3) };
    add(x, generator(x, look, params, { name: 'Background', opacity: 0.8 }));
    add(x, glow(x, { size: Math.min(x.cw, x.ch), x: side ? -x.cw * 0.25 : 0, y: x.portrait ? -x.hh * 0.45 : 0, color: sig, strength: 0.3 }));
    const ls = Math.round(Math.min(x.cw, x.ch) * (x.portrait ? 0.24 : 0.2));
    const leftX = side ? -x.cw * 0.25 : 0;
    const title = H(x, k.title, {
      size: x.wide ? 76 : 80,
      color: fg,
      maxWidth: side ? x.cw * 0.4 : x.s.w,
      maxLines: 2,
      at: 0.3,
      textAnim: { in: { id: v.title, duration: 0.8 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    const lg = logo(x, { size: ls, x: leftX, y: 0, at: 0.5, round: true });
    lg.anim = anim('pop-in', 0.5, 'fade-out', 0.4);
    const name = H(x, k.name, { size: 44, color: fg, at: 0.7, anim: anim('fade-in', 0.5) });
    const sub = pill(x, k.cta, { size: 30, fill: '#e62117', color: WHITE, at: 1, anim: anim('pop-in', 0.45, 'fade-out', 0.4, 'beat', 1.6) });
    const handles = mono(x, k.meta.join('   ·   '), { size: 22, color: quietOn(x, bg), at: 1.3, anim: anim('fade-in', 0.5) });
    const col = [
      { clip: title, h: th(title), gap: 50 },
      { clip: lg, h: ls, gap: 26 },
      { clip: name, h: th(name), gap: 26 },
      { clip: sub.box, h: sub.h, gap: 24 },
      { clip: handles, h: th(handles) },
    ];
    let y = x.portrait ? -x.hh + x.s.my : -col.reduce((s, it) => s + it.h + (it.gap ?? 0), 0) / 2;
    for (const it of col) {
      it.clip.transform.y = Math.round(y + it.h / 2);
      it.clip.transform.x = Math.round(leftX);
      y += it.h + (it.gap ?? 0);
    }
    sub.label.transform.x = sub.box.transform.x;
    sub.label.transform.y = sub.box.transform.y;
    add(x, title, lg, name, sub.box, sub.label, handles);
    add(x, sticker(x, 'cursor-click', { size: 110, x: leftX + sub.w / 2 + 10, y: sub.box.transform.y + 40, at: 1.8 }));
    // Two videos to watch next.
    const top = side ? 0 : y + 70;
    // Stacked under the channel on tall frames: both videos fit the room left.
    const room = x.hh - x.s.my * 0.5 - top;
    const vw = Math.round(side ? x.cw * 0.36 : Math.min(x.s.w * 0.72, (((room - 80) / 2) * 16) / 9));
    const vh = Math.round((vw * 9) / 16);
    const rightX = side ? x.cw * 0.2 : 0;
    for (let i = 0; i < 2; i++) {
      const vy = side ? (i ? vh / 2 + 50 : -vh / 2) : top + vh / 2 + i * (vh + 80);
      add(
        x,
        photo(x, {
          w: vw,
          h: vh,
          x: rightX,
          y: vy,
          radius: 18,
          at: 0.8 + i * 0.3,
          border: { color: alpha(fg, 0.85), width: 4 },
          anim: anim(pick(x, ['slide-up-in', 'zoom-soft-in']), 0.6),
          name: i ? 'Video 2' : 'Video 1',
        }),
      );
      const lab = label(x, i ? 'Watch next' : 'Latest video', { size: 22, color: fg, align: 'left', at: 1 + i * 0.3, anim: anim('fade-in', 0.4) });
      atLeft(lab, rightX - vw / 2);
      lab.transform.y = Math.round(vy - vh / 2 - 22);
      add(x, lab);
    }
  },
};
