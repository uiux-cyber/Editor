/**
 * Generated layouts, part A: film title cards, Swiss posters, editorial spreads, cut-out
 * collages, product heroes and kinetic word stacks.
 */

import { linear } from '@/core/factory';
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
  barcode,
  between,
  chance,
  ellipse,
  filmLook,
  generator,
  giant,
  inkOn,
  label,
  luminance,
  mix,
  mono,
  paperInk,
  path,
  person,
  photo,
  pick,
  pill,
  place,
  rect,
  ribbon,
  ring,
  rule,
  scrim,
  shape,
  signalOn,
  signals,
  solid,
  stackText,
  sticker,
  tape,
  text,
  th,
  torn,
  tw,
  voice,
} from './parts';

const WHITE = '#ffffff';

// ---------------------------------------------------------------------------------------------
// Film title card — a photograph, a title like a film poster, credits.
// ---------------------------------------------------------------------------------------------

export const cinema: Archetype = {
  id: 'cinema',
  name: 'Film Title',
  categories: ['intro', 'title', 'vlog', 'event', 'youtube'],
  tags: ['cinematic', 'film', 'movie', 'photo', 'title card', 'poster'],
  fonts: ['cinema-bebas', 'headline-condensed', 'maison-luxe', 'serif-journal', 'fashion-fatface', 'editorial', 'bulletin-oswald', 'air-raleway', 'whisper-montserrat', 'playfair-modern'],
  duration: 6,
  poster: 0.62,
  build(x, k) {
    const v = voice(x, ['cinematic', 'calm', 'editorial']);
    add(x, ...backdropPhoto(x, { bw: chance(x, 0.25) }));
    const where = pick(x, x.portrait ? (['center', 'bottom', 'top'] as const) : (['center', 'bottom-left', 'top', 'bottom-left'] as const));
    add(x, where === 'center' ? scrim(x, 'full', 0.4) : where === 'top' ? scrim(x, 'top', 0.8, 0.7) : scrim(x, 'bottom', 0.85, 0.75));
    let bar = 0;
    if (x.wide && chance(x, 0.55)) {
      bar = Math.round(x.ch * 0.1);
      add(x, rect(x, { w: x.cw, h: bar, y: -x.hh + bar / 2, fill: '#000000', name: 'Letterbox' }), rect(x, { w: x.cw, h: bar, y: x.hh - bar / 2, fill: '#000000', name: 'Letterbox' }));
    }
    const align = where === 'bottom-left' ? 'left' : 'center';
    const maxW = where === 'bottom-left' ? x.s.w * 0.62 : x.s.w * 0.92;
    const accent = signalOn(x, '#101014', 3.2);
    const look = pick(x, ['tracked', 'script', 'stacked', 'serif'] as const);
    const kicker = label(x, k.kicker, { size: 26, color: WHITE, at: 0.4, align, track: 0.42, anim: anim(v.label, 0.9) });
    const out = anim(undefined, 0, 'fade-out', 0.5);
    let title: Txt;
    if (look === 'tracked')
      title = H(x, k.title, {
        size: x.wide ? 150 : 124,
        color: WHITE,
        maxWidth: maxW,
        maxLines: 2,
        upper: true,
        track: 0.1,
        align,
        at: 0.8,
        textAnim: { in: { id: v.title, duration: 1.3 } },
        anim: out,
      });
    else if (look === 'script')
      title = text(x, 'heading', k.title, {
        family: pick(x, ['Dancing Script', 'Pacifico', 'Lobster']),
        size: x.wide ? 190 : 150,
        color: WHITE,
        maxWidth: maxW,
        maxLines: 2,
        align,
        at: 0.8,
        shadow: { color: '#00000088', blur: 24, x: 0, y: 6 },
        textAnim: { in: { id: 'char-fade-in', duration: 1.5 } },
        anim: out,
      });
    else if (look === 'stacked')
      title = H(x, k.title, {
        size: x.wide ? 210 : 190,
        color: WHITE,
        maxWidth: where === 'bottom-left' ? maxW : x.s.w * 0.8,
        maxLines: 4,
        upper: true,
        track: 0.01,
        lh: 0.86,
        align,
        at: 0.8,
        textAnim: { in: { id: 'line-rise-in', duration: 1.1 } },
        anim: out,
      });
    else
      title = text(x, 'heading', k.title, {
        family: pick(x, ['DM Serif Display', 'Playfair Display', 'Abril Fatface']),
        weight: 400,
        italic: chance(x, 0.4),
        size: x.wide ? 170 : 140,
        color: WHITE,
        maxWidth: maxW,
        maxLines: 2,
        align,
        at: 0.8,
        lh: 0.98,
        textAnim: { in: { id: 'word-blur-in', duration: 1.3 } },
        anim: out,
      });
    const sub = B(x, k.sub, { size: 34, color: '#ffffffd0', maxWidth: maxW, maxLines: 2, align, at: 1.5, anim: anim(v.text, 0.8) });
    const credit = label(x, k.meta[0], { size: 22, color: accent, track: 0.34, align, at: 1.9, anim: anim('fade-in', 0.8) });
    const line = rule(x, { w: Math.min(220, tw(title) * 0.4), h: 3, color: accent, at: 1.2, anim: anim('wipe-center-in', 0.7) });
    const items = look === 'tracked' ? [kicker, title, sub, credit] : [kicker, title, sub, credit];
    const gaps = [34, 36, 34];
    const top = -x.hh + Math.max(x.s.my, bar + 50);
    const bottom = x.hh - Math.max(x.s.my, bar + 50);
    if (where === 'center') stackText(items, { cy: 0, gaps });
    else if (where === 'top') stackText(items, { top, gaps });
    else stackText(items, { bottom, gaps });
    if (align === 'left') for (const t of items) atLeft(t, -x.s.hw);
    line.transform.y = Math.round(credit.transform.y - th(credit) / 2 - 18);
    line.transform.x = align === 'left' ? Math.round(-x.s.hw + line.shape.width / 2) : 0;
    add(x, kicker, title, sub, line, credit);
    if (chance(x, 0.6)) {
      // Small technical details in the free corners.
      const tl = mono(x, `No. ${k.number}`, { size: 20, color: '#ffffffb0', at: 1, anim: anim('fade-in', 0.8) });
      const tr = mono(x, k.meta[1] ?? k.name, { size: 20, color: '#ffffffb0', at: 1, anim: anim('fade-in', 0.8) });
      atLeft(tl, -x.s.hw);
      atRight(tr, x.s.hw);
      if (where === 'top') {
        atBottom(tl, bottom);
        atBottom(tr, bottom);
      } else {
        atTop(tl, top);
        atTop(tr, top);
      }
      add(x, tl, tr);
    }
    add(x, filmLook(x, { grain: 0.2, vignette: 0.45 }));
  },
};

