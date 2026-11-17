import { kf, linear, makeGenerator, makeShape, makeSlot, makeSticker, radial } from '@/core/factory';
import type { Clip, Keyframe, ShapeClip } from '@/core/types';
import type { TemplateDef } from '../types';
import { accentOn, an, atLeft, copy, inkOn, label, life, mutedOn, slotFill, title, tone, type MText } from './_lib/a-kit';
import { alpha, chance, mix, pick, safeArea, stack } from './_lib/kit';

const CLEAR = '#00000000';

/** Keyframes that move a layer around a circle (linear segments, smooth at this density). */
function orbit(cx: number, cy: number, r: number, period: number, dur: number, phase: number, tilt = 0.32): { x: Keyframe[]; y: Keyframe[] } {
  const steps = Math.max(8, Math.ceil((dur / period) * 36));
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (dur * i) / steps;
    const a = phase + (t / period) * Math.PI * 2;
    x.push(kf(t, Math.round((cx + Math.cos(a) * r) * 10) / 10, 'linear'));
    y.push(kf(t, Math.round((cy + Math.sin(a) * r * tilt) * 10) / 10, 'linear'));
  }
  return { x, y };
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-aurora-rise',
    name: 'Aurora Rise',
    category: 'intro',
    tags: ['intro', 'opener', 'aurora', 'gradient', 'brand', 'modern'],
    duration: 6,
    poster: 0.55,
    music: { soundId: 'music-cinematic-pad' },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const leftLayout = !env.portrait && chance(env.rng, 0.45);
      const align = leftLayout ? 'left' : 'center';
      const w = leftLayout ? Math.min(safe.w * 0.72, 1180) : Math.min(safe.w, 1500);
      const x0 = -env.cw / 2 + safe.mx + 64;
      const accent = accentOn(env, c.bg);

      const bg = makeGenerator('aurora', {
        name: 'Aurora',
        duration: d,
        params: { colorA: tone(c.primary, c.bg, 0.18), colorB: tone(c.secondary, c.bg, 0.32), colorC: tone(c.accent, c.bg, 0.45), colorBg: c.bg, speed: 0.7 },
      });
      const vignette = makeShape('rect', { name: 'Vignette', duration: d, width: env.cw * 1.1, height: env.ch * 1.1, fill: radial(alpha(c.bg, 0), alpha(c.bg, 0.5)) });

      const kicker = label(env, 'Welcome to', {
        name: 'Kicker',
        ...life(env, 0.35, 0.2),
        size: 30,
        weight: 600,
        track: 0.3,
        color: accent,
        style: { align },
        anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4),
      });
      const head = title(env, 'Northern Lights Studio', {
        name: 'Title',
        ...life(env, 0.55),
        size: env.portrait ? 172 : 168,
        maxWidth: w,
        maxLines: env.portrait ? 3 : 2,
        style: { align },
        textAnim: { in: { id: 'char-rise-in', duration: 1.1 } },
        anim: an(undefined, 0, 'blur-out', 0.55),
      });
      const sub = copy(env, 'Stories crafted with light, colour and motion', {
        name: 'Subtitle',
        ...life(env, 1.25, 0.1),
        size: 44,
        color: c.textMuted,
        maxWidth: Math.min(w, 1000),
        maxLines: 2,
        style: { align },
        anim: an('soft-slide-up-in', 0.7, 'fade-out', 0.45),
      });
      // Brand logo above the stack (filled from the brand kit, else a drop-in placeholder).
      const L = env.portrait ? 190 : 140;
      const logo = makeSlot({ name: 'Logo', ...life(env, 0.15, 0.15), width: L, height: L, radius: Math.round(L * 0.24), fill: slotFill(env), anim: an('zoom-soft-in', 0.8, 'fade-out', 0.45) });
      const total = stack(
        [
          { clip: logo, height: L, gap: 44 },
          { clip: kicker, height: kicker.metrics.height, gap: 30 },
          { clip: head, height: head.metrics.height, gap: 36 },
          { clip: sub, height: sub.metrics.height },
        ],
        { centerY: -10 },
      );

      const deco: Clip[] = [];
      if (leftLayout) {
        for (const t of [kicker, head, sub]) atLeft(t, x0);
        logo.transform.x = Math.round(x0 + L / 2);
        deco.push(
          makeShape('rect', {
            name: 'Accent bar',
            ...life(env, 0.2, 0.25),
            width: 8,
            // Spans the text (not the logo above it).
            height: Math.round(total - L - 44 + 20),
            radius: 4,
            x: x0 - 52,
            y: Math.round((kicker.transform.y - kicker.metrics.height / 2 + sub.transform.y + sub.metrics.height / 2) / 2),
            fill: linear(90, c.primary, c.secondary),
            anim: an('wipe-down-in', 0.8, 'wipe-up-out', 0.5),
          }),
        );
      } else {
        const off = kicker.metrics.inkWidth / 2 + 30 + 40;
        for (const side of [-1, 1]) {
          deco.push(
            makeShape('rect', {
              name: side < 0 ? 'Rule left' : 'Rule right',
              ...life(env, 0.3, 0.2),
              width: 80,
              height: 3,
              radius: 2,
              x: side * off,
              y: kicker.transform.y,
              fill: accent,
              anim: an(side < 0 ? 'wipe-left-in' : 'wipe-right-in', 0.6, 'fade-out', 0.4),
            }),
          );
        }
      }
      const foot = label(env, 'Episode 01  ·  Premiere', {
        name: 'Footer',
        ...life(env, 1.7, 0.15),
        size: 24,
        color: mutedOn(env, c.bg),
        track: 0.24,
        style: { align },
        anim: an('fade-in', 0.7, 'fade-out', 0.4),
      });
      foot.transform.y = Math.round(env.ch / 2 - safe.my - foot.metrics.height / 2);
      if (leftLayout) atLeft(foot, x0);

      return [bg, vignette, ...deco, logo, kicker, head, sub, foot];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-split-reveal',
    name: 'Split Reveal',
    category: 'intro',
    tags: ['intro', 'opener', 'split', 'photo', 'editorial', 'episode'],
    duration: 6,
    poster: 0.6,
    music: { soundId: 'music-acoustic-pluck' },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const flip = chance(env.rng, 0.5);
      const panel = pick(env.rng, [c.primary, c.bg2, c.surface]);
      const ink = inkOn(env, panel);
      const kick = panel === c.primary ? ink : accentOn(env, panel);
      const wide = env.cw > env.ch * 1.2;
      const clips: Clip[] = [makeShape('rect', { name: 'Backdrop', duration: d, width: env.cw, height: env.ch, fill: c.bg })];

      // Geometry: the photo takes one side (landscape) or the top (tall / square frames).
      let slotBox: { x: number; y: number; w: number; h: number };
      let panelBox: { x: number; y: number; w: number; h: number };
      if (wide) {
        const sw = Math.round(env.cw * 0.56);
        const pw = env.cw - sw;
        const s = flip ? 1 : -1;
        slotBox = { x: s * (env.cw / 2 - sw / 2), y: 0, w: sw, h: env.ch };
        panelBox = { x: -s * (env.cw / 2 - pw / 2), y: 0, w: pw, h: env.ch };
      } else {
        const sh = Math.round(env.ch * (env.portrait ? 0.56 : 0.5));
        const ph = env.ch - sh;
        slotBox = { x: 0, y: -env.ch / 2 + sh / 2, w: env.cw, h: sh };
        panelBox = { x: 0, y: env.ch / 2 - ph / 2, w: env.cw, h: ph };
      }
      const slotIn = wide ? (flip ? 'wipe-left-in' : 'wipe-right-in') : 'wipe-down-in';
      const slotOut = wide ? (flip ? 'wipe-right-out' : 'wipe-left-out') : 'wipe-up-out';
      const panelIn = wide ? (flip ? 'wipe-right-in' : 'wipe-left-in') : 'wipe-up-in';
      const panelOut = wide ? (flip ? 'wipe-left-out' : 'wipe-right-out') : 'wipe-down-out';
      clips.push(
        makeSlot({ name: 'Photo', ...life(env, 0.1, 0.05), width: slotBox.w, height: slotBox.h, x: slotBox.x, y: slotBox.y, fill: slotFill(env), anim: an(slotIn, 0.9, slotOut, 0.6) }),
        makeShape('rect', { name: 'Panel', ...life(env, 0.3), width: panelBox.w, height: panelBox.h, x: panelBox.x, y: panelBox.y, fill: panel, anim: an(panelIn, 0.8, panelOut, 0.6) }),
      );
      // Seam accent along the shared edge.
      const seamColor = panel === c.primary ? c.secondary : c.primary;
      if (wide) {
        const seamX = panelBox.x - Math.sign(panelBox.x) * (panelBox.w / 2);
        clips.push(makeShape('rect', { name: 'Seam', ...life(env, 0.75, 0.1), width: 14, height: env.ch, x: seamX, fill: seamColor, anim: an('wipe-down-in', 0.7, 'wipe-up-out', 0.5) }));
      } else {
        const seamY = panelBox.y - panelBox.h / 2;
        clips.push(makeShape('rect', { name: 'Seam', ...life(env, 0.75, 0.1), width: env.cw, height: 14, y: seamY, fill: seamColor, anim: an('wipe-right-in', 0.7, 'wipe-left-out', 0.5) }));
      }

      const pad = wide ? 96 : safe.mx;
      const tw = panelBox.w - pad * 2;
      const left = panelBox.x - panelBox.w / 2 + pad;
      const kicker = label(env, 'Episode 01', { name: 'Kicker', ...life(env, 0.9, 0.75), size: 28, weight: 700, track: 0.26, color: kick, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const head = title(env, 'The Making of a Maker', {
        name: 'Title',
        ...life(env, 1.0, 0.65),
        size: wide ? 118 : env.aspect === '9:16' ? 132 : 100,
        color: ink,
        maxWidth: tw,
        maxLines: 3,
        style: { align: 'left' },
        textAnim: { in: { id: 'word-rise-in', duration: 1.0 } },
        anim: an(undefined, 0, 'soft-slide-down-out', 0.45),
      });
      const sub = copy(env, 'A short documentary about craft, patience and the joy of building things.', {
        name: 'Subtitle',
        ...life(env, 1.5, 0.6),
        size: wide ? 36 : 38,
        color: mutedOn(env, panel),
        maxWidth: Math.min(tw, 760),
        maxLines: env.aspect === '9:16' || wide ? 3 : 2,
        style: { align: 'left' },
        anim: an('soft-slide-up-in', 0.7, 'fade-out', 0.4),
      });
      const rule = makeShape('rect', { name: 'Rule', ...life(env, 1.3, 0.7), width: 120, height: 6, radius: 3, fill: seamColor === c.secondary ? accentOn(env, panel) : seamColor, anim: an('wipe-right-in', 0.6, 'fade-out', 0.4) });
      const textTop = wide ? panelBox.y : panelBox.y - (env.aspect === '9:16' ? 40 : 0);
      stack(
        [
          { clip: kicker, height: kicker.metrics.height, gap: 26 },
          { clip: head, height: head.metrics.height, gap: 34 },
          { clip: rule, height: 6, gap: 34 },
          { clip: sub, height: sub.metrics.height },
        ],
        { centerY: textTop },
      );
      for (const t of [kicker, head, sub]) atLeft(t, left);
      rule.transform.x = Math.round(left + 60);
      clips.push(kicker, head, rule, sub);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-spotlight-stage',
    name: 'Spotlight Stage',
    category: 'intro',
    tags: ['intro', 'cinematic', 'film', 'spotlight', 'presents', 'trailer'],
    duration: 7,
    poster: 0.6,
    music: { soundId: 'music-ambient-drone', volume: 0.9 },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const w = Math.min(safe.w, 1440);
      const stage = c.dark ? c.bg : c.bg2;
      const lamp = c.dark ? tone(c.primary, c.bg, 0.62) : '#ffffff';
      const ink = inkOn(env, c.dark ? stage : mix(stage, lamp, 0.5));
      const ornaments = pick(env.rng, ['rules', 'diamonds'] as const);

      const bg = makeGenerator('spotlight', {
        name: 'Spotlight',
        duration: d,
        params: { colorBg: stage, colorA: lamp, posX: 0.5, posY: 0.5, radius: env.portrait ? 0.46 : 0.4, softness: 0.7, haze: 0.3, speed: 0.6 },
      });
      const kicker = label(env, 'Jordan Lee presents', {
        name: 'Presents',
        ...life(env, 0.4, 0.35),
        size: 28,
        track: 0.32,
        color: ink,
        maxWidth: w,
        maxLines: 1,
        textAnim: { in: { id: 'tracking-in', duration: 1.4 } },
        anim: an(undefined, 0, 'fade-out', 0.5),
      });
      const head = title(env, 'The Long Road Home', {
        name: 'Title',
        ...life(env, 1.2),
        size: env.portrait ? 176 : 172,
        color: ink,
        maxWidth: w,
        maxLines: env.portrait ? 3 : 2,
        textAnim: { in: { id: 'char-blur-in', duration: 1.4 } },
        anim: an(undefined, 0, 'blur-out', 0.7),
      });
      const date = label(env, 'Coming this winter', {
        name: 'Release',
        ...life(env, 2.2, 0.2),
        size: 26,
        track: 0.4,
        color: ink,
        opacity: 0.8,
        anim: an('fade-in', 0.9, 'fade-out', 0.5),
      });
      const lineW = Math.min(w, Math.max(head.metrics.inkWidth + 140, 520));
      const ruleTop = makeShape('rect', { name: 'Rule top', ...life(env, 0.9, 0.3), width: lineW, height: 2, fill: alpha(ink, 0.55), anim: an('wipe-center-in', 1.0, 'wipe-center-out', 0.6) });
      const ruleBot = makeShape('rect', { name: 'Rule bottom', ...life(env, 1.0, 0.3), width: lineW, height: 2, fill: alpha(ink, 0.55), anim: an('wipe-center-in', 1.0, 'wipe-center-out', 0.6) });
      // The presenter's logo above "… presents" (brand kit), else a drop-in placeholder.
      const L = env.portrait ? 150 : 112;
      const logo = makeSlot({ name: 'Logo', ...life(env, 0.2, 0.35), width: L, height: L, radius: Math.round(L * 0.24), fill: slotFill(env), anim: an('fade-in', 1.0, 'fade-out', 0.5) });
      stack(
        [
          { clip: logo, height: L, gap: 40 },
          { clip: kicker, height: kicker.metrics.height, gap: 44 },
          { clip: ruleTop, height: 2, gap: 40 },
          { clip: head, height: head.metrics.height, gap: 40 },
          { clip: ruleBot, height: 2, gap: 44 },
          { clip: date, height: date.metrics.height },
        ],
        { centerY: 0 },
      );
      const clips: Clip[] = [bg, makeShape('rect', { name: 'Vignette', duration: d, width: env.cw * 1.1, height: env.ch * 1.1, fill: radial(alpha(stage, 0), alpha(stage, c.dark ? 0.7 : 0.35)) })];
      if (ornaments === 'rules') clips.push(ruleTop, ruleBot);
      else {
        for (const side of [-1, 1]) {
          clips.push(
            makeShape('diamond', {
              name: 'Ornament',
              ...life(env, 1.0, 0.3),
              width: 18,
              height: 18,
              x: side * Math.round(head.metrics.inkWidth / 2 + 56),
              y: head.transform.y,
              fill: accentOn(env, stage),
              anim: an('pop-in', 0.5, 'pop-out', 0.4),
            }),
          );
        }
        ruleTop.shape.width = Math.round(lineW * 0.35);
        ruleBot.shape.width = Math.round(lineW * 0.35);
        clips.push(ruleTop, ruleBot);
      }
      clips.push(logo, kicker, head, date);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-kinetic-stack',
    name: 'Kinetic Stack',
    category: 'intro',
    tags: ['intro', 'kinetic', 'bold', 'typography', 'blocks', 'energetic'],
    duration: 5,
    poster: 0.6,
    music: { soundId: 'music-future-bass', volume: 0.7 },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const words = pick(env.rng, [
        ['Dream', 'Build', 'Launch'],
        ['Plan', 'Create', 'Share'],
        ['Think', 'Make', 'Repeat'],
      ]);
      const stair = !env.portrait && chance(env.rng, 0.5);
      const fills = [c.primary, c.secondary, c.accent];
      const size = env.portrait ? 230 : env.square ? 190 : 200;
      const maxW = safe.w * (stair ? 0.62 : 0.86);

      const clips: Clip[] = [
        makeGenerator('stripes', {
          name: 'Stripes',
          duration: d,
          params: { colorA: c.bg, colorB: tone(c.bg2, c.bg, 0.35), angle: 45, width: 90, softness: 0.2, speed: 0.35 },
        }),
      ];
      const items: { block: ShapeClip; text: MText; h: number }[] = [];
      words.forEach((wd, i) => {
        const t0 = 0.2 + i * 0.28;
        const fill = fills[i];
        const text = title(env, wd, {
          name: `Word ${i + 1}`,
          ...life(env, t0 + 0.18, (2 - i) * 0.12 + 0.4),
          size,
          color: inkOn(env, fill),
          maxWidth: maxW,
          maxLines: 1,
          anim: an('mask-up-in', 0.55, 'mask-down-out', 0.4),
        });
        const padX = Math.round(text.metrics.height * 0.22);
        const padY = Math.round(text.metrics.height * 0.1);
        const bw = Math.round(text.metrics.inkWidth + padX * 2);
        const bh = Math.round(text.metrics.height + padY * 2);
        const block = makeShape('rect', {
          name: `Block ${i + 1}`,
          ...life(env, t0, (2 - i) * 0.12 + 0.05),
          width: bw,
          height: bh,
          fill,
          anim: an('wipe-right-in', 0.45, 'wipe-left-out', 0.45),
        });
        items.push({ block, text, h: bh });
      });
      stack(
        items.map((it) => ({ clip: it.block, height: it.h, gap: env.portrait ? 30 : 18 })),
        { centerY: env.portrait ? -60 : -40 },
      );
      const widest = Math.max(...items.map((it) => it.block.shape.width));
      items.forEach((it, i) => {
        const bw = it.block.shape.width;
        const x = stair ? -widest / 2 - 60 + i * 60 + bw / 2 : 0;
        it.block.transform.x = Math.round(x);
        it.text.transform.x = Math.round(x);
        it.text.transform.y = it.block.transform.y;
        clips.push(it.block, it.text);
      });
      const last = items[items.length - 1];
      const tag = label(env, 'New season  ·  Spring 2026', {
        name: 'Tagline',
        ...life(env, 1.3, 0.05),
        size: 30,
        weight: 600,
        track: 0.24,
        color: c.text,
        anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4),
      });
      tag.transform.y = Math.round(last.block.transform.y + last.h / 2 + 64 + tag.metrics.height / 2);
      if (stair) atLeft(tag, -widest / 2 - 60 + 120);
      clips.push(tag);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-framed-opener',
    name: 'Framed Opener',
    category: 'intro',
    tags: ['intro', 'photo', 'frame', 'card', 'vlog', 'show'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const wide = env.cw > env.ch * 1.2;
      const card = c.surface;
      const ink = inkOn(env, card);
      const shadowA = c.dark ? 0.55 : 0.16;

      let slot: { x: number; y: number; w: number; h: number };
      let cardLeft: number;
      let cardW: number;
      const overlap = 120;
      if (wide) {
        const sw = Math.round(env.cw * 0.6);
        const sh = Math.round((sw * 9) / 16);
        const mirror = chance(env.rng, 0.5);
        slot = { x: Math.round((env.cw / 2 - safe.mx - sw / 2) * (mirror ? -1 : 1)), y: -70, w: sw, h: sh };
        cardW = 840;
        cardLeft = mirror ? env.cw / 2 - safe.mx - cardW : -env.cw / 2 + safe.mx;
      } else {
        const sw = safe.w;
        const sh = Math.round(sw * (env.aspect === '9:16' ? 1.08 : env.portrait ? 0.74 : 0.56));
        slot = { x: 0, y: 0, w: sw, h: sh };
        cardW = sw - 80;
        cardLeft = -env.cw / 2 + safe.mx + 40;
      }
      const pad = 54;
      const kicker = label(env, 'Now showing', { name: 'Kicker', ...life(env, 0.95, 0.6), size: 26, weight: 700, track: 0.26, color: accentOn(env, card), anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const head = title(env, 'Weekend in the Mountains', {
        name: 'Title',
        ...life(env, 1.05, 0.5),
        size: wide ? 104 : env.portrait ? 112 : 96,
        color: ink,
        maxWidth: cardW - pad * 2,
        maxLines: 3,
        style: { align: 'left' },
        anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4),
      });
      const sub = copy(env, 'Travel diary  ·  Part one', { name: 'Subtitle', ...life(env, 1.25, 0.45), size: 32, color: mutedOn(env, card), maxWidth: cardW - pad * 2, maxLines: 2, style: { align: 'left' }, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const innerH = kicker.metrics.height + 18 + head.metrics.height + 22 + sub.metrics.height;
      const cardH = Math.round(innerH + pad * 2);
      if (!wide) {
        // Centre the photo + overlapping card group in the frame.
        const total = slot.h + cardH - overlap;
        slot.y = Math.round(-total / 2 + slot.h / 2);
      }
      const cardY = wide ? Math.round(slot.y + slot.h / 2 - cardH / 2 + 130) : Math.round(slot.y + slot.h / 2 + cardH / 2 - overlap);
      const cardX = Math.round(cardLeft + cardW / 2);
      stack(
        [
          { clip: kicker, height: kicker.metrics.height, gap: 18 },
          { clip: head, height: head.metrics.height, gap: 22 },
          { clip: sub, height: sub.metrics.height },
        ],
        { centerY: cardY },
      );
      for (const t of [kicker, head, sub]) atLeft(t, cardLeft + pad);

      return [
        makeGenerator('grid-lines', {
          name: 'Grid',
          duration: d,
          params: { colorBg: c.bg, colorA: tone(c.text, c.bg, 0.86), size: 64, major: 4, lineWidth: 1.5, fade: 0.7, angle: 0, speed: 0.25 },
        }),
        makeShape('rect', {
          name: 'Offset frame',
          ...life(env, 0.45, 0.2),
          width: slot.w,
          height: slot.h,
          radius: 36,
          x: slot.x + 28,
          y: slot.y + 28,
          fill: CLEAR,
          stroke: { color: accentOn(env, c.bg), width: 4 },
          anim: an('fade-in', 0.6, 'fade-out', 0.4),
        }),
        makeSlot({ name: 'Photo', ...life(env, 0.15, 0.1), width: slot.w, height: slot.h, radius: 36, x: slot.x, y: slot.y, fill: slotFill(env), anim: an('zoom-soft-in', 0.8, 'zoom-soft-out', 0.5) }),
        makeShape('rect', {
          name: 'Card',
          ...life(env, 0.7),
          width: cardW,
          height: cardH,
          radius: 28,
          x: cardX,
          y: cardY,
          fill: card,
          shadow: { color: alpha('#000000', shadowA), blur: 40, x: 0, y: 18 },
          anim: an('slide-up-in', 0.7, 'soft-slide-down-out', 0.45),
        }),
        makeShape('rect', { name: 'Card accent', ...life(env, 0.95, 0.45), width: 10, height: cardH - 56, radius: 5, x: cardLeft + 22, y: cardY, fill: pick(env.rng, [c.primary, c.secondary]), anim: an('wipe-down-in', 0.6, 'fade-out', 0.35) }),
        kicker,
        head,
        sub,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'intro-logo-orbit',
    name: 'Logo Orbit',
    category: 'intro',
    tags: ['intro', 'logo', 'reveal', 'brand', 'orbit', 'channel'],
    duration: 5,
    poster: 0.6,
    music: { soundId: 'music-synthwave-drive' },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const L = env.portrait ? 400 : 320;
      const R = L / 2 + 170;
      const brand = title(env, 'Lumen Labs', { name: 'Brand', ...life(env, 1.0), size: env.portrait ? 150 : 140, maxWidth: safe.w, maxLines: 1, textAnim: { in: { id: 'char-rise-in', duration: 0.9 } }, anim: an(undefined, 0, 'zoom-soft-out', 0.5) });
      const tag = label(env, pick(env.rng, ['Design  ·  Technology  ·  Future', 'Ideas worth building', 'Est. 2026  ·  Studio']), { name: 'Tagline', ...life(env, 1.5, 0.1), size: 30, track: 0.28, color: mutedOn(env, c.bg), maxWidth: safe.w, maxLines: 1, anim: an('fade-in', 0.7, 'fade-out', 0.4) });
      const logoGroup = { transform: { y: 0 } };
      stack(
        [
          { clip: logoGroup, height: L + 70, gap: 70 },
          { clip: brand, height: brand.metrics.height, gap: 26 },
          { clip: tag, height: tag.metrics.height },
        ],
        { centerY: 0 },
      );
      const cy = logoGroup.transform.y;
      const dotsStart = 0.6;
      const tilt = pick(env.rng, [0.32, 0.45]);
      const o1 = orbit(0, cy, R, 3.2, d - dotsStart, -Math.PI / 2, tilt);
      const o2 = orbit(0, cy, R, 3.2, d - dotsStart, Math.PI / 2, tilt);
      return [
        makeGenerator('radial-glow', { name: 'Glow', duration: d, params: { colorA: tone(c.primary, c.bg, 0.55), colorB: c.bg, centerX: 0.5, centerY: 0.5 + cy / env.ch, radius: 0.75, speed: 0.6 } }),
        makeShape('ellipse', { name: 'Orbit path', ...life(env, 0.3, 0.15), width: R * 2, height: R * tilt * 2, y: cy, fill: CLEAR, stroke: { color: alpha(c.text, 0.28), width: 3 }, anim: an('zoom-soft-in', 0.8, 'fade-out', 0.4) }),
        makeShape('ellipse', { name: 'Halo', ...life(env, 0.2, 0.1), width: L + 40, height: L + 40, y: cy, fill: CLEAR, stroke: { color: accentOn(env, c.bg), width: 5 }, anim: an('zoom-soft-in', 0.7, 'zoom-soft-out', 0.45) }),
        makeSlot({ name: 'Logo', ...life(env, 0.1, 0.05), width: L, height: L, radius: L / 2, y: cy, fill: slotFill(env), anim: an('elastic-in', 0.9, 'zoom-soft-out', 0.45) }),
        makeShape('ellipse', { name: 'Satellite A', start: dotsStart, duration: d - dotsStart, width: 30, height: 30, fill: c.primary, keyframes: o1, anim: an('fade-in', 0.4, 'fade-out', 0.35) }),
        makeShape('ellipse', { name: 'Satellite B', start: dotsStart, duration: d - dotsStart, width: 20, height: 20, fill: c.secondary, keyframes: o2, anim: an('fade-in', 0.4, 'fade-out', 0.35) }),
        makeSticker('sparkles-twinkle', { name: 'Sparkle', ...life(env, 1.0, 0.2), size: 120, x: L / 2 + 10, y: cy - L / 2 + 10, colors: [c.text, accentOn(env, c.bg)], anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        brand,
        tag,
      ];
    },
  },
];

export default templates;

