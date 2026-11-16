import { linear, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, backdrop, column, fitAspect, holder, hrow, label, lay, mix, pItem, pill, setXY, split, strong, tItem, textOn, till, vivid, vstack, type Box, type Txt } from './_lib/b-kit';
import { chance, pick } from './_lib/kit';

const soft = (env: TemplateEnv, k = 1): { color: string; blur: number; x: number; y: number } => ({ color: alpha('#000000', (env.palette.dark ? 0.42 : 0.14) * k), blur: 36, x: 0, y: 14 });

/** Thin ornament: a short rule on each side of a label. */
function flankRules(env: TemplateEnv, t: Txt, color: string, start: number, d: number, len = 90, gap = 28): Clip[] {
  return [-1, 1].map((s) =>
    makeShape('rect', {
      name: s < 0 ? 'Rule left' : 'Rule right',
      start,
      duration: till(d, start),
      width: len,
      height: 2,
      x: t.transform.x + s * (t.metrics.inkWidth / 2 + gap + len / 2),
      y: t.transform.y,
      fill: color,
      anim: A(s < 0 ? 'wipe-left-in' : 'wipe-right-in', 0.7, 'fade-out', 0.4),
    }),
  );
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Save the date
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-event-save-the-date',
    name: 'Save the Date',
    category: 'event',
    tags: ['save the date', 'wedding', 'engagement', 'invitation', 'couple', 'elegant', 'announcement'],
    duration: 8,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['paper', 'dust', 'glow'] as const), { duration: d });
      const pop = vivid(env, c.bg, 2.4, ['accent', 'primary', 'secondary']);
      const out = A(undefined, 0, 'fade-out', 0.6);
      const z = split(L, { media: L.wide ? 0.4 : L.square ? 0.42 : 0.5, mediaSide: chance(r, 0.5) ? 'left' : 'right', sideMid: false });
      const align = 'center';

      const m = fitAspect(z.media, z.stacked ? 0.78 : 0.66, z.stacked ? 0.94 : 0.96);
      const arch = makeShape('rect', { name: 'Arch outline', start: 0.4, duration: till(d, 0.4), width: m.w + 36, height: m.h + 36, radius: (m.w + 36) / 2, x: z.media.x, y: z.media.y, fill: alpha(c.bg, 0), stroke: { color: alpha(pop, 0.7), width: 2 }, anim: A('fade-in', 1.2, 'fade-out', 0.6) });
      const photo = makeSlot({ name: 'Couple photo', start: 0.2, duration: till(d, 0.2), width: m.w, height: m.h, radius: m.w / 2, x: z.media.x, y: z.media.y, filter: { id: 'soft-skin', intensity: 0.5 }, anim: A('focus-in', 1.0, 'fade-out', 0.6, 'breathe', 8) });

      const k = L.tall ? 1.1 : L.wide ? 1 : L.square ? 0.78 : 0.92;
      const save = label(env, 'Save the date', { start: 0.9, duration: till(d, 0.9), size: Math.round(30 * k), color: pop, track: 0.34, anim: A('fade-in', 1.0, 'fade-out', 0.5) });
      const names = H(env, 'Olivia & James', { name: 'Names', start: 1.2, duration: till(d, 1.2), size: Math.round(120 * k), maxWidth: z.text.w, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-blur-in', duration: 1.4 } }, anim: out });
      const date = H(env, '09 · 20 · 2027', { name: 'Date', start: 2.0, duration: till(d, 2.0), size: Math.round(76 * k), color: pop, maxWidth: z.text.w, maxLines: 1, style: { letterSpacing: 0.06, uppercase: false }, anim: A('blur-in', 0.9, 'fade-out', 0.5) });
      const place = B(env, 'Rosewood Estate · Napa Valley', { name: 'Venue', start: 2.4, duration: till(d, 2.4), size: Math.round(38 * k), color: c.textMuted, maxWidth: z.text.w, maxLines: 2, style: { align }, anim: A('fade-in', 0.9, 'fade-out', 0.5) });
      const note = label(env, 'Invitation to follow', { start: 2.8, duration: till(d, 2.8), size: Math.round(22 * k), color: c.textMuted, track: 0.24, anim: A('fade-in', 0.9, 'fade-out', 0.5) });
      column([tItem(save, Math.round(36 * k)), tItem(names, Math.round(30 * k)), tItem(date, Math.round(26 * k)), tItem(place, Math.round(56 * k)), tItem(note)], z.text, align);
      const rules = flankRules(env, save, alpha(pop, 0.7), 1.1, d, Math.round(70 * k), 26);

      return [bg, arch, photo, save, ...rules, names, date, place, note];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. Webinar announcement
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-event-webinar',
    name: 'Live Webinar Announcement',
    category: 'event',
    tags: ['webinar', 'live', 'online event', 'workshop', 'speaker', 'register', 'talk'],
    duration: 8,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['grid', 'mesh', 'flow'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const side = L.wide || L.square;
      const k = L.tall ? 1.24 : L.wide ? 1.1 : L.square ? 0.8 : 0.94;

      // Live pill with a blinking dot.
      const live = pill(env, 'Live webinar', { size: Math.round(30 * k), fill: alpha('#e5484d', 0.14), color: c.text, upper: true, track: 0.18, padX: Math.round(30 * k) + 34, stroke: { color: alpha('#e5484d', 0.6), width: 2 }, start: 0.2, duration: till(d, 0.2), anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const dot = makeShape('ellipse', { name: 'Live dot', start: 0.35, duration: till(d, 0.35), width: Math.round(18 * k), height: Math.round(18 * k), fill: '#e5484d', anim: A('pop-in', 0.3, 'fade-out', 0.3, 'fade-pulse', 1.2) });
      const textW = side ? L.s.w * 0.54 : L.s.w;
      const align = side ? 'left' : 'center';
      const title = H(env, 'Scaling Design Systems in 2027', { name: 'Title', start: 0.5, duration: till(d, 0.5), size: Math.round(112 * k), maxWidth: textW, maxLines: 3, style: { align }, textAnim: { in: { id: 'word-rise-in', duration: 0.9 } }, anim: out });

      const infoSize = Math.round(34 * k);
      const infos = [
        ['emoji-1f4c5', 'Thu, March 12'],
        ['emoji-23f0', '5 PM CET · 45 min'],
      ].map(([icon, t], i) => {
        const s = 1.4 + i * 0.2;
        const ic = makeSticker(icon, { name: `Icon ${i + 1}`, start: s, duration: till(d, s), size: Math.round(infoSize * 1.3), anim: A('pop-in', 0.4, 'fade-out', 0.3) });
        const tx = strong(env, t, { name: `Info ${i + 1}`, start: s + 0.08, duration: till(d, s + 0.08), size: infoSize, weight: 600, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.3) });
        return { ic, tx, w: infoSize * 1.3 + 14 + tx.metrics.inkWidth, h: Math.max(infoSize * 1.3, tx.metrics.height) };
      });
      const cta = pill(env, 'Register free', { size: Math.round(38 * k), fill: c.primary, start: 2.2, duration: till(d, 2.2), shadow: soft(env, 0.6), anim: A('pop-up-in', 0.5, 'pop-out', 0.3) });
      const seats = B(env, 'Limited to 500 seats', { name: 'Seats', start: 2.4, duration: till(d, 2.4), size: Math.round(28 * k), color: c.textMuted, anim: A('fade-in', 0.5, 'fade-out', 0.3) });

      // Speaker card
      const av = Math.round((side ? 260 : 200) * k);
      const spName = strong(env, 'Dr. Amara Okafor', { name: 'Speaker', start: 1.3, duration: till(d, 1.3), size: Math.round(40 * k), weight: 700, maxWidth: side ? L.s.w * 0.34 : L.s.w - av - 140, maxLines: 2, style: { align: side ? 'center' : 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.3) });
      const spRole = B(env, 'Design Lead, Northwind Labs', { name: 'Speaker role', start: 1.4, duration: till(d, 1.4), size: Math.round(28 * k), color: c.textMuted, maxWidth: side ? L.s.w * 0.34 : L.s.w - av - 140, maxLines: 2, style: { align: side ? 'center' : 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.3) });
      const tagS = label(env, 'Speaker', { start: 1.2, duration: till(d, 1.2), size: Math.round(22 * k), color: pop, track: 0.24, anim: A('fade-in', 0.5, 'fade-out', 0.3) });
      const pad = Math.round(44 * k);
      const cardW = side ? Math.max(av, spName.metrics.width, spRole.metrics.width) + pad * 2 : L.s.w;
      const cardH = side ? pad + tagS.metrics.height + 20 + av + 26 + spName.metrics.height + 6 + spRole.metrics.height + pad : av + pad * 2;
      const card = makeShape('rect', { name: 'Speaker card', start: 1.0, duration: till(d, 1.0), width: Math.round(cardW), height: Math.round(cardH), radius: 36, fill: c.surface, shadow: soft(env), anim: A('spring-up-in', 0.6, 'fade-out', 0.4) });
      const photo = makeSlot({ name: 'Speaker photo', start: 1.15, duration: till(d, 1.15), width: av, height: av, radius: av / 2, anim: A('pop-in', 0.5, 'pop-out', 0.3) });

      const infoRow = holder();
      const ctaRow = holder();
      const infoGap = 40;
      const infoW = side ? Math.max(...infos.map((x) => x.w)) : infos[0].w + infoGap + infos[1].w;
      const infoH = side ? infos[0].h + 14 + infos[1].h : Math.max(...infos.map((x) => x.h));
      const ctaW = cta.w + 28 + seats.metrics.inkWidth;

      const placeInfos = (left: number, cy: number): void => {
        if (side) {
          vstack(infos.map((x, i) => ({ clips: [x.ic, x.tx], h: x.h, gap: i === 0 ? 14 : 0 })), { centerY: cy });
          for (const x of infos) {
            setXY([x.ic], left + (infoSize * 1.3) / 2);
            alignLeft(x.tx, left + infoSize * 1.3 + 14);
          }
        } else {
          let x0 = left;
          for (const x of infos) {
            setXY([x.ic], x0 + (infoSize * 1.3) / 2, cy);
            x.tx.transform.y = Math.round(cy);
            alignLeft(x.tx, x0 + infoSize * 1.3 + 14);
            x0 += x.w + infoGap;
          }
        }
      };
      const placeCta = (left: number, cy: number): void => {
        setXY(cta.clips, left + cta.w / 2, cy);
        seats.transform.y = Math.round(cy);
        alignLeft(seats, left + cta.w + 28);
      };

      if (side) {
        const zone: Box = { x: -L.s.hw + textW / 2, y: 0, w: textW, h: L.s.h };
        column([pItem(live, 30), tItem(title, 40), { clips: [infoRow], w: infoW, h: infoH, gap: 48 }, { clips: [ctaRow], w: ctaW, h: cta.h }], zone, 'left');
        placeInfos(zone.x - zone.w / 2, infoRow.transform.y);
        placeCta(zone.x - zone.w / 2, ctaRow.transform.y);
        const cx = L.s.hw - cardW / 2;
        setXY([card], cx, 0);
        vstack([{ clips: [tagS], h: tagS.metrics.height, gap: 20 }, { clips: [photo], h: av, gap: 26 }, { clips: [spName], h: spName.metrics.height, gap: 6 }, { clips: [spRole], h: spRole.metrics.height }], { centerY: 0 });
        setXY([tagS, photo, spName, spRole], cx);
      } else {
        const cardRow = holder();
        column([pItem(live, 28), tItem(title, 40), { clips: [cardRow], w: cardW, h: cardH, gap: 40 }, { clips: [infoRow], w: infoW, h: infoH, gap: 44 }, { clips: [ctaRow], w: ctaW, h: cta.h }], { x: 0, y: 0, w: L.s.w, h: L.s.h }, 'center');
        setXY([card], 0, cardRow.transform.y);
        const left = -cardW / 2 + pad;
        setXY([photo], left + av / 2, cardRow.transform.y);
        const tH = tagS.metrics.height + 8 + spName.metrics.height + 4 + spRole.metrics.height;
        vstack([{ clips: [tagS], h: tagS.metrics.height, gap: 8 }, { clips: [spName], h: spName.metrics.height, gap: 4 }, { clips: [spRole], h: spRole.metrics.height }], { centerY: cardRow.transform.y });
        void tH;
        alignLeft(tagS, left + av + 36);
        alignLeft(spName, left + av + 36);
        alignLeft(spRole, left + av + 36);
        placeInfos(-infoW / 2, infoRow.transform.y);
        placeCta(-ctaW / 2, ctaRow.transform.y);
      }
      setXY([dot], live.box.transform.x - live.w / 2 + Math.round(30 * k) + 8, live.box.transform.y);

      return [bg, ...live.clips, dot, title, card, photo, tagS, spName, spRole, ...infos.flatMap((x) => [x.ic, x.tx]), ...cta.clips, seats];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Party / birthday invitation
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-event-party',
    name: 'Party Invite',
    category: 'event',
    tags: ['party', 'birthday', 'celebration', 'invite', 'confetti', 'rsvp', 'night out'],
    duration: 7,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['confetti', 'bokeh', 'leaks'] as const), { duration: d });
      const out = A(undefined, 0, 'fade-out', 0.4);
      const k = L.tall ? 1.15 : L.wide ? 1 : L.square ? 0.82 : 0.95;
      const pop = vivid(env, c.surface);
      const cardW = L.wide ? 1180 : L.s.w;
      const pad = Math.round(64 * k);

      const av = Math.round((L.wide ? 230 : 260) * k);
      const ring = makeShape('ellipse', { name: 'Photo ring', start: 0.5, duration: till(d, 0.5), width: av + 24, height: av + 24, fill: linear(135, c.primary, c.accent), anim: A('pop-in', 0.5, 'pop-out', 0.3) });
      const photo = makeSlot({ name: 'Birthday photo', start: 0.6, duration: till(d, 0.6), width: av, height: av, radius: av / 2, anim: A('pop-in', 0.5, 'pop-out', 0.3) });
      const invited = label(env, "You're invited", { start: 0.8, duration: till(d, 0.8), size: Math.round(30 * k), color: pop, track: 0.28, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const head = H(env, "Mia's 30th", { name: 'Headline', start: 1.0, duration: till(d, 1.0), size: Math.round(170 * k), maxWidth: cardW - pad * 2, maxLines: 2, textAnim: { in: { id: 'char-bounce-in', duration: 1.1 }, loop: { id: 'word-bounce', duration: 1.6 } }, anim: out });
      const when = strong(env, 'Saturday, Aug 22 · 9 PM till late', { name: 'When', start: 1.6, duration: till(d, 1.6), size: Math.round(42 * k), weight: 600, maxWidth: cardW - pad * 2, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const where = B(env, 'Rooftop at The Grand, 5th Ave', { name: 'Where', start: 1.8, duration: till(d, 1.8), size: Math.round(34 * k), color: c.textMuted, maxWidth: cardW - pad * 2, maxLines: 2, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const rsvp = pill(env, 'RSVP by Aug 10', { size: Math.round(36 * k), fill: c.primary, start: 2.2, duration: till(d, 2.2), anim: A('pop-up-in', 0.5, 'pop-out', 0.3, 'pulse', 1.4) });

      // The photo straddles the card's top edge: the card spans from the photo's centre to below the button.
      const items = [
        { clips: [ring, photo], h: av + 24, gap: 30 },
        { clips: [invited], h: invited.metrics.height, gap: 14 },
        { clips: [head], h: head.metrics.height, gap: 20 },
        { clips: [when], h: when.metrics.height, gap: 8 },
        { clips: [where], h: where.metrics.height, gap: 40 },
        { clips: rsvp.clips, h: rsvp.h },
      ];
      const stackH = items.reduce((s, it, i) => s + it.h + (i < items.length - 1 ? (it.gap ?? 0) : 0), 0);
      const total = stackH + pad;
      const top = -total / 2;
      vstack(items, { top });
      const cardTop = ring.transform.y;
      const cardH = Math.round(top + total - cardTop);
      const card = makeShape('rect', { name: 'Card', start: 0.2, duration: till(d, 0.2), width: cardW, height: cardH, radius: 48, y: Math.round(cardTop + cardH / 2), fill: alpha(c.surface, 0.9), shadow: soft(env, 1.3), anim: A('rubber-in', 0.8, 'fade-out', 0.4) });

      const sz = Math.round(260 * k);
      const popper = makeSticker('party-popper', { name: 'Party popper', start: 1.2, duration: till(d, 1.2), size: sz, colors: [c.primary, c.secondary, c.accent, mix(c.primary, '#ffffff', 0.5)], x: -cardW / 2 + sz * 0.15, y: card.transform.y + cardH / 2 - sz * 0.2, rotation: -10, anim: A('twist-pop-in', 0.55, 'pop-out', 0.3) });
      const balloons = makeSticker('balloons-bob', { name: 'Balloons', start: 1.0, duration: till(d, 1.0), size: Math.round(sz * 1.2), colors: [c.primary, c.secondary, c.accent], x: cardW / 2 - sz * 0.1, y: card.transform.y - cardH / 2 + sz * 0.1, anim: A('fly-up-in', 0.8, 'fade-out', 0.4) });
      const burst = makeSticker('confetti-burst', { name: 'Confetti', start: 1.4, duration: till(d, 1.4), size: Math.round(sz * 0.9), colors: [c.primary, c.secondary, c.accent, '#ffffff'], x: ring.transform.x + av * 0.7, y: ring.transform.y - av * 0.1, anim: A('pop-in', 0.5, 'fade-out', 0.35) });

      return [bg, card, ring, photo, invited, head, when, where, ...rsvp.clips, balloons, popper, burst];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Wedding invitation
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-event-wedding',
    name: 'Wedding Invitation',
    category: 'event',
    tags: ['wedding', 'invitation', 'elegant', 'monogram', 'ceremony', 'formal', 'romantic'],
    duration: 9,
    poster: 0.65,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['dust', 'paper', 'glow'] as const), { duration: d });
      const gold = vivid(env, c.bg, 2.2, ['accent', 'secondary', 'primary']);
      const out = A(undefined, 0, 'fade-out', 0.7);
      const withPhoto = chance(r, 0.5);
      const k = L.tall ? 1.3 : L.wide ? 1.04 : L.square ? 0.8 : 0.96;

      // Double border.
      const fw = L.cw - L.s.mx * (L.wide ? 1.0 : 0.9);
      const fh = L.ch - L.s.my * (L.portrait ? 0.9 : 0.8);
      const frames = [0, 1].map((i) =>
        makeShape('rect', { name: i ? 'Inner border' : 'Outer border', start: 0.1 + i * 0.2, duration: till(d, 0.1 + i * 0.2), width: Math.round(fw - i * 36), height: Math.round(fh - i * 36), radius: i ? 6 : 10, fill: alpha(c.bg, 0), stroke: { color: alpha(gold, i ? 0.5 : 0.85), width: i ? 1.5 : 3 }, anim: A('fade-in', 1.2, 'fade-out', 0.6) }),
      );

      const md = Math.round((L.wide ? 210 : 240) * k);
      const ring = makeShape('ellipse', { name: 'Monogram ring', start: 0.5, duration: till(d, 0.5), width: md, height: md, fill: alpha(c.bg, 0), stroke: { color: gold, width: 3 }, anim: A('zoom-soft-in', 0.9, 'fade-out', 0.6) });
      const mono: Clip = withPhoto
        ? makeSlot({ name: 'Couple photo', start: 0.7, duration: till(d, 0.7), width: md - 26, height: md - 26, radius: (md - 26) / 2, anim: A('focus-in', 1.0, 'fade-out', 0.6) })
        : H(env, 'O & J', { name: 'Monogram', start: 0.7, duration: till(d, 0.7), size: Math.round(md * 0.3), color: gold, maxWidth: md * 0.78, maxLines: 1, style: { letterSpacing: 0.04 }, anim: A('blur-in', 1.0, 'fade-out', 0.6) });
      const w = L.wide ? 1100 : L.s.w - 60;
      const lead = B(env, 'Together with their families', { name: 'Lead', start: 1.2, duration: till(d, 1.2), size: Math.round(34 * k), color: c.textMuted, maxWidth: w, maxLines: 2, style: { italic: true }, anim: A('fade-in', 1.0, 'fade-out', 0.6) });
      const n1 = H(env, 'Olivia Hart', { name: 'Name 1', start: 1.6, duration: till(d, 1.6), size: Math.round(104 * k), maxWidth: w, maxLines: 1, textAnim: { in: { id: 'char-blur-in', duration: 1.4 } }, anim: out });
      const amp = H(env, '&', { name: 'Ampersand', start: 2.0, duration: till(d, 2.0), size: Math.round(64 * k), color: gold, style: { uppercase: false }, anim: A('zoom-soft-in', 0.8, 'fade-out', 0.6) });
      const n2 = H(env, 'James Ellis', { name: 'Name 2', start: 2.2, duration: till(d, 2.2), size: Math.round(104 * k), maxWidth: w, maxLines: 1, textAnim: { in: { id: 'char-blur-in', duration: 1.4 } }, anim: out });
      const req = B(env, 'request the pleasure of your company', { name: 'Request', start: 2.9, duration: till(d, 2.9), size: Math.round(32 * k), color: c.textMuted, maxWidth: w, maxLines: 2, style: { italic: true }, anim: A('fade-in', 1.0, 'fade-out', 0.6) });
      const date = label(env, 'Saturday · September 20 · 2027', { start: 3.3, duration: till(d, 3.3), size: Math.round(30 * k), color: c.text, track: 0.2, maxWidth: w, maxLines: 2, anim: A('fade-in', 1.0, 'fade-out', 0.6) });
      const venue = B(env, 'Four in the afternoon · Rosewood Estate, Napa Valley', { name: 'Venue', start: 3.6, duration: till(d, 3.6), size: Math.round(30 * k), color: c.textMuted, maxWidth: w, maxLines: 2, anim: A('fade-in', 1.0, 'fade-out', 0.6) });
      const g = (v: number): number => Math.round(v * k * (L.wide ? 0.8 : 1));
      vstack(
        [
          { clips: [ring, mono], h: md, gap: g(40) },
          { clips: [lead], h: lead.metrics.height, gap: g(26) },
          { clips: [n1], h: n1.metrics.height, gap: g(2) },
          { clips: [amp], h: amp.metrics.height, gap: g(2) },
          { clips: [n2], h: n2.metrics.height, gap: g(28) },
          { clips: [req], h: req.metrics.height, gap: g(40) },
          { clips: [date], h: date.metrics.height, gap: g(14) },
          { clips: [venue], h: venue.metrics.height },
        ],
        { centerY: 0 },
      );
      void textOn;
      return [bg, ...frames, ring, mono, lead, n1, amp, n2, req, date, venue];
    },
  },
];

export default templates;