// ---------------------------------------------------------------------------------------------
// Swiss poster — a giant word bleeding off the grid, small information columns, one motif.
// ---------------------------------------------------------------------------------------------

export const swiss: Archetype = {
  id: 'swiss',
  name: 'Swiss Poster',
  categories: ['event', 'promo', 'title', 'intro', 'business', 'social'],
  tags: ['swiss', 'poster', 'typography', 'grid', 'bold', 'minimal', 'graphic'],
  fonts: ['grotesk-studio', 'impact-black', 'modern-bold', 'gallery-syne', 'signal-mono', 'geometric-pop', 'headline-condensed'],
  palettes: (p) => vividPalette(p),
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['crisp', 'kinetic', 'typed']);
    const { paper, ink } = paperInk(x);
    const sig = signals(x)[0];
    const inverse = chance(x, 0.4);
    const bg = inverse ? sig : paper;
    const fg = inverse ? inkOn(x, sig, 4.5) : ink;
    const hot = inverse ? (luminance(sig) > 0.4 ? ink : paper) : signalOn(x, paper, 2.6);
    add(x, solid(x, bg));
    if (chance(x, 0.5)) add(x, generator(x, 'grid-lines', { colorBg: bg, colorA: mix(bg, fg, 0.12), size: 90, major: 4, lineWidth: 1, fade: 0 }, { name: 'Grid' }));
    const placement = pick(x, x.portrait ? (['bottom', 'top', 'vertical'] as const) : (['bottom', 'top', 'letter'] as const));
    const word = placement === 'letter' ? k.accent.charAt(0).toUpperCase() : k.accent.toUpperCase();
    const giantColor = chance(x, 0.5) ? hot : fg;
    const other = giantColor === hot ? fg : hot;
    const outro = anim(undefined, 0, 'fade-out', 0.4);
    // The giant word, and the region left for everything else.
    let big: Txt;
    let L = -x.s.hw;
    let R = x.s.hw;
    let top = -x.hh + x.s.my;
    let bottom = x.hh - x.s.my;
    if (placement === 'vertical') {
      big = giant(x, 'heading', word, x.ch * 0.96, { color: giantColor, upper: true, track: -0.02, at: 0.2, maxH: x.cw * 0.42, textAnim: { in: { id: 'char-slide-in', duration: 0.9 } }, anim: outro });
      big.transform.rotation = -90;
      big.transform.x = Math.round(-x.hw + th(big) * 0.44);
      L = -x.hw + th(big) * 0.86 + 30;
    } else if (placement === 'letter') {
      big = giant(x, 'heading', word, x.cw * 0.46, { color: giantColor, upper: true, at: 0.2, maxH: x.ch * 1.2, textAnim: { in: { id: 'char-zoom-in', duration: 0.9 } }, anim: outro });
      big.transform.x = Math.round(x.hw - tw(big) / 2 + tw(big) * 0.05);
      big.transform.y = Math.round(x.hh * 0.06);
      R = x.hw - tw(big) * 0.95 - 40;
    } else {
      big = giant(x, 'heading', word, x.cw * 1.06, {
        color: giantColor,
        upper: true,
        track: -0.03,
        at: 0.2,
        maxH: x.ch * (x.portrait ? 0.3 : 0.46),
        textAnim: { in: { id: v.title, duration: 1 } },
        anim: outro,
      });
      big.transform.x = Math.round(-x.hw + tw(big) / 2 - tw(big) * 0.015);
      const h = th(big);
      if (placement === 'bottom') {
        big.transform.y = Math.round(x.hh - h * 0.5 + h * 0.12);
        bottom = x.hh - h * 0.86 - 30;
      } else {
        big.transform.y = Math.round(-x.hh + h * 0.5 - h * 0.1);
        top = -x.hh + h * 0.9 + 30;
      }
    }
    const W = R - L;
    // Information columns + rule: at the top (or at the bottom when the giant word is on top).
    const cols = W > 1100 ? 3 : 2;
    const colW = (W - (cols - 1) * 36) / cols;
    const info = [`${k.kicker}\n${k.name}`, `${k.meta[0] ?? ''}\n${k.meta[1] ?? ''}`, `${k.number}\n${k.numberLabel}`].slice(0, cols);
    const infos = info.map((s, i) =>
      atLeft(B(x, s, { size: 24, color: fg, align: 'left', maxWidth: colW, maxLines: 3, weight: 500, at: 0.7 + i * 0.12, lh: 1.25, anim: anim(v.label, 0.5) }), L + i * (colW + 36)),
    );
    const infoH = Math.max(...infos.map(th));
    let ruleY: number;
    if (placement === 'top') {
      for (const t of infos) atBottom(t, bottom);
      ruleY = bottom - infoH - 24;
      bottom = ruleY - 40;
    } else {
      for (const t of infos) atTop(t, top);
      ruleY = top + infoH + 24;
      top = ruleY + 40;
    }
    const hr = rule(x, { w: W, h: 3, x: (L + R) / 2, y: ruleY, color: fg, at: 0.5, anim: anim('wipe-right-in', 0.7) });
    // Middle band: the headline, and a motif beside it.
    const band = Math.max(160, bottom - top);
    const cy = (top + bottom) / 2;
    const motifKind = pick(x, ['circle', 'square', 'cross', 'half', 'photo', 'photo', 'none'] as const);
    const ms = Math.round(Math.min(band * 0.9, W * 0.34));
    const useMotif = motifKind !== 'none' && ms > 140;
    // Tall frames stack the headline over a large motif; wide frames set them side by side.
    const stacked = x.portrait && band > 700;
    const titleW = useMotif && !stacked ? W - ms - 60 : W;
    const title = H(x, k.title, {
      size: x.wide ? 96 : stacked ? 116 : 84,
      color: fg,
      align: 'left',
      maxWidth: titleW,
      maxLines: 3,
      weight: 800,
      lh: 0.98,
      at: 0.9,
      textAnim: { in: { id: v.title, duration: 0.9 } },
      anim: outro,
    });
    atLeft(title, L);
    title.transform.y = Math.round(stacked ? top + th(title) / 2 : Math.min(cy, bottom - th(title) / 2));
    add(x, big, hr, ...infos, title);
    let cy2 = cy;
    let ms2 = ms;
    if (stacked) {
      const free = bottom - (top + th(title) + 60);
      ms2 = Math.round(Math.min(W * 0.8, free * 0.9));
      cy2 = top + th(title) + 60 + free / 2;
    }
    if (useMotif && ms2 > 140) {
      const ms = ms2;
      const cy = cy2;
      const mx = stacked ? R - ms / 2 : R - ms / 2;
      const mAnim = anim(v.shape, 0.7);
      if (motifKind === 'circle') add(x, ellipse(x, { w: ms, h: ms, x: mx, y: cy, fill: other, at: 0.5, anim: mAnim, name: 'Circle' }));
      else if (motifKind === 'square') add(x, rect(x, { w: ms, h: ms, x: mx, y: cy, fill: other, at: 0.5, anim: mAnim, name: 'Square' }));
      else if (motifKind === 'cross') add(x, shape(x, 'cross', { w: ms, h: ms, x: mx, y: cy, fill: other, at: 0.5, anim: mAnim, name: 'Cross' }));
      else if (motifKind === 'half')
        add(
          x,
          path(
            x,
            [
              { x: 0, y: 1, outX: 0, outY: -0.55 },
              { x: 0.5, y: 0, inX: -0.28, inY: 0, outX: 0.28, outY: 0 },
              { x: 1, y: 1, inX: 0, inY: -0.55 },
            ],
            { w: ms, h: ms / 2, x: mx, y: cy, fill: other, at: 0.5, anim: mAnim, name: 'Half circle' },
          ),
        );
      else add(x, photo(x, { w: Math.round(ms * 0.8), h: ms, x: R - ms * 0.4, y: cy, bw: true, at: 0.5, anim: anim(v.photo, 0.8), push: true, name: 'Photo' }));
    } else if (k.number.length <= 5) {
      const idx = H(x, k.number, { size: Math.min(150, band * 0.6), color: other, weight: 800, at: 1.1, anim: anim(v.text, 0.6) });
      atRight(idx, R);
      idx.transform.y = title.transform.y;
      if (tw(idx) + tw(title) + 60 < W) add(x, idx);
    }
    add(x, filmLook(x, { grain: 0.1, vignette: 0 }));
  },
};

