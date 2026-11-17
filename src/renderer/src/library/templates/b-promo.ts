import { kf, linear, makeShape, makeSlot, makeSticker, radial } from '@/core/factory';
import type { Clip, ShapeClip, StickerClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import {
  A,
  B,
  H,
  alignLeft,
  alpha,
  backdrop,
  column,
  fitAspect,
  holder,
  hrow,
  label,
  lay,
  mix,
  pItem,
  pill,
  popOnDark,
  scrim,
  setXY,
  split,
  strong,
  tItem,
  textOn,
  till,
  vivid,
  type Box,
  type Item,
  type Txt,
} from './_lib/b-kit';
import { chance, logoBug, pick } from './_lib/kit';

const softShadow = (env: TemplateEnv, k = 1): { color: string; blur: number; x: number; y: number } => ({ color: alpha('#000000', (env.palette.dark ? 0.45 : 0.16) * k), blur: 40, x: 0, y: 18 });

/** A phone mockup whose screen is a media slot. Returns its layers (body, screen, notch). */
function phone(env: TemplateEnv, o: { h: number; x: number; y: number; start: number; duration: number; rotation?: number }): { clips: ShapeClip[]; w: number } {
  const h = Math.round(o.h);
  const w = Math.round(h * 0.49);
  const r = Math.round(h * 0.075);
  const bezel = Math.max(12, Math.round(h * 0.018));
  const rot = o.rotation ?? 0;
  const bodyCol = '#0d0e12';
  const body = makeShape('rect', { name: 'Phone body', start: o.start, duration: o.duration, width: w, height: h, radius: r, x: o.x, y: o.y, rotation: rot, fill: bodyCol, stroke: { color: '#3a3d47', width: 3 }, shadow: softShadow(env, 1.4), anim: A('soft-slide-up-in', 0.8, 'soft-slide-down-out', 0.5) });
  const screen = makeSlot({ name: 'Phone screen', start: o.start, duration: o.duration, width: w - bezel * 2, height: h - bezel * 2, radius: r - bezel, x: o.x, y: o.y, rotation: rot, anim: A('soft-slide-up-in', 0.8, 'soft-slide-down-out', 0.5) });
  const a = (rot * Math.PI) / 180;
  const ny = -h / 2 + bezel + Math.round(h * 0.022);
  const notch = makeShape('pill', { name: 'Phone notch', start: o.start, duration: o.duration, width: Math.round(w * 0.3), height: Math.round(h * 0.026), x: o.x - ny * Math.sin(a), y: o.y + ny * Math.cos(a), rotation: rot, fill: bodyCol, anim: A('soft-slide-up-in', 0.8, 'soft-slide-down-out', 0.5) });
  return { clips: [body, screen, notch], w };
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Flash sale
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-flash-sale',
    name: 'Flash Sale Blast',
    category: 'promo',
    tags: ['sale', 'discount', 'flash sale', 'offer', 'shop', 'ecommerce', 'percent off'],
    duration: 6,
    poster: 0.6,
    music: { soundId: 'music-funk-groove' },
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['stripes', 'halftone', 'dots'] as const), { duration: d });
      const side = pick(r, ['left', 'right'] as const);
      const z = split(L, { media: L.wide ? 0.42 : L.tall ? 0.5 : 0.44, mediaSide: side, sideMid: false });
      const align = z.stacked ? 'center' : 'left';
      const pop = vivid(env, c.bg, 3, ['accent', 'primary', 'secondary']);
      const out = A(undefined, 0, 'fade-out', 0.4);

      const m = fitAspect(z.media, z.stacked ? 1.15 : 0.8, 0.96);
      const tiltDeg = z.stacked ? 0 : side === 'right' ? 3 : -3;
      const plate = makeShape('rect', { name: 'Accent plate', start: 0.15, duration: till(d, 0.15), width: m.w, height: m.h, radius: 44, x: z.media.x + (side === 'right' ? 26 : -26), y: z.media.y + 26, rotation: tiltDeg * 2, fill: linear(135, c.primary, pop), anim: A('zoom-in', 0.6, 'fade-out', 0.4) });
      const media = makeSlot({ name: 'Product photo', start: 0.3, duration: till(d, 0.3), width: m.w, height: m.h, radius: 44, x: z.media.x, y: z.media.y, rotation: tiltDeg, shadow: softShadow(env), anim: A('zoom-blur-in', 0.7, 'fade-out', 0.4) });
      const bs = Math.round(Math.min(m.w, m.h) * (z.stacked ? 0.36 : 0.34));
      const badge = makeSticker('badge-flash-sale', { name: 'Flash badge', start: 1.0, duration: till(d, 1.0), size: bs, colors: [c.primary, c.secondary, textOn(env, c.primary)], x: z.media.x + (side === 'right' || z.stacked ? 1 : -1) * (m.w / 2 - bs * 0.15), y: z.media.y - m.h / 2 + bs * 0.15, anim: A('twist-pop-in', 0.55, 'pop-out', 0.3, 'beat', 1.2) });

      const big = L.wide ? 170 : L.tall ? 168 : L.mid ? 132 : 112;
      const kicker = pill(env, 'Today only', { size: L.tall ? 36 : 30, fill: c.text, color: c.bg, upper: true, track: 0.2, start: 0.4, duration: till(d, 0.4), anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const title = H(env, 'Flash Sale', { name: 'Title', start: 0.55, duration: till(d, 0.55), size: big, maxWidth: z.text.w, maxLines: z.stacked ? 1 : 2, style: { align }, textAnim: { in: { id: 'char-stomp-in', duration: 0.8 } }, anim: out });
      const offer = H(env, '50% off', { name: 'Offer', start: 1.1, duration: till(d, 1.1), size: Math.round(big * 1.12), color: pop, maxWidth: z.text.w, maxLines: 1, style: { align }, textAnim: { in: { id: 'word-punch-in', duration: 0.8 } }, anim: out });
      const sub = strong(env, 'Ends tonight at midnight', { name: 'Deadline', start: 1.6, duration: till(d, 1.6), size: L.tall ? 48 : L.wide ? 44 : 36, weight: 500, color: alpha(c.text, 0.85), maxWidth: z.text.w, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const cta = pill(env, 'Shop now', { size: L.tall ? 44 : L.wide ? 40 : 34, fill: c.primary, start: 2.0, duration: till(d, 2.0), shadow: softShadow(env, 0.6), anim: A('pop-up-in', 0.5, 'pop-out', 0.3, 'pulse', 1.4) });
      column([pItem(kicker, 26), tItem(title, 4), tItem(offer, 18), tItem(sub, L.tall ? 48 : 36), pItem(cta)], z.text, align);
      // Shop logo (brand kit) in the bottom corner of the copy side.
      const logo = logoBug(env, z.stacked || side === 'left' ? 'br' : 'bl', { start: 0.8, duration: till(d, 0.8), anim: A('fade-in', 0.6, 'fade-out', 0.4) });

      return [bg, plate, media, badge, ...kicker.clips, title, offer, sub, ...cta.clips, logo];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. Product launch
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-product-launch',
    name: 'Product Launch Reveal',
    category: 'promo',
    tags: ['launch', 'product', 'introducing', 'tech', 'reveal', 'specs', 'new'],
    duration: 8,
    poster: 0.62,
    music: { soundId: 'music-deep-house', volume: 0.7 },
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['spot', 'glow'] as const), { duration: d });
      const z = split(L, { media: L.square ? 0.42 : 0.48, mediaSide: 'left', sideMid: false });
      const align = z.stacked ? 'center' : 'left';
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.45);

      const m = fitAspect(z.media, 1, z.stacked ? 0.9 : 0.86);
      const glow = makeShape('ellipse', { name: 'Glow', start: 0.2, duration: till(d, 0.2), width: m.w * 1.6, height: m.h * 1.6, x: z.media.x, y: z.media.y, fill: radial(alpha(c.primary, c.dark ? 0.55 : 0.3), alpha(c.primary, 0)), anim: A('fade-in', 1.0, 'fade-out', 0.5, 'breathe', 4) });
      const floor = makeShape('ellipse', { name: 'Floor shadow', start: 0.6, duration: till(d, 0.6), width: m.w * 0.8, height: Math.round(m.h * 0.08), x: z.media.x, y: z.media.y + m.h / 2 + 34, fill: radial(alpha('#000000', c.dark ? 0.6 : 0.25), alpha('#000000', 0)), anim: A('stretch-h-in', 0.7, 'fade-out', 0.4) });
      const media = makeSlot({ name: 'Product shot', start: 0.5, duration: till(d, 0.5), width: m.w, height: m.h, radius: 56, x: z.media.x, y: z.media.y, anim: A('zoom-blur-in', 0.9, 'zoom-soft-out', 0.5, 'hover', 5) });

      const intro = label(env, 'Introducing', { start: 1.0, duration: till(d, 1.0), size: L.tall ? 38 : 32, color: pop, track: 0.3, textAnim: { in: { id: 'tracking-in', duration: 1.0 } }, anim: out });
      const name = H(env, 'Nova Buds Pro', { name: 'Product name', start: 1.4, duration: till(d, 1.4), size: L.wide ? 150 : L.tall ? 150 : L.mid ? 118 : 100, maxWidth: z.text.w, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-blur-in', duration: 1.0 } }, anim: out });
      const tag = B(env, 'Silence the noise. Keep the music.', { name: 'Tagline', start: 2.0, duration: till(d, 2.0), size: L.tall ? 46 : L.wide ? 42 : 36, color: c.textMuted, maxWidth: z.text.w, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.4) });

      const makeSpecs = (k: number) =>
        [
          ['48h', 'Battery'],
          ['IP68', 'Waterproof'],
          ['4.2 g', 'Per bud'],
        ].map(([v, l], i) => {
          const s = 2.5 + i * 0.18;
          const val = H(env, v, { name: `Spec ${i + 1}`, start: s, duration: till(d, s), size: Math.round((L.tall ? 76 : L.wide ? 68 : 54) * k), color: c.text, style: { letterSpacing: 0 }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
          const lab = label(env, l, { start: s + 0.08, duration: till(d, s + 0.08), size: Math.round((L.tall ? 28 : L.wide ? 25 : 21) * Math.max(0.8, k)), color: c.textMuted, track: 0.1, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
          return { val, lab, w: Math.max(val.metrics.inkWidth, lab.metrics.inkWidth), h: val.metrics.height + 4 + lab.metrics.height };
        });
      const specGap = L.wide ? 64 : L.tall ? 56 : 44;
      let specs = makeSpecs(1);
      const natural = specs.reduce((s, x) => s + x.w, 0) + specGap * 2;
      // Wide faces: shrink the spec row until it fits the copy column.
      if (natural > z.text.w) specs = makeSpecs(Math.max(0.55, (z.text.w - specGap * 2) / (natural - specGap * 2)));
      const specsW = specs.reduce((s, x) => s + x.w, 0) + specGap * 2;
      const specsH = Math.max(...specs.map((s) => s.h));
      const cta = pill(env, 'Available now', { size: L.tall ? 40 : 34, fill: c.primary, start: 3.2, duration: till(d, 3.2), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      const price = strong(env, 'From $199', { name: 'Price', start: 3.4, duration: till(d, 3.4), size: L.tall ? 42 : 36, weight: 600, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.35) });
      const ctaRow = holder();
      const specRow = holder();
      // Button and price share a row when they fit, otherwise the price drops below.
      const inline = cta.w + 32 + price.metrics.inkWidth <= z.text.w;
      const rowW = inline ? cta.w + 32 + price.metrics.inkWidth : Math.max(cta.w, price.metrics.inkWidth);
      const rowH = inline ? cta.h : cta.h + 16 + price.metrics.height;
      column([tItem(intro, 14), tItem(name, 18), tItem(tag, L.tall ? 56 : 44), { clips: [specRow], w: specsW, h: specsH, gap: L.tall ? 60 : 48 }, { clips: [ctaRow], w: rowW, h: rowH }], z.text, align);
      const specLeft = specRow.transform.x - specsW / 2;
      hrow(specs.map((s) => ({ clips: [s.val, s.lab], w: s.w })), { left: specLeft, gap: specGap });
      for (const s of specs) {
        const top = specRow.transform.y - specsH / 2;
        s.val.transform.y = Math.round(top + s.val.metrics.height / 2);
        s.lab.transform.y = Math.round(top + s.val.metrics.height + 4 + s.lab.metrics.height / 2);
      }
      const ctaLeft = ctaRow.transform.x - rowW / 2;
      if (inline) {
        setXY(cta.clips, ctaLeft + cta.w / 2, ctaRow.transform.y);
        price.transform.y = ctaRow.transform.y;
        alignLeft(price, ctaLeft + cta.w + 32);
      } else {
        const top = ctaRow.transform.y - rowH / 2;
        const cx = align === 'left' ? ctaLeft + cta.w / 2 : ctaRow.transform.x;
        setXY(cta.clips, cx, top + cta.h / 2);
        price.transform.y = Math.round(top + cta.h + 16 + price.metrics.height / 2);
        if (align === 'left') alignLeft(price, ctaLeft);
        else price.transform.x = Math.round(ctaRow.transform.x);
      }

      // Maker's logo (brand kit): top corner of the frame.
      const logo = logoBug(env, z.stacked ? 'tl' : 'tr', { start: 1.0, duration: till(d, 1.0), anim: A('fade-in', 0.6, 'fade-out', 0.4) });

      return [bg, glow, floor, media, intro, name, tag, ...specs.flatMap((s) => [s.val, s.lab]), ...cta.clips, price, logo];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Price drop card
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-price-drop',
    name: 'Price Drop Card',
    category: 'promo',
    tags: ['price', 'deal', 'discount', 'product', 'shop', 'card', 'strike through'],
    duration: 7,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'flow', 'grid'] as const), { duration: d });
      const out = A(undefined, 0, 'fade-out', 0.4);
      const sideBySide = L.wide || L.square;
      const cardW = L.wide ? Math.min(1560, L.s.w) : L.s.w + (L.tall ? 20 : 0);
      const cardH = L.wide ? 800 : L.square ? 880 : L.tall ? 1420 : 1040;
      const pad = L.wide ? 48 : 40;
      const pop = vivid(env, c.surface, 3, ['accent', 'primary', 'secondary']);

      const card = makeShape('rect', { name: 'Card', start: 0.1, duration: till(d, 0.1), width: cardW, height: cardH, radius: 48, fill: c.surface, shadow: softShadow(env, 1.2), anim: A('spring-up-in', 0.6, 'fade-out', 0.4) });
      const mediaBox: Box = sideBySide
        ? { x: -cardW / 2 + pad + (cardW * 0.46 - pad) / 2, y: 0, w: cardW * 0.46 - pad, h: cardH - pad * 2 }
        : { x: 0, y: -cardH / 2 + pad + (cardH * 0.46 - pad) / 2, w: cardW - pad * 2, h: cardH * 0.46 - pad };
      const textBox: Box = sideBySide
        ? { x: cardW * 0.46 / 2 + 24, y: 0, w: cardW * 0.54 - pad * 2 - 24, h: cardH - pad * 2 }
        : { x: 0, y: cardH * 0.46 / 2 + 8, w: cardW - pad * 2 - 40, h: cardH * 0.54 - pad * 2 };
      const media = makeSlot({ name: 'Product photo', start: 0.35, duration: till(d, 0.35), width: Math.round(mediaBox.w), height: Math.round(mediaBox.h), radius: 32, x: mediaBox.x, y: mediaBox.y, anim: A('wipe-up-in', 0.7, 'fade-out', 0.4) });
      const save = pill(env, 'Save 28%', { size: L.tall ? 34 : 28, fill: c.accent, upper: true, track: 0.1, start: 2.4, duration: till(d, 2.4), anim: A('twist-pop-in', 0.5, 'pop-out', 0.3) });
      setXY(save.clips, mediaBox.x - mediaBox.w / 2 + 28 + save.w / 2, mediaBox.y - mediaBox.h / 2 + 28 + save.h / 2);

      const align = sideBySide ? 'left' : 'center';
      const cat = label(env, 'Wireless headphones', { start: 0.7, duration: till(d, 0.7), size: L.tall ? 28 : 24, color: c.textMuted, track: 0.16, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const name = H(env, 'Aura Max', { name: 'Product name', start: 0.85, duration: till(d, 0.85), size: L.wide ? 120 : L.tall ? 124 : L.square ? 84 : 100, maxWidth: textBox.w, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-rise-in', duration: 0.7 } }, anim: out });
      const stars = makeSticker('star-rating', { name: 'Rating', start: 1.2, duration: till(d, 1.2), size: L.tall ? 52 : 44, colors: ['#ffc531', '#ff9d00', mix(c.surface, c.text, 0.3)], anim: A('wipe-right-in', 0.6, 'fade-out', 0.35) });
      const starsW = (L.tall ? 52 : 44) * 4.2;
      const oldP = B(env, '$249', { name: 'Old price', start: 1.5, duration: till(d, 1.5), size: L.tall ? 64 : L.wide ? 56 : 48, color: c.textMuted, anim: A('fade-in', 0.4, 'fade-out', 0.35) });
      const newP = H(env, '$179', { name: 'New price', start: 2.1, duration: till(d, 2.1), size: L.tall ? 150 : L.wide ? 140 : L.square ? 104 : 120, maxWidth: textBox.w - oldP.metrics.inkWidth - 28, maxLines: 1, color: pop, style: { letterSpacing: 0 }, anim: A('pop-in', 0.5, 'pop-out', 0.3) });
      const strike = makeShape('rect', { name: 'Strike', start: 1.8, duration: till(d, 1.8), width: Math.round(oldP.metrics.inkWidth + 16), height: 6, radius: 3, rotation: -10, fill: c.accent, anim: A('wipe-right-in', 0.35, 'fade-out', 0.35) });
      const cta = pill(env, 'Shop the deal', { size: L.tall ? 40 : 34, fill: c.primary, start: 2.7, duration: till(d, 2.7), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      const priceRow = holder();
      const starRow = holder();
      const pGap = 28;
      const priceW = oldP.metrics.inkWidth + pGap + newP.metrics.inkWidth;
      column([tItem(cat, 10), tItem(name, 16), { clips: [starRow], w: starsW, h: L.tall ? 52 : 44, gap: 24 }, { clips: [priceRow], w: priceW, h: newP.metrics.height, gap: L.tall ? 40 : 30 }, pItem(cta)], textBox, align);
      setXY([stars], starRow.transform.x, starRow.transform.y);
      const pl = priceRow.transform.x - priceW / 2;
      setXY([oldP, strike], pl + oldP.metrics.inkWidth / 2, priceRow.transform.y + newP.metrics.height * 0.12);
      setXY([newP], pl + oldP.metrics.inkWidth + pGap + newP.metrics.inkWidth / 2, priceRow.transform.y);
      void r;

      return [bg, card, media, ...save.clips, cat, name, stars, oldP, strike, newP, ...cta.clips];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. App feature promo with a phone mockup
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-app-feature',
    name: 'App Feature Promo',
    category: 'promo',
    tags: ['app', 'phone', 'mockup', 'download', 'saas', 'feature', 'screen recording'],
    duration: 8,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'aurora', 'grid'] as const), { duration: d });
      const out = A(undefined, 0, 'fade-out', 0.4);
      const pop = vivid(env, c.bg);
      const stacked = L.tall;
      const side = pick(r, ['left', 'right'] as const);
      const z = split(L, { media: L.wide ? 0.4 : 0.44, mediaSide: side, sideMid: true });
      const align = stacked ? 'center' : 'left';

      const kicker = label(env, 'Weekly planner', { start: 0.3, duration: till(d, 0.3), size: L.tall ? 34 : 28, color: pop, track: 0.2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const head = H(env, 'Plan your week in seconds', { name: 'Headline', start: 0.45, duration: till(d, 0.45), size: L.tall ? 112 : L.wide ? 108 : L.mid ? 78 : 74, maxWidth: stacked ? L.s.w : z.text.w, maxLines: 3, style: { align }, textAnim: { in: { id: 'word-rise-in', duration: 0.8 } }, anim: out });
      const cta = pill(env, 'Download free', { size: L.tall ? 42 : L.wide ? 38 : 32, fill: c.primary, start: 2.6, duration: till(d, 2.6), shadow: softShadow(env, 0.5), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      const starsS = L.tall ? 44 : 36;
      const stars = makeSticker('star-rating', { name: 'Rating', start: 2.9, duration: till(d, 2.9), size: starsS, colors: ['#ffc531', '#ff9d00', mix(c.bg, c.text, 0.3)], anim: A('wipe-right-in', 0.6, 'fade-out', 0.35) });
      const rating = B(env, '4.9 · 12K reviews', { name: 'Rating text', start: 3.0, duration: till(d, 3.0), size: L.tall ? 32 : 26, color: c.textMuted, anim: A('fade-in', 0.5, 'fade-out', 0.35) });

      if (stacked) {
        const sub = B(env, 'Drag, drop and done. Your calendar, finally calm.', { name: 'Sub', start: 0.9, duration: till(d, 0.9), size: 44, color: c.textMuted, maxWidth: L.s.w, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
        const ph = Math.max(620, Math.min(900, L.s.h - (kicker.metrics.height + head.metrics.height + sub.metrics.height + cta.h + starsS + 18 + 22 + 50 + 56 + 24) - 20));
        const pHold = holder();
        const ratingRow = holder();
        const rowW = starsS * 4.2 + 20 + rating.metrics.inkWidth;
        column([tItem(kicker, 18), tItem(head, 22), tItem(sub, 50), { clips: [pHold], w: ph * 0.49, h: ph, gap: 56 }, pItem(cta, 24), { clips: [ratingRow], w: rowW, h: starsS }], { x: 0, y: 0, w: L.s.w, h: L.s.h }, 'center');
        const p = phone(env, { h: ph, x: 0, y: pHold.transform.y, start: 0.8, duration: till(d, 0.8) });
        setXY([stars], -rowW / 2 + (starsS * 4.2) / 2, ratingRow.transform.y);
        rating.transform.y = ratingRow.transform.y;
        alignLeft(rating, -rowW / 2 + starsS * 4.2 + 20);
        return [bg, kicker, head, sub, ...p.clips, ...cta.clips, stars, rating];
      }

      const ph = Math.min(z.media.h * 0.98, z.media.w / 0.49 * 0.98);
      const p = phone(env, { h: ph, x: z.media.x, y: z.media.y, start: 0.8, duration: till(d, 0.8), rotation: side === 'right' ? -4 : 4 });
      const fs = L.wide ? 40 : L.mid ? 32 : 30;
      const bullets = ['Smart time blocks', 'Shared family calendar', 'Focus mode that sticks'].map((t, i) => {
        const s = 1.4 + i * 0.25;
        const icon = makeSticker('check-circle', { name: `Check ${i + 1}`, start: s, duration: till(d, s), size: Math.round(fs * 1.25), colors: [pop, textOn(env, pop)], anim: A('pop-in', 0.4, 'fade-out', 0.35) });
        const txt = strong(env, t, { name: `Feature ${i + 1}`, start: s + 0.1, duration: till(d, s + 0.1), size: fs, weight: 600, maxWidth: z.text.w - fs * 1.25 - 20, maxLines: 1, style: { align: 'left' }, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.35) });
        const hold = holder();
        return { icon, txt, hold, item: { clips: [hold], w: z.text.w, h: Math.max(fs * 1.25, txt.metrics.height), gap: 18 } as Item };
      });
      bullets[2].item.gap = L.wide ? 48 : 36;
      const ratingRow = holder();
      const rowW = starsS * 4.2 + 18 + rating.metrics.inkWidth;
      column([tItem(kicker, 18), tItem(head, L.wide ? 40 : 28), ...bullets.map((b) => b.item), pItem(cta, 24), { clips: [ratingRow], w: rowW, h: starsS }], z.text, 'left');
      const left = z.text.x - z.text.w / 2;
      for (const b of bullets) {
        setXY([b.icon], left + (fs * 1.25) / 2, b.hold.transform.y);
        b.txt.transform.y = b.hold.transform.y;
        alignLeft(b.txt, left + fs * 1.25 + 20);
      }
      setXY([stars], left + (starsS * 4.2) / 2, ratingRow.transform.y);
      rating.transform.y = ratingRow.transform.y;
      alignLeft(rating, left + starsS * 4.2 + 18);
      return [bg, ...p.clips, kicker, head, ...bullets.flatMap((b) => [b.icon, b.txt]), ...cta.clips, stars, rating];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 5. Coupon ticket
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-coupon',
    name: 'Coupon Code Ticket',
    category: 'promo',
    tags: ['coupon', 'promo code', 'discount', 'voucher', 'ticket', 'offer', 'first order'],
    duration: 7,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, 'solid', { duration: d });
      const out = A(undefined, 0, 'fade-out', 0.4);
      const horizontal = L.wide;
      const W = horizontal ? Math.min(1560, L.s.w) : L.square ? 780 : L.s.w;
      const Hh = horizontal ? 640 : L.square ? L.s.h : L.tall ? 1300 : 1040;
      const stubF = 0.34;
      const ink = textOn(env, c.primary);
      const deg = pick(r, [-2, 0, 2]);

      const ticket = makeShape('rect', { name: 'Ticket', start: 0.2, duration: till(d, 0.2), width: W, height: Hh, radius: 40, rotation: 0, fill: linear(135, c.primary, mix(c.primary, c.accent, 0.3)), shadow: softShadow(env, 1.3), anim: A('drop-in', 0.9, 'fade-out', 0.4) });
      const nd = horizontal ? 110 : 96;
      const perfPos = horizontal ? W / 2 - W * stubF : Hh / 2 - Hh * stubF;
      const notches = [-1, 1].map((s) =>
        makeShape('ellipse', { name: 'Notch', start: 0.2, duration: till(d, 0.2), width: nd, height: nd, x: horizontal ? perfPos : s * (W / 2), y: horizontal ? s * (Hh / 2) : perfPos, fill: c.bg, anim: A('drop-in', 0.9, 'fade-out', 0.4) }),
      );
      const perf = makeShape('rect', { name: 'Perforation', start: 0.8, duration: till(d, 0.8), width: horizontal ? 4 : W - nd - 40, height: horizontal ? Hh - nd - 40 : 4, x: horizontal ? perfPos : 0, y: horizontal ? 0 : perfPos, radius: 2, fill: alpha(ink, 0.45), anim: A(horizontal ? 'wipe-down-in' : 'wipe-right-in', 0.6, 'fade-out', 0.35) });

      const main: Box = horizontal ? { x: -W / 2 + (W * (1 - stubF)) / 2, y: 0, w: W * (1 - stubF) - 120, h: Hh - 80 } : { x: 0, y: -Hh / 2 + (Hh * (1 - stubF)) / 2, w: W - 120, h: Hh * (1 - stubF) - 80 };
      const stub: Box = horizontal ? { x: W / 2 - (W * stubF) / 2, y: 0, w: W * stubF - 100, h: Hh - 80 } : { x: 0, y: Hh / 2 - (Hh * stubF) / 2, w: W - 120, h: Hh * stubF - 60 };
      const big = horizontal ? 190 : L.tall ? 200 : L.square ? 130 : 160;
      const extra = label(env, 'Extra', { start: 0.9, duration: till(d, 0.9), size: horizontal ? 36 : L.tall ? 40 : 30, color: alpha(ink, 0.85), track: 0.3, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
      const pct = H(env, '20% off', { name: 'Discount', start: 1.05, duration: till(d, 1.05), size: big, color: ink, maxWidth: main.w, maxLines: 2, textAnim: { in: { id: 'char-pop-in', duration: 0.8 } }, anim: out });
      const first = B(env, 'your first order', { name: 'Condition', start: 1.5, duration: till(d, 1.5), size: horizontal ? 48 : L.tall ? 52 : 38, color: ink, maxWidth: main.w, maxLines: 2, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
      column([tItem(extra, 10), tItem(pct, 14), tItem(first)], main, 'center');

      const use = label(env, 'Use code', { start: 1.9, duration: till(d, 1.9), size: horizontal ? 32 : L.tall ? 34 : 28, color: alpha(ink, 0.85), track: 0.24, anim: A('fade-in', 0.45, 'fade-out', 0.35) });
      const code = pill(env, 'SPRING20', { size: horizontal ? 56 : L.tall ? 62 : 46, fill: alpha('#000000', 0.16), color: ink, radius: 18, upper: true, track: 0.12, padX: 34, padY: 16, maxWidth: stub.w, stroke: { color: alpha(ink, 0.7), width: 3 }, start: 2.1, duration: till(d, 2.1), anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const valid = B(env, 'Valid until May 31', { name: 'Validity', start: 2.4, duration: till(d, 2.4), size: horizontal ? 34 : L.tall ? 38 : 30, color: alpha(ink, 0.8), anim: A('fade-in', 0.45, 'fade-out', 0.35) });
      column([tItem(use, 16), pItem(code, 16), tItem(valid)], stub, 'center');

      const body: Clip[] = [ticket, ...notches, perf, extra, pct, first, use, ...code.clips, valid];
      if (deg !== 0) {
        const a = (deg * Math.PI) / 180;
        for (const cl of body as (ShapeClip | Txt)[]) {
          const { x, y } = cl.transform;
          cl.transform.x = Math.round(x * Math.cos(a) - y * Math.sin(a));
          cl.transform.y = Math.round(x * Math.sin(a) + y * Math.cos(a));
          cl.transform.rotation += deg;
        }
      }
      const ss = horizontal ? 260 : 230;
      const conf = makeSticker('confetti-burst', { name: 'Confetti', start: 1.2, duration: till(d, 1.2), size: ss, colors: [c.primary, c.secondary, c.accent, mix(c.primary, '#ffffff', 0.5)], x: -W / 2 + 10, y: -Hh / 2 + 10, anim: A('pop-in', 0.5, 'fade-out', 0.4) });
      const gift = makeSticker('emoji-1f381', { name: 'Gift', start: 1.4, duration: till(d, 1.4), size: horizontal ? 170 : 150, x: W / 2 - 20, y: Hh / 2 - 10, rotation: 12, anim: A('twist-pop-in', 0.55, 'pop-out', 0.3, 'wiggle', 1.8) });
      return [bg, conf, ...body, gift];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 6. New collection collage
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-new-collection',
    name: 'New Collection Drop',
    category: 'promo',
    tags: ['fashion', 'collection', 'lookbook', 'collage', 'editorial', 'drop', 'season'],
    duration: 8,
    poster: 0.6,
    music: { soundId: 'music-deep-house', volume: 0.7 },
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['paper', 'solid', 'linear'] as const), { duration: d });
      const out = A(undefined, 0, 'fade-out', 0.4);
      const pop = vivid(env, c.bg);
      const g = L.wide ? 24 : 20;
      const slotAnim = (i: number): { in: { id: string; duration: number }; out: { id: string; duration: number }; loop: { id: string; duration: number } } => ({ in: { id: pick(r, ['mask-up-in', 'mask-left-in', 'wipe-down-in']), duration: 0.8 }, out: { id: 'fade-out', duration: 0.4 }, loop: { id: 'slow-zoom', duration: 9 + i } });

      let boxes: Box[];
      let text: Box;
      let align: 'left' | 'center' = 'left';
      if (L.wide) {
        const cw = L.s.w * 0.6;
        const cx = L.s.hw - cw / 2;
        const aw = cw * 0.56;
        const bw = cw - aw - g;
        boxes = [
          { x: cx - cw / 2 + aw / 2, y: 0, w: aw, h: L.s.h + L.s.my },
          { x: cx + cw / 2 - bw / 2, y: -(L.s.h + L.s.my) / 4 - g / 4, w: bw, h: (L.s.h + L.s.my - g) / 2 },
          { x: cx + cw / 2 - bw / 2, y: (L.s.h + L.s.my) / 4 + g / 4, w: bw, h: (L.s.h + L.s.my - g) / 2 },
        ];
        text = { x: -L.s.hw + (L.s.w * 0.36) / 2, y: 0, w: L.s.w * 0.36, h: L.s.h };
      } else {
        const textH = L.tall ? L.s.h * 0.34 : L.square ? L.s.h * 0.34 : L.s.h * 0.36;
        const top = -L.s.hh + textH + g * 2;
        const ch = L.s.hh - top + (L.tall ? 0 : L.s.my * 0.4);
        const ah = L.square ? ch : ch * 0.6;
        if (L.square) {
          const w3 = (L.s.w - g * 2) / 3;
          boxes = [0, 1, 2].map((i) => ({ x: -L.s.hw + w3 / 2 + i * (w3 + g), y: top + ch / 2, w: w3, h: ch }));
        } else {
          const bh = ch - ah - g;
          const half = (L.s.w - g) / 2;
          boxes = [
            { x: 0, y: top + ah / 2, w: L.s.w, h: ah },
            { x: -L.s.hw + half / 2, y: top + ah + g + bh / 2, w: half, h: bh },
            { x: L.s.hw - half / 2, y: top + ah + g + bh / 2, w: half, h: bh },
          ];
        }
        text = { x: 0, y: -L.s.hh + textH / 2, w: L.s.w, h: textH };
        align = 'center';
      }
      const slots = boxes.map((b, i) => makeSlot({ name: `Look ${i + 1}`, start: 0.3 + i * 0.25, duration: till(d, 0.3 + i * 0.25), width: Math.round(b.w), height: Math.round(b.h), radius: 18, x: b.x, y: b.y, anim: slotAnim(i) }));

      const season = label(env, 'Spring / Summer 26', { start: 0.9, duration: till(d, 0.9), size: L.tall ? 32 : 26, color: pop, track: 0.24, anim: A('fade-in', 0.6, 'fade-out', 0.35) });
      const title = H(env, 'New Collection', { name: 'Title', start: 1.1, duration: till(d, 1.1), size: L.wide ? 150 : L.tall ? 150 : L.square ? 96 : 120, maxWidth: text.w, maxLines: L.wide ? 3 : 2, minSize: 40, style: { align, lineHeight: 0.98 }, textAnim: { in: { id: 'line-rise-in', duration: 0.9 } }, anim: out });
      const line = B(env, 'Light layers for long days', { name: 'Sub', start: 1.6, duration: till(d, 1.6), size: L.tall ? 42 : L.wide ? 38 : 32, color: c.textMuted, maxWidth: text.w, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const cta = pill(env, 'Shop the drop', { size: L.tall ? 38 : L.wide ? 34 : 28, fill: c.text, color: c.bg, start: 2.0, duration: till(d, 2.0), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      column([tItem(season, 16), tItem(title, 20), tItem(line, L.square ? 22 : 36), pItem(cta)], text, align);

      return [bg, ...slots, season, title, line, ...cta.clips];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 7. Limited offer marquee over footage
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-promo-limited-offer',
    name: 'Limited Offer Marquee',
    category: 'promo',
    tags: ['limited time', 'offer', 'bogo', 'marquee', 'ticker', 'cafe', 'restaurant', 'weekend'],
    duration: 6,
    poster: 0.55,
    music: { soundId: 'music-future-bass', volume: 0.7 },
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const out = A(undefined, 0, 'fade-out', 0.4);
      const accent = popOnDark(env, ['accent', 'secondary', 'primary']);

      const media = makeSlot({ name: 'Background photo', width: L.cw, height: L.ch, duration: d, anim: A('zoom-soft-in', 0.8, undefined, 0, 'slow-zoom', 10) });
      const tint = makeShape('rect', { name: 'Brand tint', duration: d, width: L.cw, height: L.ch, fill: linear(120, alpha(mix(c.primary, '#000000', 0.35), 0.78), alpha('#06070b', 0.7)), anim: A('fade-in', 0.6) });

      const band = (y: number, deg: number, dir: 1 | -1, start: number, fill: string): Clip[] => {
        const ink = textOn(env, fill);
        const unit = 'Limited time  •  ';
        const txt = H(env, unit.repeat(8), { name: 'Marquee text', start, duration: till(d, start), size: L.wide ? 64 : 58, color: ink, style: { letterSpacing: 0.06, uppercase: true, lineHeight: 1.1 } });
        const unitW = txt.metrics.width / 8;
        const bandH = Math.round(txt.metrics.height + 36);
        const len = Math.max(L.cw, L.ch) * 1.6;
        const strip = makeShape('rect', { name: 'Marquee band', start, duration: till(d, start), width: Math.round(len), height: bandH, y, rotation: deg, fill, shadow: { color: alpha('#000000', 0.35), blur: 24, x: 0, y: 8 }, anim: A(dir > 0 ? 'wipe-right-in' : 'wipe-left-in', 0.6, 'fade-out', 0.35) });
        const a = (deg * Math.PI) / 180;
        const travel = unitW * 2 * dir;
        const dur = till(d, start);
        txt.transform.y = y;
        txt.transform.rotation = deg;
        txt.keyframes = {
          x: [kf(0, -travel / 2 * Math.cos(a), 'linear'), kf(dur, (travel / 2) * Math.cos(a), 'linear')],
          y: [kf(0, y - (travel / 2) * Math.sin(a), 'linear'), kf(dur, y + (travel / 2) * Math.sin(a), 'linear')],
        };
        txt.anim = A('fade-in', 0.5, 'fade-out', 0.35);
        return [strip, txt];
      };
      const topY = L.portrait ? -L.s.hh + 10 : -L.hh + 120;
      const botY = L.portrait ? L.s.hh - 10 : L.hh - 120;
      const bands = [...band(topY, -5, 1, 0.3, accent), ...band(botY, 4, -1, 0.5, '#f7f7f2')];

      const w = L.wide ? 1300 : L.s.w;
      const kicker = label(env, 'This weekend only', { start: 0.9, duration: till(d, 0.9), size: L.tall ? 36 : 30, color: accent, track: 0.24, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const head = H(env, 'Buy 1 Get 1 Free', { name: 'Offer', start: 1.1, duration: till(d, 1.1), size: L.tall ? 168 : L.wide ? 170 : L.mid ? 136 : 120, color: '#ffffff', maxWidth: w, maxLines: 3, style: { shadow: { color: alpha('#000000', 0.4), blur: 20, x: 0, y: 6 } }, textAnim: { in: { id: 'word-stomp-in', duration: 1.0 } }, anim: out });
      const sub = B(env, 'On every iced drink, all day Saturday and Sunday', { name: 'Details', start: 1.7, duration: till(d, 1.7), size: L.tall ? 46 : L.wide ? 42 : 36, color: alpha('#ffffff', 0.88), maxWidth: L.wide ? 1100 : L.s.w, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const cta = pill(env, 'Order ahead', { size: L.tall ? 42 : 36, fill: accent, start: 2.1, duration: till(d, 2.1), anim: A('pop-up-in', 0.5, 'pop-out', 0.3, 'pulse', 1.4) });
      column([tItem(kicker, 18), tItem(head, 24), tItem(sub, L.tall ? 50 : 38), pItem(cta)], { x: 0, y: 0, w: L.s.w, h: L.s.h }, 'center');
      void chance;

      return [media, tint, ...bands, kicker, head, sub, ...cta.clips];
    },
  },
];

export default templates;
