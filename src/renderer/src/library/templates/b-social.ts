import { linear, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, backdrop, hrow, label, lay, mix, pill, popOnDark, scrim, setXY, strong, textOn, till, vivid, vstack, type Row, type Txt } from './_lib/b-kit';
import { chance, pick } from './_lib/kit';

/** Rotates a group of placed layers around (cx, cy) and tilts each one by the same angle. */
function tilt(clips: { transform: { x: number; y: number; rotation: number } }[], cx: number, cy: number, deg: number): void {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (const c of clips) {
    const dx = c.transform.x - cx;
    const dy = c.transform.y - cy;
    c.transform.x = Math.round(cx + dx * cos - dy * sin);
    c.transform.y = Math.round(cy + dx * sin + dy * cos);
    c.transform.rotation += deg;
  }
}

const shadowFor = (env: TemplateEnv, strength = 1): { color: string; blur: number; x: number; y: number } => ({
  color: alpha('#000000', (env.palette.dark ? 0.45 : 0.14) * strength),
  blur: 36,
  x: 0,
  y: 14,
});

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Hook headline over footage
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-hook-headline',
    name: 'Scroll Stopper Hook',
    category: 'social',
    tags: ['hook', 'reel', 'story', 'headline', 'video', 'kinetic', 'tiktok'],
    duration: 6,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const d = env.duration;
      const r = env.rng;
      const variant = pick(r, ['bottom', 'center', 'top'] as const);
      const accent = popOnDark(env, pick(r, [['primary', 'accent', 'secondary'] as const, ['accent', 'secondary', 'primary'] as const]).slice());
      const centered = variant === 'center';
      const w = L.wide ? Math.min(1240, L.s.w * 0.7) : L.s.w;
      const size = L.tall ? 136 : L.wide ? 132 : 112;
      const left = -L.hw + L.s.mx;
      const align = centered ? 'center' : 'left';
      const out = A(undefined, 0, 'fade-out', 0.4);

      const media = makeSlot({ name: 'Background video', width: L.cw, height: L.ch, duration: d, anim: A('zoom-soft-in', 0.8, undefined, 0, 'slow-zoom', 9) });
      const shade = scrim(env, centered ? 'full' : variant, { duration: d, strength: centered ? 0.42 : 0.86, extent: L.wide ? 0.75 : 0.62, anim: A('fade-in', 0.6) });

      const kicker = pill(env, 'Wait for it', {
        size: L.wide ? 30 : 32,
        fill: accent,
        upper: true,
        track: 0.14,
        start: 0.25,
        duration: till(d, 0.25),
        anim: A('pop-in', 0.45, 'pop-out', 0.35),
      });
      const line1 = H(env, "You're brewing", {
        name: 'Hook line 1',
        start: 0.45,
        duration: till(d, 0.45),
        size,
        color: '#ffffff',
        maxWidth: w,
        maxLines: 2,
        style: { align, shadow: { color: alpha('#000000', 0.45), blur: 18, x: 0, y: 4 } },
        textAnim: { in: { id: 'word-rise-in', duration: 0.7 } },
        anim: out,
      });
      const line2 = H(env, 'coffee wrong', {
        name: 'Hook line 2',
        start: 0.95,
        duration: till(d, 0.95),
        size,
        color: accent,
        maxWidth: w,
        maxLines: 2,
        style: { align, shadow: { color: alpha('#000000', 0.45), blur: 18, x: 0, y: 4 } },
        textAnim: { in: { id: 'word-punch-in', duration: 0.9 } },
        anim: out,
      });
      const bar = makeShape('rect', {
        name: 'Underline',
        start: 1.6,
        duration: till(d, 1.6),
        width: Math.max(160, Math.round(line2.metrics.inkWidth * 0.42)),
        height: 12,
        radius: 6,
        fill: accent,
        anim: A('wipe-right-in', 0.5, 'fade-out', 0.35),
      });
      const sub = B(env, "Here's the 30-second fix", {
        name: 'Sub line',
        start: 1.9,
        duration: till(d, 1.9),
        size: L.wide ? 44 : 46,
        color: alpha('#ffffff', 0.9),
        maxWidth: w,
        maxLines: 2,
        style: { align },
        anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35),
      });
      const rows: Row[] = [
        { clips: kicker.clips, h: kicker.h, gap: 34 },
        { clips: [line1], h: line1.metrics.height, gap: 4 },
        { clips: [line2], h: line2.metrics.height, gap: 22 },
        { clips: [bar], h: 12, gap: 30 },
        { clips: [sub], h: sub.metrics.height },
      ];
      if (variant === 'bottom') vstack(rows, { bottom: L.s.hh });
      else if (variant === 'top') vstack(rows, { top: -L.s.hh });
      else vstack(rows, { centerY: 0 });
      if (centered) {
        setXY([line1, line2, sub, bar, ...kicker.clips], 0);
      } else {
        alignLeft(line1, left);
        alignLeft(line2, left);
        alignLeft(sub, left);
        setXY(kicker.clips, left + kicker.w / 2);
        setXY([bar], left + bar.shape.width / 2);
      }

      const handle = pill(env, '@brewlab', {
        size: 30,
        fill: alpha('#000000', 0.45),
        color: '#ffffff',
        start: 2.2,
        duration: till(d, 2.2),
        anim: A('fade-in', 0.5, 'fade-out', 0.35),
      });
      const hy = variant === 'bottom' ? -L.s.hh + handle.h / 2 : L.s.hh - handle.h / 2;
      setXY(handle.clips, centered ? 0 : left + handle.w / 2, hy);

      return [media, shade, bar, ...kicker.clips, line1, line2, sub, ...handle.clips];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. Three tips with sequential cards
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-three-tips',
    name: 'Three Quick Tips',
    category: 'social',
    tags: ['tips', 'list', 'carousel', 'education', 'how to', 'reel', 'numbered'],
    duration: 9,
    poster: 0.78,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'dots', 'grid'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const tips = ['Keep your bedroom cool at night', 'No screens for the last 30 minutes', 'Wake up at the same time every day'];

      const colW = L.wide ? L.s.w * 0.38 : L.s.w;
      const cardW = L.wide ? L.s.w * 0.58 : L.s.w;
      const fs = L.tall ? 54 : L.wide ? 48 : L.mid ? 46 : 40;
      const badgeD = Math.round(fs * 2.1);
      const pad = Math.round(fs * 0.75);

      const kicker = label(env, 'Save this for later', { start: 0.2, duration: till(d, 0.2), size: L.tall ? 36 : L.wide ? 32 : 30, color: pop, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.4) });
      const title = H(env, '3 tips for better sleep', {
        name: 'Title',
        start: 0.35,
        duration: till(d, 0.35),
        size: L.tall ? 140 : L.wide ? 128 : L.mid ? 108 : 92,
        maxWidth: colW,
        maxLines: L.wide ? 3 : 2,
        style: { align: L.wide ? 'left' : 'center' },
        textAnim: { in: { id: 'word-rise-in', duration: 0.8 } },
        anim: A(undefined, 0, 'fade-out', 0.4),
      });

      const step = Math.min(1.25, (d * 0.55) / 3);
      const t0 = Math.min(1.4, d * 0.16);
      const cards: { box: ShapeClip; badge: ShapeClip; num: Txt; text: Txt; h: number }[] = tips.map((tip, i) => {
        const s = t0 + i * step;
        const text = strong(env, tip, {
          name: `Tip ${i + 1}`,
          start: s + 0.2,
          duration: till(d, s + 0.2),
          size: fs,
          weight: 600,
          maxWidth: cardW - pad * 3 - badgeD,
          maxLines: L.wide ? 1 : 2,
          style: { align: 'left', lineHeight: 1.22 },
          anim: A('soft-slide-left-in', 0.5, 'fade-out', 0.35),
        });
        const h = Math.max(badgeD, text.metrics.height) + pad * 2;
        const box = makeShape('rect', { name: `Card ${i + 1}`, start: s, duration: till(d, s), width: Math.round(cardW), height: Math.round(h), radius: Math.min(36, h / 2), fill: c.surface, shadow: shadowFor(env), anim: A('slide-left-in', 0.55, 'fade-out', 0.4) });
        const badge = makeShape('ellipse', { name: `Badge ${i + 1}`, start: s + 0.12, duration: till(d, s + 0.12), width: badgeD, height: badgeD, fill: linear(135, c.primary, mix(c.primary, c.accent, 0.45)), anim: A('pop-in', 0.45, 'fade-out', 0.35) });
        const num = H(env, String(i + 1), { name: `Number ${i + 1}`, start: s + 0.18, duration: till(d, s + 0.18), size: Math.round(badgeD * 0.5), color: textOn(env, c.primary), style: { uppercase: false, letterSpacing: 0 }, anim: A('pop-in', 0.45, 'fade-out', 0.35) });
        return { box, badge, num, text, h };
      });

      const gap = L.tall ? 40 : 26;
      const listRows = cards.map((k) => ({ clips: [k.box, k.badge, k.num, k.text], h: k.h, gap }));
      const footer = label(env, 'Follow for part 2', { start: t0 + step * 3, duration: till(d, t0 + step * 3), size: L.tall ? 34 : L.wide ? 30 : 28, color: c.textMuted, anim: A('fade-in', 0.6, 'fade-out', 0.4) });

      let cardLeft: number;
      if (L.wide) {
        const left = -L.hw + L.s.mx;
        vstack([{ clips: [kicker], h: kicker.metrics.height, gap: 22 }, { clips: [title], h: title.metrics.height }], { centerY: 0 });
        alignLeft(kicker, left);
        alignLeft(title, left);
        cardLeft = L.hw - L.s.mx - cardW;
        vstack([...listRows.slice(0, -1), { ...listRows[2], gap: 30 }, { clips: [footer], h: footer.metrics.height }], { centerY: 0 });
        alignLeft(footer, cardLeft);
      } else {
        vstack(
          [
            { clips: [kicker], h: kicker.metrics.height, gap: 20 },
            { clips: [title], h: title.metrics.height, gap: L.tall ? 64 : 40 },
            ...listRows.slice(0, -1),
            { ...listRows[2], gap: L.tall ? 48 : 30 },
            { clips: [footer], h: footer.metrics.height },
          ],
          { centerY: 0 },
        );
        cardLeft = -cardW / 2;
      }
      for (const k of cards) {
        k.box.transform.x = Math.round(cardLeft + cardW / 2);
        k.badge.transform.x = k.num.transform.x = Math.round(cardLeft + pad + badgeD / 2);
        alignLeft(k.text, cardLeft + pad * 2 + badgeD);
      }

      return [bg, kicker, title, ...cards.flatMap((k) => [k.box, k.badge, k.num, k.text]), footer];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Before / after split with two media slots
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-before-after',
    name: 'Before & After Split',
    category: 'social',
    tags: ['before after', 'comparison', 'transformation', 'split', 'makeover', 'reel'],
    duration: 7,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const stacked = L.portrait;
      const accent = popOnDark(env);
      const out = A(undefined, 0, 'fade-out', 0.4);

      const aW = stacked ? L.cw : L.cw / 2;
      const aH = stacked ? L.ch / 2 : L.ch;
      const before = makeSlot({ name: 'Before photo', width: aW, height: aH, x: stacked ? 0 : -L.cw / 4, y: stacked ? -L.ch / 4 : 0, duration: d, filter: { id: 'soft-grey', intensity: 0.6 }, anim: A(stacked ? 'wipe-up-in' : 'wipe-left-in', 0.8, 'fade-out', 0.4) });
      const after = makeSlot({ name: 'After photo', width: aW, height: aH, x: stacked ? 0 : L.cw / 4, y: stacked ? L.ch / 4 : 0, start: 0.5, duration: till(d, 0.5), anim: A(stacked ? 'wipe-down-in' : 'wipe-right-in', 0.8, 'fade-out', 0.4) });
      const divider = makeShape('rect', { name: 'Divider', start: 1.1, duration: till(d, 1.1), width: stacked ? L.cw : 10, height: stacked ? 10 : L.ch, fill: '#ffffff', anim: A(stacked ? 'wipe-center-in' : 'wipe-down-in', 0.5, 'fade-out', 0.4) });
      const hd = 112;
      const handle = makeShape('ellipse', { name: 'Handle', start: 1.4, duration: till(d, 1.4), width: hd, height: hd, fill: '#ffffff', shadow: { color: alpha('#000000', 0.35), blur: 24, x: 0, y: 6 }, anim: A('pop-in', 0.45, 'pop-out', 0.35) });
      const arrows: ShapeClip[] = [-1, 1].map((s) =>
        makeShape('triangle', {
          name: s < 0 ? 'Arrow back' : 'Arrow forward',
          start: 1.55,
          duration: till(d, 1.55),
          width: 30,
          height: 24,
          x: stacked ? 0 : s * 22,
          y: stacked ? s * 22 : 0,
          rotation: stacked ? (s < 0 ? 0 : 180) : s < 0 ? -90 : 90,
          fill: '#16181d',
          anim: A('pop-in', 0.4, 'pop-out', 0.3),
        }),
      );

      const tagSize = L.tall ? 40 : L.wide ? 36 : 34;
      const bTag = pill(env, 'Before', { size: tagSize, fill: alpha('#0b0c10', 0.66), color: '#ffffff', upper: true, track: 0.18, start: 1.0, duration: till(d, 1.0), anim: A('soft-slide-right-in', 0.5, 'fade-out', 0.35) });
      const aTag = pill(env, 'After', { size: tagSize, fill: accent, upper: true, track: 0.18, start: 1.5, duration: till(d, 1.5), anim: A('soft-slide-left-in', 0.5, 'fade-out', 0.35) });
      const inset = L.portrait ? 64 : 56;
      if (stacked) {
        setXY(bTag.clips, -L.s.hw + bTag.w / 2, -L.s.hh + bTag.h / 2 + 10);
        setXY(aTag.clips, L.s.hw - aTag.w / 2, 60 + aTag.h / 2);
      } else {
        setXY(bTag.clips, -L.hw + inset + bTag.w / 2, -L.s.hh + bTag.h / 2);
        setXY(aTag.clips, L.hw - inset - aTag.w / 2, -L.s.hh + aTag.h / 2);
      }

      // Caption card sits over the split, at the bottom (or the top on landscape, seeded).
      const capTop = chance(r, 0.4) && !stacked;
      const cardW = L.wide ? 1000 : L.s.w;
      const cap = H(env, '30 days of progress', {
        name: 'Caption',
        start: 2.0,
        duration: till(d, 2.0),
        size: L.tall ? 96 : L.wide ? 80 : 72,
        color: c.text,
        maxWidth: cardW - 96,
        maxLines: 2,
        textAnim: { in: { id: 'word-rise-in', duration: 0.7 } },
        anim: out,
      });
      const capSub = label(env, 'Same routine, every single day', { start: 2.4, duration: till(d, 2.4), size: L.tall ? 32 : 28, color: c.textMuted, track: 0.12, maxWidth: cardW - 96, maxLines: 2, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const cardH = Math.round(cap.metrics.height + capSub.metrics.height + 14 + 76);
      const card = makeShape('rect', { name: 'Caption card', start: 1.8, duration: till(d, 1.8), width: cardW, height: cardH, radius: 36, fill: alpha(c.surface, 0.94), shadow: { color: alpha('#000000', 0.35), blur: 30, x: 0, y: 12 }, anim: A('spring-up-in', 0.6, 'fade-out', 0.4) });
      const cardY = capTop ? -L.s.hh + cardH / 2 : stacked ? L.s.hh - cardH / 2 - (L.tall ? 40 : 0) : L.s.hh - cardH / 2;
      card.transform.y = Math.round(cardY);
      vstack([{ clips: [cap], h: cap.metrics.height, gap: 14 }, { clips: [capSub], h: capSub.metrics.height }], { centerY: cardY });
      if (capTop) {
        setXY(bTag.clips, undefined, L.s.hh - bTag.h / 2);
        setXY(aTag.clips, undefined, L.s.hh - aTag.h / 2);
      }

      return [backdrop(env, 'solid', { duration: d }), before, after, divider, handle, ...arrows, ...bTag.clips, ...aTag.clips, card, cap, capSub];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Product spotlight
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-product-spotlight',
    name: 'Product Spotlight',
    category: 'social',
    tags: ['product', 'spotlight', 'shop', 'ecommerce', 'new', 'feature', 'price'],
    duration: 7,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const round = chance(r, 0.5);
      const bg = backdrop(env, pick(r, ['studio', 'spot', 'glow'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.4);

      const side = L.wide ? 620 : L.square ? 470 : L.mid ? 560 : 740;
      const blob = makeShape('blob', { name: 'Glow blob', start: 0.1, duration: till(d, 0.1), width: side * 1.18, height: side * 1.12, fill: linear(135, alpha(c.primary, c.dark ? 0.5 : 0.28), alpha(c.secondary, c.dark ? 0.35 : 0.2)), anim: A('zoom-in', 0.8, 'fade-out', 0.4, 'breathe', 4) });
      const product = makeSlot({ name: 'Product photo', width: side, height: side, radius: round ? side / 2 : 48, start: 0.3, duration: till(d, 0.3), shadow: { color: alpha('#000000', 0.3), blur: 40, x: 0, y: 20 }, anim: A('zoom-blur-in', 0.7, 'fade-out', 0.4) });
      const ring = makeShape(round ? 'ellipse' : 'rect', { name: 'Outline', start: 0.6, duration: till(d, 0.6), width: side + 44, height: side + 44, radius: round ? 0 : 66, fill: alpha(c.bg, 0), stroke: { color: alpha(pop, 0.8), width: 3 }, anim: A('zoom-soft-in', 0.6, 'fade-out', 0.4) });

      const tagD = Math.round(side * 0.34);
      const tag = makeShape('burst', { name: 'Price badge', start: 1.6, duration: till(d, 1.6), width: tagD, height: tagD, fill: c.accent, rotation: -12, anim: A('twist-pop-in', 0.55, 'pop-out', 0.35, 'pulse', 1.6) });
      const price = H(env, '$24', { name: 'Price', start: 1.75, duration: till(d, 1.75), size: Math.round(tagD * 0.3), color: textOn(env, c.accent), maxWidth: tagD * 0.7, maxLines: 1, rotation: -12, style: { letterSpacing: 0 }, anim: A('pop-in', 0.45, 'pop-out', 0.3, 'pulse', 1.6) });

      const textW = L.wide ? L.s.w * 0.44 : L.s.w;
      const align = L.wide ? 'left' : 'center';
      const nu = pill(env, 'New in', { size: L.tall ? 34 : 28, fill: pop, upper: true, track: 0.2, start: 0.9, duration: till(d, 0.9), anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const name = H(env, 'Cloud Soft Cleanser', { name: 'Product name', start: 1.0, duration: till(d, 1.0), size: L.tall ? 104 : L.wide ? 96 : 80, maxWidth: textW, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-rise-in', duration: 0.8 } }, anim: out });
      const desc = B(env, 'Gentle foam for every skin type', { name: 'Description', start: 1.4, duration: till(d, 1.4), size: L.tall ? 46 : L.wide ? 40 : 38, color: c.textMuted, maxWidth: textW, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });

      const chipLabels = ['Vegan', 'Refillable', 'Fragrance-free'];
      const chipSize = L.wide ? 30 : L.tall ? 36 : 26;
      const chips = chipLabels.map((t, i) => pill(env, t, { size: chipSize, fill: alpha(c.text, c.dark ? 0.12 : 0.08), color: c.text, weight: 600, stroke: { color: alpha(c.text, 0.25), width: 2 }, start: 2.0 + i * 0.15, duration: till(d, 2.0 + i * 0.15), anim: A('pop-soft-in', 0.4, 'fade-out', 0.35) }));

      const chipGap = 14;
      if (L.wide) {
        const left = -L.hw + L.s.mx;
        const px = left + side / 2 + 30;
        setXY([blob, product, ring], px, 0);
        setXY([tag, price], px + side * 0.36, -side * 0.36);
        const tx = L.hw - L.s.mx - textW;
        vstack(
          [
            { clips: nu.clips, h: nu.h, gap: 28 },
            { clips: [name], h: name.metrics.height, gap: 18 },
            { clips: [desc], h: desc.metrics.height, gap: 36 },
            { clips: chips.flatMap((p) => p.clips), h: chips[0].h },
          ],
          { centerY: 0 },
        );
        setXY(nu.clips, tx + nu.w / 2);
        alignLeft(name, tx);
        alignLeft(desc, tx);
        hrow(chips.map((p) => ({ clips: p.clips, w: p.w })), { left: tx, gap: chipGap });
      } else {
        const chipsW = chips.reduce((s, p) => s + p.w, 0) + chipGap * (chips.length - 1);
        const twoRows = chipsW > L.s.w;
        const rows: Row[] = [
          { clips: nu.clips, h: nu.h, gap: L.square ? 22 : 36 },
          { clips: [blob, product, ring], h: side, gap: L.square ? 26 : 48 },
          { clips: [name], h: name.metrics.height, gap: 14 },
          { clips: [desc], h: desc.metrics.height, gap: 30 },
        ];
        if (L.square) {
          // Square: product left, copy right to keep everything large.
          const sx = -L.s.hw + side / 2 + 10;
          setXY([blob, product, ring], sx, 0);
          setXY([tag, price], sx + side * 0.36, -side * 0.36);
          const tx = sx + side / 2 + 56;
          const tw = L.s.hw - tx;
          const name2 = H(env, 'Cloud Soft Cleanser', { name: 'Product name', start: 1.0, duration: till(d, 1.0), size: 72, maxWidth: tw, maxLines: 3, style: { align: 'left' }, textAnim: { in: { id: 'char-rise-in', duration: 0.8 } }, anim: out });
          const desc2 = B(env, 'Gentle foam for every skin type', { name: 'Description', start: 1.4, duration: till(d, 1.4), size: 34, color: c.textMuted, maxWidth: tw, maxLines: 3, style: { align: 'left' }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
          const chipCol = chips.map((p) => ({ clips: p.clips, h: p.h, gap: 12 }));
          vstack([{ clips: nu.clips, h: nu.h, gap: 24 }, { clips: [name2], h: name2.metrics.height, gap: 14 }, { clips: [desc2], h: desc2.metrics.height, gap: 28 }, ...chipCol], { centerY: 0 });
          setXY(nu.clips, tx + nu.w / 2);
          alignLeft(name2, tx);
          alignLeft(desc2, tx);
          for (const p of chips) setXY(p.clips, tx + p.w / 2);
          return [bg, blob, product, ring, ...nu.clips, name2, desc2, ...chips.flatMap((p) => p.clips), tag, price];
        }
        if (twoRows) {
          rows.push({ clips: [...chips[0].clips, ...chips[1].clips], h: chips[0].h, gap: 14 });
          rows.push({ clips: chips[2].clips, h: chips[2].h, gap: 0 });
          vstack(rows, { centerY: 0 });
          hrow([chips[0], chips[1]].map((p) => ({ clips: p.clips, w: p.w })), { centerX: 0, gap: chipGap });
        } else {
          rows.push({ clips: chips.flatMap((p) => p.clips), h: chips[0].h, gap: 0 });
          vstack(rows, { centerY: 0 });
          hrow(chips.map((p) => ({ clips: p.clips, w: p.w })), { centerX: 0, gap: chipGap });
        }
        setXY([tag, price], side * 0.36, product.transform.y - side * 0.36);
      }

      return [bg, blob, product, ring, ...nu.clips, name, desc, ...chips.flatMap((p) => p.clips), tag, price];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 5. Poll with animated result bars
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-poll',
    name: 'Quick Poll Results',
    category: 'social',
    tags: ['poll', 'question', 'vote', 'quiz', 'results', 'engagement', 'story'],
    duration: 7,
    poster: 0.7,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['aurora', 'mesh', 'flow'] as const), { duration: d });
      const pop = vivid(env, c.surface);
      const out = A(undefined, 0, 'fade-out', 0.4);

      const cardW = L.wide ? 1180 : L.s.w + (L.tall ? 40 : 0);
      const pad = L.tall ? 72 : L.wide ? 72 : 56;
      const innerW = cardW - pad * 2;
      const options = [
        { t: 'Morning workouts', v: 62 },
        { t: 'Evening workouts', v: 27 },
        { t: 'Whenever I can', v: 11 },
      ];
      const fs = L.tall ? 50 : L.wide ? 44 : L.mid ? 42 : 38;

      const chip = pill(env, 'Poll', { size: L.tall ? 34 : 28, fill: pop, upper: true, track: 0.22, start: 0.5, duration: till(d, 0.5), anim: A('pop-in', 0.4, 'fade-out', 0.35) });
      const q = H(env, 'When do you prefer to train?', { name: 'Question', start: 0.65, duration: till(d, 0.65), size: L.tall ? 104 : L.wide ? 88 : L.mid ? 84 : 72, maxWidth: innerW, maxLines: 3, style: { align: 'left' }, textAnim: { in: { id: 'word-fade-in', duration: 0.8 } }, anim: out });

      const barH = L.tall ? 30 : 24;
      const rowsOut: Clip[] = [];
      const rowDefs = options.map((o, i) => {
        const s = 1.4 + i * 0.22;
        const win = i === 0;
        const name = strong(env, o.t, { name: `Option ${i + 1}`, start: s, duration: till(d, s), size: fs, weight: win ? 700 : 500, color: c.text, maxWidth: innerW - 140, maxLines: 1, style: { align: 'left' }, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.35) });
        const pct = H(env, `${o.v}%`, { name: `Result ${i + 1}`, start: 2.5 + i * 0.18, duration: till(d, 2.5 + i * 0.18), size: Math.round(fs * 1.05), color: win ? pop : c.textMuted, style: { letterSpacing: 0, uppercase: false }, anim: A('pop-soft-in', 0.4, 'fade-out', 0.35) });
        const track = makeShape('rect', { name: `Track ${i + 1}`, start: s, duration: till(d, s), width: innerW, height: barH, radius: barH / 2, fill: alpha(c.text, c.dark ? 0.14 : 0.09), anim: A('wipe-right-in', 0.5, 'fade-out', 0.35) });
        const fw = Math.max(barH, Math.round((innerW * o.v) / 100));
        const fill = makeShape('rect', { name: `Bar ${i + 1}`, start: 2.1 + i * 0.18, duration: till(d, 2.1 + i * 0.18), width: fw, height: barH, radius: barH / 2, fill: win ? linear(0, c.primary, mix(c.primary, c.accent, 0.6)) : alpha(c.text, c.dark ? 0.38 : 0.3), anim: A('wipe-right-in', 0.9, 'fade-out', 0.35) });
        return { name, pct, track, fill, fw, h: Math.max(name.metrics.height, pct.metrics.height) + 14 + barH };
      });
      const footer = B(env, 'Tell me why in the comments', { name: 'Footer', start: 3.2, duration: till(d, 3.2), size: L.tall ? 40 : L.wide ? 34 : 32, color: c.textMuted, maxWidth: innerW, maxLines: 1, style: { align: 'left' }, anim: A('fade-in', 0.6, 'fade-out', 0.35) });

      const rowGap = L.tall ? 52 : 34;
      const contentH = chip.h + 26 + q.metrics.height + 48 + rowDefs.reduce((s, x) => s + x.h, 0) + rowGap * 2 + 44 + footer.metrics.height;
      const cardH = contentH + pad * 2;
      const card = makeShape('rect', { name: 'Card', start: 0.2, duration: till(d, 0.2), width: cardW, height: Math.round(cardH), radius: 44, fill: c.surface, shadow: shadowFor(env, 1.2), anim: A('spring-up-in', 0.6, 'fade-out', 0.4) });
      const top = -cardH / 2 + pad;
      const left = -cardW / 2 + pad;
      // Each option row: label + percentage on one line, bar underneath.
      const holders = rowDefs.map((x) => ({ transform: { x: 0, y: 0 } }));
      vstack(
        [
          { clips: chip.clips, h: chip.h, gap: 26 },
          { clips: [q], h: q.metrics.height, gap: 48 },
          ...rowDefs.map((x, i) => ({ clips: [holders[i]], h: x.h, gap: rowGap })),
          { clips: [footer], h: footer.metrics.height },
        ].map((row, i, arr) => (i === arr.length - 2 ? { ...row, gap: 44 } : row)),
        { top },
      );
      setXY(chip.clips, left + chip.w / 2);
      alignLeft(q, left);
      alignLeft(footer, left);
      rowDefs.forEach((x, i) => {
        const rowTop = holders[i].transform.y - x.h / 2;
        const lineH = Math.max(x.name.metrics.height, x.pct.metrics.height);
        x.name.transform.y = x.pct.transform.y = Math.round(rowTop + lineH / 2);
        alignLeft(x.name, left);
        x.pct.transform.x = Math.round(left + innerW - x.pct.metrics.width / 2);
        x.track.transform.y = x.fill.transform.y = Math.round(rowTop + lineH + 14 + barH / 2);
        x.track.transform.x = 0;
        x.fill.transform.x = Math.round(left + x.fw / 2);
        rowsOut.push(x.track, x.fill, x.name, x.pct);
      });

      return [bg, card, ...chip.clips, q, ...rowsOut, footer];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 6. Big announcement
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-announcement',
    name: 'Big News Announcement',
    category: 'social',
    tags: ['announcement', 'news', 'launch', 'update', 'opening', 'post', 'confetti'],
    duration: 6,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['sunburst', 'halftone', 'dots'] as const), { duration: d });
      const deg = pick(r, [-3, -2, 2, 3]);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const cardW = L.wide ? 1240 : L.s.w + (L.tall ? 30 : 0);
      const pad = L.tall ? 84 : L.wide ? 88 : 64;
      const innerW = cardW - pad * 2;
      const pop = vivid(env, c.surface);

      const kicker = pill(env, 'Big news', { size: L.tall ? 40 : L.wide ? 36 : 34, fill: c.text, color: c.surface, upper: true, track: 0.2, start: 0.55, duration: till(d, 0.55), anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const head = H(env, "We're opening a second studio!", { name: 'Headline', start: 0.75, duration: till(d, 0.75), size: L.tall ? 140 : L.wide ? 116 : L.mid ? 112 : 92, maxWidth: innerW, maxLines: L.tall ? 4 : 3, textAnim: { in: { id: 'word-spring-in', duration: 1.0 } }, anim: out });
      const sub = B(env, 'Doors open June 14 · 42 Harbor Street', { name: 'Details', start: 1.4, duration: till(d, 1.4), size: L.tall ? 48 : L.wide ? 42 : 38, color: c.textMuted, maxWidth: innerW, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const cta = pill(env, 'Save the date', { size: L.tall ? 44 : L.wide ? 38 : 36, fill: c.primary, start: 1.8, duration: till(d, 1.8), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      const contentH = kicker.h + 34 + head.metrics.height + 22 + sub.metrics.height + 44 + cta.h;
      const cardH = contentH + pad * 2;
      const card = makeShape('rect', { name: 'Card', start: 0.2, duration: till(d, 0.2), width: cardW, height: Math.round(cardH), radius: 48, fill: c.surface, shadow: shadowFor(env, 1.4), anim: A('rubber-in', 0.8, 'fade-out', 0.4) });
      vstack(
        [
          { clips: kicker.clips, h: kicker.h, gap: 34 },
          { clips: [head], h: head.metrics.height, gap: 22 },
          { clips: [sub], h: sub.metrics.height, gap: 44 },
          { clips: cta.clips, h: cta.h },
        ],
        { centerY: 0 },
      );
      const emojiSize = L.tall ? 260 : L.wide ? 220 : 200;
      const mega = makeSticker('emoji-1f4e3', { name: 'Megaphone', start: 1.0, duration: till(d, 1.0), size: emojiSize, x: cardW / 2 - emojiSize * 0.25, y: -cardH / 2 + emojiSize * 0.05, rotation: -14, anim: A('twist-pop-in', 0.6, 'pop-out', 0.3, 'wiggle', 1.6) });
      const group = [card, ...kicker.clips, head, sub, ...cta.clips];
      tilt(group, 0, 0, deg);
      const confettiSize = L.wide ? 300 : 280;
      const confA = makeSticker('confetti-burst', { name: 'Confetti left', start: 1.2, duration: till(d, 1.2), size: confettiSize, colors: [c.primary, c.secondary, c.accent, mix(c.primary, '#ffffff', 0.5)], x: -cardW / 2 + 20, y: cardH / 2 - 10, anim: A('pop-in', 0.5, 'fade-out', 0.4) });
      const confB = makeSticker('sparkles-twinkle', { name: 'Sparkles', start: 1.5, duration: till(d, 1.5), size: confettiSize * 0.6, colors: [pop, c.secondary], x: -cardW / 2 + 60, y: -cardH / 2 + 30, anim: A('pop-in', 0.5, 'fade-out', 0.4) });
      return [bg, confA, card, ...kicker.clips, head, sub, ...cta.clips, mega, confB];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 7. Talking head with captions
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-caption-talk',
    name: 'Talking Head Captions',
    category: 'social',
    tags: ['captions', 'subtitles', 'talking head', 'podcast', 'interview', 'reel', 'overlay'],
    duration: 8,
    poster: 0.55,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const accent = popOnDark(env);
      const boxed = chance(r, 0.5);

      const media = makeSlot({ name: 'Talking head video', width: L.cw, height: L.ch, duration: d, anim: A('fade-in', 0.4) });
      const shade = scrim(env, 'bottom', { duration: d, strength: 0.6, extent: 0.45 });
      const trackW = L.s.w;
      const barY = -L.s.hh + (L.portrait ? -30 : -20);
      const track = makeShape('rect', { name: 'Progress track', start: 0.2, duration: till(d, 0.2), width: trackW, height: 8, radius: 4, y: barY, fill: alpha('#ffffff', 0.3), anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      const fill = makeShape('rect', { name: 'Progress', start: 0.2, duration: till(d, 0.2), width: trackW, height: 8, radius: 4, y: barY, fill: accent, anim: A('wipe-right-in', till(d, 0.4), 'fade-out', 0.3) });

      // Name tag (lower third), visible during the first half.
      const nameT = strong(env, 'Maya Chen', { name: 'Speaker name', start: 0.6, duration: d * 0.45, size: L.tall ? 50 : 46, color: '#ffffff', weight: 700, style: { align: 'left' }, anim: A('soft-slide-right-in', 0.5, 'soft-slide-left-out', 0.4) });
      const roleT = B(env, 'Founder, Bloom Studio', { name: 'Speaker role', start: 0.75, duration: d * 0.45 - 0.15, size: L.tall ? 34 : 32, color: alpha('#ffffff', 0.8), style: { align: 'left' }, anim: A('soft-slide-right-in', 0.5, 'soft-slide-left-out', 0.4) });
      const tagW = Math.max(nameT.metrics.width, roleT.metrics.width) + 72;
      const tagH = nameT.metrics.height + roleT.metrics.height + 44;
      const tagX = -L.s.hw + tagW / 2;
      const tagY = -L.s.hh + 60 + tagH / 2;
      const tagBox = makeShape('rect', { name: 'Name tag', start: 0.5, duration: d * 0.45 + 0.1, width: tagW, height: tagH, radius: 22, x: tagX, y: tagY, fill: alpha('#0b0c10', 0.6), anim: A('wipe-right-in', 0.5, 'wipe-left-out', 0.4) });
      const tagBar = makeShape('rect', { name: 'Tag accent', start: 0.5, duration: d * 0.45 + 0.1, width: 8, height: tagH - 32, radius: 4, x: -L.s.hw + 20, y: tagY, fill: accent, anim: A('wipe-down-in', 0.4, 'fade-out', 0.3) });
      vstack([{ clips: [nameT], h: nameT.metrics.height, gap: 4 }, { clips: [roleT], h: roleT.metrics.height }], { centerY: tagY });
      alignLeft(nameT, -L.s.hw + 44);
      alignLeft(roleT, -L.s.hw + 44);

      const lines = ["So here's the thing", 'most people skip', 'the warm-up entirely'];
      const t0 = 0.9;
      const seg = (d - t0 - 0.2) / lines.length;
      const capY = L.portrait ? L.s.hh - (L.tall ? 230 : 120) : L.s.hh - 70;
      const capSize = L.tall ? 78 : L.wide ? 70 : 64;
      const caps = lines.map((t, i) => {
        const key = i === 1;
        const bgCol = key ? accent : '#0b0c10';
        return H(env, t, {
          name: `Caption ${i + 1}`,
          start: t0 + i * seg,
          duration: seg - 0.05,
          size: capSize,
          color: boxed ? (key ? textOn(env, accent) : '#ffffff') : key ? accent : '#ffffff',
          maxWidth: L.wide ? 1300 : L.s.w,
          maxLines: 2,
          y: capY,
          style: boxed
            ? { background: { color: bgCol, opacity: key ? 1 : 0.72, padX: 26, padY: 10, radius: 18 }, lineHeight: 1.12 }
            : { stroke: { color: '#0b0c10', width: Math.round(capSize * 0.14) }, shadow: { color: alpha('#000000', 0.5), blur: 12, x: 0, y: 4 } },
          textAnim: { in: { id: 'word-pop-in', duration: 0.5 } },
          anim: A(undefined, 0, 'fade-out', 0.15),
        });
      });
      void c;
      return [media, shade, track, fill, tagBox, tagBar, nameT, roleT, ...caps];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 8. Follow card / profile end card
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-social-follow-card',
    name: 'Follow For More',
    category: 'social',
    tags: ['follow', 'profile', 'end card', 'creator', 'subscribe', 'outro', 'stats'],
    duration: 7,
    poster: 0.7,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['aurora', 'mesh', 'glow'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.4);

      const av = L.wide ? 440 : L.tall ? 460 : L.mid ? 340 : 270;
      const ring = makeShape('ellipse', { name: 'Avatar ring', start: 0.2, duration: till(d, 0.2), width: av + 36, height: av + 36, fill: linear(135, c.primary, c.accent), anim: A('zoom-in', 0.6, 'zoom-out', 0.4) });
      const gapRing = makeShape('ellipse', { name: 'Avatar gap', start: 0.2, duration: till(d, 0.2), width: av + 14, height: av + 14, fill: c.bg, anim: A('zoom-in', 0.6, 'zoom-out', 0.4) });
      const avatar = makeSlot({ name: 'Profile photo', width: av, height: av, radius: av / 2, start: 0.35, duration: till(d, 0.35), anim: A('pop-in', 0.55, 'zoom-out', 0.4) });

      const align = L.wide ? 'left' : 'center';
      const textW = L.wide ? L.s.w * 0.52 : L.s.w;
      const name = H(env, 'Maya Chen', { name: 'Name', start: 0.7, duration: till(d, 0.7), size: L.wide ? 112 : L.tall ? 120 : L.mid ? 96 : 80, maxWidth: textW - 90, maxLines: 1, style: { align }, textAnim: { in: { id: 'char-rise-in', duration: 0.7 } }, anim: out });
      const badgeS = Math.round(name.metrics.height * 0.56);
      const badge = makeSticker('verified-badge', { name: 'Verified', start: 1.3, duration: till(d, 1.3), size: badgeS, colors: [pop, textOn(env, pop)], anim: A('pop-in', 0.4, 'pop-out', 0.3) });
      const handle = B(env, '@maya.creates', { name: 'Handle', start: 0.95, duration: till(d, 0.95), size: L.tall ? 46 : L.wide ? 42 : 38, color: c.textMuted, style: { align }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
      const tagline = B(env, 'New recipes every Sunday', { name: 'Tagline', start: 1.15, duration: till(d, 1.15), size: L.tall ? 44 : L.wide ? 40 : 34, maxWidth: textW, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });

      const stats = [
        ['248', 'Posts'],
        ['18.4K', 'Followers'],
        ['312', 'Following'],
      ].map(([v, l], i) => {
        const s = 1.4 + i * 0.15;
        const num = H(env, v, { name: `${l} count`, start: s, duration: till(d, s), size: L.tall ? 72 : L.wide ? 64 : L.square ? 50 : 58, style: { letterSpacing: 0 }, anim: A('pop-soft-in', 0.45, 'fade-out', 0.35) });
        const lab = label(env, l, { start: s + 0.08, duration: till(d, s + 0.08), size: L.tall ? 28 : 24, color: c.textMuted, track: 0.12, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
        return { num, lab, w: Math.max(num.metrics.inkWidth, lab.metrics.inkWidth), h: num.metrics.height + 6 + lab.metrics.height };
      });
      const statsH = Math.max(...stats.map((s) => s.h));

      const btnSize = L.tall ? 48 : L.wide ? 40 : 38;
      const follow = pill(env, 'Follow', { size: btnSize, fill: c.primary, minWidth: L.tall ? 440 : 360, start: 1.9, duration: 3.4 - 1.9, anim: A('pop-up-in', 0.5) });
      const following = pill(env, 'Following', { size: btnSize, fill: alpha(c.text, c.dark ? 0.16 : 0.1), color: c.text, minWidth: L.tall ? 440 : 360, stroke: { color: alpha(c.text, 0.3), width: 2 }, start: 3.4, duration: till(d, 3.4), anim: A('pop-soft-in', 0.3, 'fade-out', 0.4) });
      const cursor = makeSticker('cursor-click', { name: 'Cursor', start: 2.4, duration: 1.8, size: 150, anim: A('fly-up-in', 0.6, 'fade-out', 0.4) });

      const rows: Row[] = [
        { clips: [name, badge], h: name.metrics.height, gap: 6 },
        { clips: [handle], h: handle.metrics.height, gap: 22 },
        { clips: [tagline], h: tagline.metrics.height, gap: L.wide ? 44 : 36 },
        { clips: stats.flatMap((s) => [s.num]), h: statsH, gap: L.wide ? 48 : 40 },
        { clips: [...follow.clips, ...following.clips, cursor], h: follow.h },
      ];
      const statCols = stats.map((s) => ({ clips: [s.num, s.lab], w: Math.max(s.w, 150) }));
      if (L.wide) {
        const left = -L.hw + L.s.mx + 30;
        setXY([ring, gapRing, avatar], left + av / 2 + 18, 0);
        const tx = left + av + 120;
        vstack(rows, { centerY: 0 });
        alignLeft(name, tx);
        alignLeft(handle, tx);
        alignLeft(tagline, tx);
        hrow(statCols, { left: tx, gap: 84 });
        setXY([...follow.clips, ...following.clips], tx + follow.w / 2);
      } else {
        vstack([{ clips: [ring, gapRing, avatar], h: av + 36, gap: L.square ? 30 : 48 }, ...rows], { centerY: L.tall ? -20 : 0 });
        hrow(statCols, { centerX: 0, gap: L.square ? 60 : 84 });
        setXY([...follow.clips, ...following.clips], 0);
      }
      for (const s of stats) {
        const top = s.num.transform.y - statsH / 2;
        s.num.transform.y = Math.round(top + s.num.metrics.height / 2);
        s.lab.transform.y = Math.round(top + s.num.metrics.height + 6 + s.lab.metrics.height / 2);
      }
      badge.transform.x = Math.round(name.transform.x + (L.wide ? name.metrics.inkWidth - name.metrics.width / 2 : name.metrics.inkWidth / 2) + badgeS * 0.7);
      cursor.transform.x = Math.round(follow.box.transform.x + follow.w * 0.28);
      cursor.transform.y = Math.round(follow.box.transform.y + 60);

      return [bg, ring, gapRing, avatar, name, badge, handle, tagline, ...stats.flatMap((s) => [s.num, s.lab]), ...follow.clips, ...following.clips, cursor];
    },
  },
];

export default templates;