// ---------------------------------------------------------------------------------------------
// Editorial — a magazine spread: masthead, serif headline, framed photograph, barcode.
// ---------------------------------------------------------------------------------------------

export const editorial: Archetype = {
  id: 'editorial',
  name: 'Editorial',
  categories: ['social', 'title', 'business', 'vlog', 'news', 'quote'],
  tags: ['editorial', 'magazine', 'serif', 'elegant', 'photo', 'minimal'],
  fonts: ['serif-journal', 'editorial', 'fashion-fatface', 'playfair-modern', 'maison-luxe'],
  palettes: (p) => lightPalette(p),
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['editorial', 'calm', 'crisp']);
    const { paper, ink } = paperInk(x);
    const accent = signalOn(x, paper, 2.6);
    add(x, solid(x, paper));
    add(x, generator(x, 'paper', { colorA: paper, colorB: mix(paper, ink, 0.06) }, { name: 'Paper', opacity: 0.8 }));
    // Masthead.
    const mastY = -x.hh + x.s.my * 0.85;
    const mName = label(x, k.name, { size: 24, color: ink, track: 0.3, at: 0.3, anim: anim('fade-in', 0.6) });
    const mDate = mono(x, k.meta[0] ?? k.kicker, { size: 20, color: ink, at: 0.4, anim: anim('fade-in', 0.6) });
    atLeft(mName, -x.s.hw).transform.y = Math.round(mastY);
    atRight(mDate, x.s.hw).transform.y = Math.round(mastY);
    const mRule = rule(x, { w: x.s.w, h: 2, y: mastY + 34, color: ink, at: 0.3, anim: anim('wipe-right-in', 0.8) });
    add(x, mName, mDate, mRule);
    // Photo.
    const frame = pick(x, ['rect', 'capsule', 'circle', 'rect'] as const);
    const side = x.wide ? pick(x, ['left', 'right'] as const) : 'top';
    const pw = x.wide ? Math.round(x.cw * 0.34) : Math.round(x.s.w * (frame === 'circle' ? 0.62 : x.tall ? 0.86 : 0.6));
    const ph = frame === 'circle' ? pw : x.wide ? Math.round(x.ch * 0.66) : Math.round(Math.min(x.ch * (x.tall ? 0.42 : 0.4), pw * 1.25));
    const px = side === 'left' ? -x.s.hw + pw / 2 : side === 'right' ? x.s.hw - pw / 2 : 0;
    const py = x.wide ? 40 : -x.hh + x.s.my + 70 + ph / 2;
    const pic = photo(x, {
      w: pw,
      h: ph,
      x: px,
      y: py,
      kind: frame === 'circle' ? 'ellipse' : 'rect',
      radius: frame === 'capsule' ? pw / 2 : 0,
      bw: chance(x, 0.45),
      push: true,
      at: 0.5,
      anim: anim(v.photo, 0.9),
      border: chance(x, 0.4) ? { color: ink, width: 3 } : undefined,
    });
    add(x, pic);
    // Headline: the title, then its accent word large and italic.
    const textW = x.wide ? x.s.w - pw - 90 : x.s.w;
    const tx = x.wide ? (side === 'left' ? x.s.hw - textW / 2 : -x.s.hw + textW / 2) : 0;
    const align = x.wide ? 'left' : chance(x, 0.5) ? 'left' : 'center';
    const kick = label(x, k.kicker, { size: 24, color: accent, track: 0.3, align, at: 0.8, anim: anim(v.label, 0.6) });
    // The accent word set large and italic, when it ends the title.
    const ends = k.title.toLowerCase().endsWith(k.accent.toLowerCase()) && k.title.length > k.accent.length + 2;
    const rest = ends ? k.title.slice(0, k.title.length - k.accent.length).trim() : '';
    const t1 = H(x, rest || k.title, {
      size: x.wide ? 96 : 88,
      color: ink,
      maxWidth: textW,
      maxLines: 3,
      align,
      at: 1,
      lh: 1,
      textAnim: { in: { id: v.title, duration: 1 } },
      anim: anim(undefined, 0, 'fade-out', 0.4),
    });
    const t2 = rest
      ? text(x, 'heading', k.accent, {
          family: pick(x, ['Playfair Display', 'DM Serif Display']),
          italic: true,
          weight: 400,
          size: x.wide ? 150 : 132,
          color: accent,
          maxWidth: textW,
          maxLines: 1,
          align,
          at: 1.35,
          anim: anim(v.text, 0.8),
        })
      : null;
    const sub = B(x, k.sub, { size: 30, color: mix(ink, paper, 0.25), maxWidth: textW * 0.92, maxLines: 3, align, at: 1.7, anim: anim('fade-in', 0.8) });
    const parts = t2 ? [kick, t1, t2, sub] : [kick, t1, sub];
    if (x.wide) stackText(parts, { cy: 50, gaps: [26, 6, 30] });
    else stackText(parts, { top: py + ph / 2 + 60, gaps: [22, 4, 24] });
    for (const t of parts) {
      if (align === 'left') atLeft(t, tx - textW / 2);
      else t.transform.x = Math.round(tx);
    }
    add(x, ...parts);
    // Footer: barcode, issue, page number.
    const fy = x.hh - x.s.my * 0.8;
    const bc = barcode(x, { w: 150, h: 54, x: x.s.hw - 75, y: fy - 10, color: ink, at: 1.2, anim: anim('fade-in', 0.6) });
    const issue = mono(x, `Vol. ${k.number.slice(0, 3)} — ${k.numberLabel}`, { size: 18, color: ink, at: 1.2, anim: anim('fade-in', 0.6) });
    atLeft(issue, -x.s.hw).transform.y = Math.round(fy);
    add(x, bc, issue);
    if (chance(x, 0.5)) {
      const st = ring(x, { w: 150, h: 150, x: px + (side === 'left' ? pw / 2 : -pw / 2) * 0.9, y: py - ph / 2 + 30, width: 3, color: accent, at: 1.6, anim: anim('spin-in', 0.8) });
      const stt = label(x, k.cta, { size: 18, color: accent, maxWidth: 110, maxLines: 2, track: 0.12, at: 1.7, x: st.transform.x, y: st.transform.y, rotation: -12, anim: anim('fade-in', 0.6) });
      if (x.wide) add(x, st, stt);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Cut-out collage — a person cut out over a loud colour, repeated words, tape, a burst badge.
// ---------------------------------------------------------------------------------------------

export const collage: Archetype = {
  id: 'collage',
  name: 'Cut-out Collage',
  categories: ['promo', 'social', 'youtube', 'event'],
  tags: ['collage', 'cutout', 'person', 'sale', 'tape', 'bold', 'paper'],
  fonts: ['impact-black', 'headline-condensed', 'modern-bold', 'poster', 'cinema-bebas', 'comic-pop', 'geometric-pop'],
  palettes: (p) => vividPalette(p),
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['punchy', 'kinetic', 'bouncy']);
    const sig = signals(x)[0];
    const fg = inkOn(x, sig, 3);
    add(x, solid(x, sig));
    if (chance(x, 0.5)) add(x, generator(x, 'halftone', { colorA: mix(sig, '#000000', 0.18), colorB: sig, size: 22 }, { name: 'Halftone', opacity: 0.5 }));
    // Repeated words behind.
    const word = k.accent.toUpperCase();
    const rows = x.portrait ? 6 : 4;
    const rowH = x.ch / rows;
    for (let i = 0; i < rows; i++) {
      const filled = i % 2 === 0;
      const w = giant(x, 'heading', word, x.cw * 1.04, {
        color: filled ? alpha(fg, 0.92) : '#00000000',
        stroke: filled ? undefined : { color: fg, width: 5 },
        upper: true,
        maxH: rowH * 1.05,
        at: 0.1 + i * 0.08,
        lh: 0.9,
        anim: anim(i % 2 ? 'slide-up-in' : 'wipe-right-in', 0.5),
        name: 'Repeat',
      });
      w.transform.y = Math.round(-x.hh + rowH * (i + 0.5));
      add(x, w);
    }
    // Torn paper + person.
    const flip = chance(x, 0.5);
    const pw = Math.round(x.portrait ? x.cw * 0.86 : x.cw * 0.4);
    const ph = Math.round(x.ch * (x.portrait ? 0.62 : 0.88));
    const px = x.portrait ? 0 : (flip ? 1 : -1) * x.cw * 0.12;
    const py = x.hh - ph / 2;
    const paperCol = mix('#ffffff', sig, 0.08);
    add(x, torn(x, { w: pw * 0.95, h: ph * 0.7, x: px + 30, y: py + ph * 0.1, color: paperCol, rotation: between(x, -6, 6), at: 0.4, anim: anim('pop-in', 0.5) }));
    add(x, person(x, { w: pw, h: ph, x: px, y: py, at: 0.6, outline: WHITE, anim: anim(v.photo, 0.6) }));
    // Tape strips with words.
    const tapeCol = chance(x, 0.5) ? '#111111' : '#f5f1e8';
    const tapeInk = tapeCol === '#111111' ? '#ffffff' : '#111111';
    const ta = between(x, 8, 16);
    for (const [i, ang] of [
      [0, -ta],
      [1, ta * 0.6],
    ] as const) {
      // Low across the body, clear of the face.
      const ty = x.hh * (x.portrait ? 0.66 + i * 0.2 : 0.56 + i * 0.26);
      add(x, ...tape(x, { w: x.cw * 1.3, h: x.portrait ? 92 : 78, x: 0, y: ty, rotation: ang, color: tapeCol, ink: tapeInk, words: `${k.kicker}`.toUpperCase(), at: 1 + i * 0.2 }));
    }
    // Burst badge.
    const bs = Math.round(Math.min(x.cw, x.ch) * 0.3);
    const bx = x.portrait ? x.s.hw - bs / 2 + 20 : (flip ? -1 : 1) * (x.s.hw - bs / 2);
    const by = x.portrait ? -x.hh * 0.38 : -x.hh * 0.42;
    const badgeFill = luminance(sig) > 0.45 ? '#141414' : '#ffffff';
    const burst = shape(x, 'burst', { w: bs, h: bs, x: bx, y: by, fill: badgeFill, rotation: 12, at: 1.4, anim: anim('twist-pop-in', 0.6, 'fade-out', 0.4, 'spin', 14), name: 'Badge' });
    const bt = H(x, `${k.number}`, { size: Math.round(bs * 0.3), color: sig, upper: true, at: 1.55, x: bx, y: by - bs * 0.06, rotation: 12, anim: anim('pop-in', 0.4) });
    const bl = label(x, k.numberLabel, {
      size: Math.round(bs * 0.075),
      color: inkOn(x, badgeFill),
      maxWidth: bs * 0.6,
      maxLines: 2,
      x: bx,
      y: by + bs * 0.16,
      rotation: 12,
      at: 1.6,
      anim: anim('fade-in', 0.4),
    });
    add(x, burst, bt, bl);
    // Title strip.
    const title = H(x, k.title, {
      size: x.wide ? 80 : 72,
      color: fg,
      maxWidth: x.portrait ? x.s.w : x.cw * 0.38,
      maxLines: 3,
      upper: true,
      align: x.portrait ? 'center' : flip ? 'left' : 'right',
      at: 1.8,
      bg: { color: luminance(sig) > 0.45 ? '#141414' : '#ffffff', opacity: 1, padX: 18, padY: 8, radius: 0 },
      anim: anim(v.text, 0.5),
    });
    title.text.fill = { type: 'solid', color: luminance(sig) > 0.45 ? '#ffffff' : '#141414' };
    if (x.portrait) atTop(title, -x.hh + x.s.my);
    else {
      if (flip) atLeft(title, -x.s.hw);
      else atRight(title, x.s.hw);
      title.transform.y = Math.round(x.hh * 0.05);
    }
    add(x, title);
    add(
      x,
      sticker(x, 'arrow-curved-sketch', {
        size: 150,
        x: x.portrait ? -x.s.hw + 90 : (flip ? -1 : 1) * x.hw * 0.42,
        y: x.portrait ? -x.hh * 0.12 : x.hh * 0.42,
        rotation: flip ? 0 : 180,
        colors: [fg],
        at: 2,
      }),
    );
  },
};

