import { linear, makeGenerator, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip } from '@/core/types';
import type { TemplateDef } from '../types';
import { accentOn, an, atLeft, copy, inkOn, label, life, lightPanel, mutedOn, slotFill, title, tone } from './_lib/a-kit';
import { alpha, chance, mix, pick, safeArea, stack } from './_lib/kit';

const QUOTES = [
  'Make it simple, but make it unforgettable. Good design is felt before it is seen.',
  'The best ideas arrive quietly, usually while you are busy making something else.',
  'Start before you are ready. Clarity comes from doing, not from waiting.',
];

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'quote-big-mark',
    name: 'Big Quote Mark',
    category: 'quote',
    tags: ['quote', 'typography', 'editorial', 'inspiration', 'words'],
    duration: 7,
    poster: 0.65,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const left = !env.portrait && chance(env.rng, 0.5);
      const align = left ? 'left' : 'center';
      const w = Math.min(safe.w, left ? 1250 : 1400);
      const x0 = -w / 2;
      const accent = accentOn(env, c.bg);
      const markSize = env.portrait ? 380 : 340;
      const mark = title(env, '“', { name: 'Quote mark', ...life(env, 0.2, 0.15), size: markSize, color: accent, style: { align, uppercase: false }, anim: an('drop-in', 0.8, 'fade-out', 0.4) });
      const quote = title(env, pick(env.rng, QUOTES), {
        name: 'Quote',
        ...life(env, 0.7),
        size: env.portrait ? 84 : 76,
        maxWidth: w,
        maxLines: env.portrait ? 7 : 4,
        style: { align, lineHeight: 1.18 },
        textAnim: { in: { id: 'word-fade-in', duration: 1.8 } },
        anim: an(undefined, 0, 'fade-out', 0.5),
      });
      const rule = makeShape('rect', { name: 'Rule', ...life(env, 2.0, 0.15), width: 90, height: 4, radius: 2, fill: accent, anim: an(left ? 'wipe-right-in' : 'wipe-center-in', 0.5, 'fade-out', 0.35) });
      const who = label(env, 'Alex Morgan', { name: 'Author', ...life(env, 2.2, 0.1), size: 30, weight: 700, track: 0.18, color: c.text, style: { align }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const role = copy(env, 'Creative Director, Studio Nine', { name: 'Author role', ...life(env, 2.35, 0.1), size: 28, color: c.textMuted, maxWidth: w, maxLines: 1, style: { align }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      // The quote glyph sits in the top part of its line box: reserve only that part in the stack.
      const markVisible = markSize * 0.42;
      const markSlot = { transform: { y: 0 } };
      stack(
        [
          { clip: markSlot, height: markVisible, gap: 30 },
          { clip: quote, height: quote.metrics.height, gap: 52 },
          { clip: rule, height: 4, gap: 30 },
          { clip: who, height: who.metrics.height, gap: 8 },
          { clip: role, height: role.metrics.height },
        ],
        { centerY: 0 },
      );
      mark.transform.y = Math.round(markSlot.transform.y + mark.metrics.height / 2 - markVisible / 2 - markSize * 0.12);
      if (left) {
        for (const t of [mark, quote, who, role]) atLeft(t, x0);
        rule.transform.x = Math.round(x0 + 45);
      }
      return [
        makeGenerator('paper', { name: 'Paper', duration: d, params: { colorA: c.bg, colorB: mix(c.bg, c.bg2, 0.85), roughness: 0.5, fibres: 0.4, speed: 0 } }),
        mark,
        quote,
        rule,
        who,
        role,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'quote-portrait-card',
    name: 'Portrait Quote',
    category: 'quote',
    tags: ['quote', 'portrait', 'interview', 'speaker', 'photo', 'testimonial'],
    duration: 7,
    poster: 0.65,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const wide = env.cw > env.ch * 1.2;
      const P = wide ? 420 : env.portrait ? 400 : 300;
      const accent = accentOn(env, c.bg);
      const textW = wide ? safe.w - P - 140 : safe.w;
      const align = wide ? 'left' : 'center';
      const quote = title(env, pick(env.rng, QUOTES), { name: 'Quote', ...life(env, 0.8), size: wide ? 66 : env.portrait ? 72 : 58, maxWidth: textW, maxLines: wide ? 5 : 6, style: { align, lineHeight: 1.16 }, textAnim: { in: { id: 'line-rise-in', duration: 1.2 } }, anim: an(undefined, 0, 'fade-out', 0.45) });
      const who = label(env, 'Jordan Lee', { name: 'Author', ...life(env, 1.6, 0.1), size: 30, weight: 700, track: 0.18, color: accent, style: { align }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const role = copy(env, 'Founder, Field & Form', { name: 'Author role', ...life(env, 1.75, 0.1), size: 28, color: c.textMuted, maxWidth: textW, maxLines: 1, style: { align }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const clips: Clip[] = [makeShape('rect', { name: 'Backdrop', duration: d, width: env.cw, height: env.ch, fill: linear(120, c.bg, c.bg2) })];
      let px: number;
      let py: number;
      if (wide) {
        const groupW = P + 140 + Math.max(quote.metrics.inkWidth, who.metrics.inkWidth, role.metrics.inkWidth);
        const gl = -groupW / 2;
        px = Math.round(gl + P / 2);
        py = 0;
        const tx = gl + P + 140;
        stack(
          [
            { clip: quote, height: quote.metrics.height, gap: 44 },
            { clip: who, height: who.metrics.height, gap: 8 },
            { clip: role, height: role.metrics.height },
          ],
          { centerY: 0 },
        );
        for (const t of [quote, who, role]) atLeft(t, tx);
      } else {
        const pBox = { transform: { y: 0 } };
        stack(
          [
            { clip: pBox, height: P + 24, gap: 60 },
            { clip: quote, height: quote.metrics.height, gap: 44 },
            { clip: who, height: who.metrics.height, gap: 8 },
            { clip: role, height: role.metrics.height },
          ],
          { centerY: 0 },
        );
        px = 0;
        py = pBox.transform.y;
      }
      clips.push(
        makeShape('ellipse', { name: 'Portrait ring', ...life(env, 0.2, 0.1), width: P + 24, height: P + 24, x: px, y: py, fill: linear(45, c.primary, c.secondary), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.45) }),
        makeSlot({ name: 'Portrait', ...life(env, 0.3, 0.1), width: P, height: P, radius: P / 2, x: px, y: py, fill: slotFill(env), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.45) }),
        makeSticker('quote-marks', { name: 'Quote marks', ...life(env, 0.7, 0.2), size: Math.round(P * 0.42), x: Math.round(px + P * 0.38), y: Math.round(py - P * 0.36), colors: [c.primary, c.secondary], anim: an('pop-in', 0.5, 'pop-out', 0.3) }),
        quote,
        who,
        role,
      );
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'quote-minimal-lines',
    name: 'Minimal Quote',
    category: 'quote',
    tags: ['quote', 'minimal', 'elegant', 'calm', 'mindful', 'words'],
    duration: 7,
    poster: 0.65,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const w = Math.min(safe.w, 1200);
      const lineC = alpha(c.text, 0.4);
      const kick = label(env, 'Words to live by', { name: 'Kicker', ...life(env, 0.3, 0.2), size: 26, weight: 600, track: 0.34, color: accentOn(env, c.bg), anim: an('fade-in', 0.8, 'fade-out', 0.4) });
      const quote = title(env, pick(env.rng, QUOTES), { name: 'Quote', ...life(env, 0.9), size: env.aspect === '9:16' ? 82 : env.portrait ? 70 : 68, maxWidth: w, maxLines: env.aspect === '9:16' ? 7 : 5, style: { lineHeight: 1.22 }, textAnim: { in: { id: 'line-blur-in', duration: 1.5 } }, anim: an(undefined, 0, 'blur-out', 0.6) });
      const who = copy(env, '— Sam Rivera', { name: 'Author', ...life(env, 2.3, 0.15), size: 32, color: c.textMuted, anim: an('fade-in', 0.7, 'fade-out', 0.4) });
      const lw = Math.round(Math.min(w, Math.max(quote.metrics.inkWidth * 0.5, 240)));
      const top = makeShape('rect', { name: 'Rule top', ...life(env, 0.6, 0.25), width: lw, height: 2, fill: lineC, anim: an('wipe-center-in', 0.8, 'wipe-center-out', 0.5) });
      const bot = makeShape('rect', { name: 'Rule bottom', ...life(env, 0.7, 0.25), width: lw, height: 2, fill: lineC, anim: an('wipe-center-in', 0.8, 'wipe-center-out', 0.5) });
      stack(
        [
          { clip: kick, height: kick.metrics.height, gap: 46 },
          { clip: top, height: 2, gap: 60 },
          { clip: quote, height: quote.metrics.height, gap: 60 },
          { clip: bot, height: 2, gap: 46 },
          { clip: who, height: who.metrics.height },
        ],
        { centerY: 0 },
      );
      return [
        makeGenerator('horizon-glow', { name: 'Horizon', duration: d, params: { colorA: c.bg, colorB: tone(c.primary, c.bg, c.dark ? 0.62 : 0.75), colorC: mix(c.bg, c.bg2, 0.6), horizon: 0.9, glow: 0.6, speed: 0.4 } }),
        kick,
        top,
        quote,
        bot,
        who,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'quote-testimonial',
    name: 'Testimonial Card',
    category: 'quote',
    tags: ['quote', 'testimonial', 'review', 'rating', 'customer', 'business'],
    duration: 7,
    poster: 0.65,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const card = lightPanel(env);
      const ink = inkOn(env, card);
      const cardW = Math.round(Math.min(safe.w, env.portrait ? safe.w : 1150));
      const pad = env.portrait ? 64 : 72;
      const innerW = cardW - pad * 2;
      const stars = env.portrait ? 76 : 64;
      const quote = copy(env, '“The team turned a rough idea into a launch video our customers still talk about. Fast, thoughtful and genuinely fun to work with.”', {
        name: 'Review',
        ...life(env, 0.9, 0.4),
        size: env.portrait ? 48 : 44,
        weight: 500,
        color: ink,
        maxWidth: innerW,
        maxLines: env.portrait ? 8 : 5,
        style: { align: 'left', lineHeight: 1.4 },
        anim: an('soft-slide-up-in', 0.7, 'fade-out', 0.35),
      });
      const av = env.portrait ? 120 : 104;
      const name = title(env, 'Priya Raman', { name: 'Name', ...life(env, 1.4, 0.4), size: 44, color: ink, maxWidth: innerW - av - 30, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const role = copy(env, 'Head of Marketing, Northwind', { name: 'Role', ...life(env, 1.55, 0.4), size: 28, color: mutedOn(env, card), maxWidth: innerW - av - 30, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const personH = Math.max(av, name.metrics.height + 6 + role.metrics.height);
      const cardH = Math.round(pad + stars + 40 + quote.metrics.height + 44 + 2 + 40 + personH + pad);
      const cardY = 0;
      const left = -cardW / 2 + pad;
      let y = cardY - cardH / 2 + pad;
      const starsY = Math.round(y + stars / 2);
      y += stars + 40;
      quote.transform.y = Math.round(y + quote.metrics.height / 2);
      atLeft(quote, left);
      y += quote.metrics.height + 44;
      const divY = Math.round(y + 1);
      y += 2 + 40;
      const py = Math.round(y + personH / 2);
      const nh = name.metrics.height + 6 + role.metrics.height;
      name.transform.y = Math.round(py - nh / 2 + name.metrics.height / 2);
      role.transform.y = Math.round(py + nh / 2 - role.metrics.height / 2);
      atLeft(name, left + av + 30);
      atLeft(role, left + av + 30);
      const starW = Math.round(stars * 4.2);
      return [
        makeGenerator('radial-glow', { name: 'Glow', duration: d, params: { colorA: tone(c.primary, c.bg, 0.5), colorB: c.bg, centerX: 0.5, centerY: 0.45, radius: 0.85, speed: 0.6 } }),
        makeShape('rect', { name: 'Card', ...life(env, 0.2, 0.05), width: cardW, height: cardH, radius: 36, y: cardY, fill: card, shadow: { color: alpha('#000000', c.dark ? 0.5 : 0.18), blur: 50, x: 0, y: 22 }, anim: an('slide-up-in', 0.7, 'zoom-soft-out', 0.4) }),
        makeSticker('star-rating', { name: 'Rating', ...life(env, 0.6, 0.4), size: stars, x: Math.round(left + starW / 2), y: starsY, colors: ['#ffc531', '#ff9d00', mix(card, ink, 0.3)], anim: an('fade-in', 0.4, 'fade-out', 0.3) }),
        ...(chance(env.rng, 0.5) ? [makeSticker('quote-marks', { name: 'Quote marks', ...life(env, 0.7, 0.4), size: Math.round(stars * 1.6), x: Math.round(cardW / 2 - pad - stars * 0.8), y: Math.round(starsY + 6), colors: [accentOn(env, card, 2), c.secondary], anim: an('pop-in', 0.5, 'pop-out', 0.3) })] : []),
        quote,
        makeShape('rect', { name: 'Divider', ...life(env, 1.2, 0.4), width: innerW, height: 2, y: divY, fill: alpha(ink, 0.12), anim: an('wipe-right-in', 0.6, 'fade-out', 0.3) }),
        makeShape('ellipse', { name: 'Avatar ring', ...life(env, 1.25, 0.4), width: av + 8, height: av + 8, x: Math.round(left + av / 2), y: py, fill: linear(45, c.primary, c.secondary), anim: an('pop-in', 0.5, 'pop-out', 0.3) }),
        makeSlot({ name: 'Avatar', ...life(env, 1.3, 0.4), width: av, height: av, radius: av / 2, x: Math.round(left + av / 2), y: py, fill: slotFill(env), anim: an('pop-in', 0.5, 'pop-out', 0.3) }),
        name,
        role,
      ];
    },
  },
];

export default templates;