// ---------------------------------------------------------------------------------------------
// Product hero — the product on a coloured stage, a word split around it, price and features.
// ---------------------------------------------------------------------------------------------

export const product: Archetype = {
  id: 'product',
  name: 'Product Hero',
  categories: ['promo', 'business', 'social'],
  tags: ['product', 'ad', 'shop', 'launch', 'price', 'commerce'],
  fonts: ['impact-black', 'grotesk-studio', 'modern-bold', 'geometric-pop', 'headline-condensed', 'friendly-round', 'gallery-syne'],
  duration: 6,
  poster: 0.6,
  build(x, k) {
    const v = voice(x, ['bouncy', 'punchy', 'crisp', 'calm']);
    const c = x.c;
    const sig = signals(x)[0];
    const light = chance(x, 0.5);
    const bg = light ? mix(c.bg, '#ffffff', c.dark ? 0.9 : 0.3) : c.dark ? c.bg : mix(sig, '#000000', 0.15);
    const fg = inkOn(x, bg);
    add(x, solid(x, bg));
    add(x, generator(x, 'radial-glow', { colorA: mix(bg, '#ffffff', 0.25), colorB: bg, centerX: 0.5, centerY: 0.45, radius: 0.8, speed: 0.3 }, { name: 'Light' }));
    const stage = pick(x, ['circle', 'arch', 'ring', 'blob'] as const);
    const S = Math.round(Math.min(x.cw, x.ch) * (x.portrait ? 0.78 : 0.7));
    const cy = x.portrait ? -x.hh * 0.06 : 20;
    const stageCol = contrastPick(sig, bg) ? sig : mix(sig, fg, 0.3);
    if (stage === 'circle') add(x, ellipse(x, { w: S, h: S, y: cy, fill: stageCol, at: 0.2, anim: anim('zoom-in', 0.7), name: 'Stage' }));
    else if (stage === 'arch') add(x, rect(x, { w: S * 0.8, h: S * 1.1, y: cy + S * 0.1, radius: S * 0.4, fill: stageCol, at: 0.2, anim: anim('rise-in', 0.7), name: 'Stage' }));
    else if (stage === 'ring') add(x, ring(x, { w: S, h: S, y: cy, width: Math.round(S * 0.08), color: stageCol, at: 0.2, anim: anim('spin-in', 0.8), name: 'Stage' }));
    else add(x, shape(x, 'blob', { w: S * 1.1, h: S, y: cy, fill: stageCol, at: 0.2, anim: anim('elastic-in', 0.8, 'fade-out', 0.4, 'breathe', 4), name: 'Stage' }));
    if (chance(x, 0.45)) add(x, ribbon(x, { color: linear(0, alpha(c.secondary, 0.95), alpha(c.accent, 0.95)), thickness: x.ch * 0.07, at: 0.4, y: cy }));
    // Word split around the product, or a headline above.
    const split = k.accent.length >= 4 && chance(x, 0.55);
    const prodW = Math.round(S * 0.62);
    const prodH = Math.round(S * 0.78);
    if (split) {
      const w = k.accent.toUpperCase();
      const cut = Math.ceil(w.length / 2);
      const halves = [w.slice(0, cut), w.slice(cut)];
      const size = x.portrait ? 0.3 : 0.24;
      halves.forEach((h, i) => {
        const t = giant(x, 'heading', h, x.cw * size * (h.length / Math.max(2, cut)), {
          color: fg,
          upper: true,
          at: 0.5 + i * 0.1,
          maxH: x.ch * 0.34,
          anim: anim(i ? 'slide-up-in' : 'slide-up-in', 0.6),
        });
        t.transform.y = cy;
        if (i === 0) atRight(t, -prodW * 0.42);
        else atLeft(t, prodW * 0.42);
        add(x, t);
      });
    } else {
      const t = H(x, k.title, {
        size: x.wide ? 96 : 86,
        color: fg,
        maxWidth: x.s.w * 0.9,
        maxLines: 2,
        upper: chance(x, 0.5),
        at: 0.5,
        textAnim: { in: { id: v.title, duration: 0.9 } },
        anim: anim(undefined, 0, 'fade-out', 0.4),
      });
      atTop(t, -x.hh + x.s.my * 0.9);
      add(x, t);
    }
    add(x, photo(x, { name: 'Product', w: prodW, h: prodH, y: cy, radius: 28, shadow: true, at: 0.7, anim: anim(v.photo, 0.7, 'fade-out', 0.4, 'float', 4) }));
    // Price + features + CTA.
    const price = pill(x, `${k.number}`, { size: x.portrait ? 44 : 40, fill: fg, color: bg, at: 1.3, upper: false, weight: 800, anim: anim('pop-in', 0.45) });
    const pxp = x.portrait ? x.s.hw - price.w / 2 : prodW * 0.5 + price.w * 0.35;
    const pyp = cy - prodH * 0.42;
    place([price.box, price.label], pxp, pyp);
    price.box.transform.rotation = -8;
    price.label.transform.rotation = -8;
    add(x, price.box, price.label);
    const cta = pill(x, k.cta, { size: 30, fill: sig, at: 1.9, anim: anim('pop-in', 0.45) });
    const fy = x.hh - x.s.my * (x.portrait ? 1 : 0.9);
    if (x.wide && !split) {
      k.points.forEach((p, i) => {
        const dot = ellipse(x, { w: 18, h: 18, fill: sig, at: 1.4 + i * 0.15, anim: anim('pop-in', 0.3) });
        const t = B(x, p, { size: 28, color: fg, weight: 600, align: 'left', at: 1.45 + i * 0.15, anim: anim('slide-up-in', 0.4) });
        atLeft(t, -x.s.hw + 34);
        t.transform.y = Math.round(cy + (i - 1) * 64);
        dot.transform.x = Math.round(-x.s.hw + 9);
        dot.transform.y = t.transform.y;
        add(x, dot, t);
      });
      place([cta.box, cta.label], x.s.hw - cta.w / 2, fy - cta.h / 2);
    } else {
      const pts = B(x, k.points.join('  ·  '), { size: 30, color: fg, weight: 600, maxWidth: x.s.w, maxLines: 2, at: 1.5, anim: anim('fade-in', 0.5) });
      atBottom(pts, fy - cta.h - 30);
      place([cta.box, cta.label], 0, fy - cta.h / 2);
      add(x, pts);
    }
    add(x, cta.box, cta.label);
  },
};

function contrastPick(a: string, b: string): boolean {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) >= 1.6;
}

// ---------------------------------------------------------------------------------------------
// Word stack — huge words filling the width, one line at a time.
// ---------------------------------------------------------------------------------------------

export const stack: Archetype = {
  id: 'stack',
  name: 'Word Stack',
  categories: ['promo', 'social', 'intro', 'title', 'youtube', 'event'],
  tags: ['kinetic', 'typography', 'bold', 'words', 'type', 'loud'],
  fonts: ['headline-condensed', 'impact-black', 'cinema-bebas', 'poster', 'modern-bold', 'bulletin-oswald', 'grotesk-studio'],
  duration: 5,
  poster: 0.7,
  build(x, k) {
    const v = voice(x, ['punchy', 'kinetic', 'crisp']);
    const sig = signals(x)[0];
    const mode = pick(x, ['signal', 'dark', 'paper'] as const);
    const { paper, ink } = paperInk(x);
    const bg = mode === 'signal' ? sig : mode === 'dark' ? '#0d0d0f' : paper;
    const fg = inkOn(x, bg, 4);
    const hot = mode === 'signal' ? (luminance(sig) > 0.45 ? '#111111' : '#ffffff') : signalOn(x, bg, 3);
    add(x, solid(x, bg));
    const words = k.title.toUpperCase().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (const w of words) {
      const last = lines[lines.length - 1];
      if (last && last.length + w.length < 7) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    const align = pick(x, ['left', 'center', 'justify'] as const);
    const W = x.s.w * (x.portrait ? 1 : 0.86);
    const maxH = (x.s.h * 0.82) / lines.length;
    const accentIdx = Math.max(
      0,
      lines.findIndex((l) => l.includes(k.accent.toUpperCase())),
    );
    const hiStyle = pick(x, ['box', 'outline', 'color', 'serif'] as const);
    const ts: Txt[] = lines.map((l, i) => {
      const isAccent = i === accentIdx;
      const serif = isAccent && hiStyle === 'serif';
      const t = serif
        ? giant(x, 'heading', l.charAt(0) + l.slice(1).toLowerCase(), align === 'justify' ? W : W * 0.7, {
            family: pick(x, ['Playfair Display', 'DM Serif Display']),
            italic: true,
            color: hot,
            maxH,
            at: 0.25 + i * 0.28,
            anim: anim('blur-in', 0.5, 'fade-out', 0.3),
          })
        : giant(x, 'heading', l, align === 'justify' ? W : Math.min(W, W * (0.45 + l.length * 0.08)), {
            upper: true,
            color: isAccent && hiStyle === 'outline' ? '#00000000' : isAccent && hiStyle === 'color' ? hot : isAccent && hiStyle === 'box' ? bg : fg,
            stroke: isAccent && hiStyle === 'outline' ? { color: fg, width: 6 } : undefined,
            maxH,
            lh: 0.9,
            at: 0.25 + i * 0.28,
            textAnim: { in: { id: v.title, duration: 0.5 } },
            anim: anim(undefined, 0, 'fade-out', 0.3),
          });
      return t;
    });
    stackText(ts, { cy: x.portrait ? -20 : 10, gap: 6 });
    for (const t of ts) {
      if (align === 'left') atLeft(t, -x.s.hw);
      else t.transform.x = 0;
    }
    ts.forEach((t, i) => {
      if (i === accentIdx && hiStyle === 'box')
        add(x, rect(x, { w: tw(t) + 40, h: th(t) * 0.92, x: t.transform.x, y: t.transform.y, fill: fg, at: t.start - 0.05, anim: anim('wipe-right-in', 0.35, 'fade-out', 0.3), name: 'Highlight' }));
      add(x, t);
    });
    const top = label(x, k.kicker, { size: 26, color: fg, at: 0.1, align: 'left', anim: anim('fade-in', 0.4) });
    atTop(atLeft(top, -x.s.hw), -x.hh + x.s.my * 0.7);
    const handle = mono(x, k.meta[0] ?? k.name, { size: 22, color: fg, at: 0.1, anim: anim('fade-in', 0.4) });
    atTop(atRight(handle, x.s.hw), top.transform.y - th(top) / 2);
    const foot = label(x, `${k.cta}  →`, { size: 26, color: hot, at: 0.4 + lines.length * 0.28, anim: anim('slide-up-in', 0.4) });
    atBottom(atLeft(foot, -x.s.hw), x.hh - x.s.my * 0.7);
    add(x, top, handle, foot);
    if (chance(x, 0.5)) add(x, filmLook(x, { grain: 0.12, vignette: 0 }));
    void ink;
  },
};
