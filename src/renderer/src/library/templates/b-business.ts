import { linear, makeShape, makeSlot, radial } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, backdrop, column, fitAspect, holder, hrow, label, lay, mix, pItem, pill, setXY, split, strong, tItem, textOn, till, vivid, vstack, type Box, type Txt } from './_lib/b-kit';
import { chance, pick } from './_lib/kit';

const cardShadow = (env: TemplateEnv, k = 1): { color: string; blur: number; x: number; y: number } => ({ color: alpha('#000000', (env.palette.dark ? 0.42 : 0.12) * k), blur: 34, x: 0, y: 14 });

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Corporate title with a bleeding photo panel
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-business-corporate-title',
    name: 'Corporate Title',
    category: 'business',
    tags: ['corporate', 'presentation', 'title', 'board', 'quarterly', 'report', 'company'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['solid', 'linear', 'grid'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const stacked = L.portrait;
      const mediaRight = chance(r, 0.6);

      // Photo panel bleeds to the frame edge.
      const pf = L.wide ? 0.44 : L.square ? 0.42 : L.tall ? 0.46 : 0.42;
      const pw = stacked ? L.cw : Math.round(L.cw * pf);
      const ph = stacked ? Math.round(L.ch * pf) : L.ch;
      const px = stacked ? 0 : mediaRight ? L.hw - pw / 2 : -L.hw + pw / 2;
      const py = stacked ? -L.hh + ph / 2 : 0;
      const photo = makeSlot({ name: 'Office photo', start: 0, duration: till(d, 0), width: pw, height: ph, x: px, y: py, anim: A(stacked ? 'mask-down-in' : mediaRight ? 'mask-left-in' : 'mask-right-in', 0.9, 'fade-out', 0.4, 'slow-zoom', 12) });
      const edge = makeShape('rect', {
        name: 'Accent edge',
        start: 0.6,
        duration: till(d, 0.6),
        width: stacked ? L.cw : 16,
        height: stacked ? 16 : L.ch,
        x: stacked ? 0 : mediaRight ? L.hw - pw : -L.hw + pw,
        y: stacked ? -L.hh + ph : 0,
        fill: stacked ? linear(0, c.primary, c.secondary) : linear(90, c.primary, c.secondary),
        anim: A(stacked ? 'wipe-right-in' : 'wipe-down-in', 0.6, 'fade-out', 0.4),
      });

      const zone: Box = stacked
        ? { x: 0, y: (-L.hh + ph + 40 + L.s.hh) / 2, w: L.s.w, h: L.s.hh - (-L.hh + ph + 40) }
        : { x: mediaRight ? (-L.hw + (L.cw - pw) / 2) : L.hw - (L.cw - pw) / 2, y: 0, w: L.cw - pw - L.s.mx * 2, h: L.s.h };
      const company = label(env, 'Halden & Co.', { start: 0.5, duration: till(d, 0.5), size: L.tall ? 32 : 28, color: pop, track: 0.28, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const line = makeShape('rect', { name: 'Rule', start: 0.7, duration: till(d, 0.7), width: 120, height: 6, radius: 3, fill: pop, anim: A('wipe-right-in', 0.5, 'fade-out', 0.35) });
      const title = H(env, 'Quarterly Strategy Review', { name: 'Title', start: 0.8, duration: till(d, 0.8), size: L.wide ? 112 : L.tall ? 128 : L.square ? 76 : 96, maxWidth: zone.w, maxLines: 3, style: { align: 'left' }, textAnim: { in: { id: 'line-rise-in', duration: 0.8 } }, anim: out });
      const sub = B(env, 'Q3 2026 · Board presentation', { name: 'Subtitle', start: 1.2, duration: till(d, 1.2), size: L.tall ? 50 : L.wide ? 42 : 34, color: c.textMuted, maxWidth: zone.w, maxLines: 2, style: { align: 'left' }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const who = strong(env, 'Elena Ruiz', { name: 'Presenter', start: 1.6, duration: till(d, 1.6), size: L.tall ? 44 : L.wide ? 36 : 32, weight: 700, style: { align: 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      const role = B(env, 'Chief Financial Officer', { name: 'Presenter role', start: 1.7, duration: till(d, 1.7), size: L.tall ? 36 : L.wide ? 30 : 28, color: c.textMuted, style: { align: 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
      column([tItem(company, 24), { clips: [line], w: 120, h: 6, gap: 30 }, tItem(title, 26), tItem(sub, L.tall ? 64 : 48), tItem(who, 4), tItem(role)], zone, 'left');

      return [bg, photo, edge, company, line, title, sub, who, role];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. KPI stats
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-business-kpi-stats',
    name: 'KPI Stats Reveal',
    category: 'business',
    tags: ['stats', 'kpi', 'numbers', 'results', 'report', 'growth', 'metrics', 'annual'],
    duration: 8,
    poster: 0.65,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['grid', 'mesh', 'flow'] as const), { duration: d });
      const pop = vivid(env, c.surface, 3);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const row = L.wide || L.square;

      const kicker = label(env, 'Annual results', { start: 0.2, duration: till(d, 0.2), size: L.tall ? 34 : 28, color: vivid(env, c.bg), track: 0.26, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const title = H(env, '2026 at a glance', { name: 'Title', start: 0.35, duration: till(d, 0.35), size: L.tall ? 128 : L.wide ? 128 : L.square ? 80 : 100, maxWidth: L.s.w, maxLines: 2, textAnim: { in: { id: 'word-rise-in', duration: 0.8 } }, anim: out });

      const stats = [
        { v: '+48%', l: 'Revenue growth', p: 0.48 },
        { v: '2.4M', l: 'Active customers', p: 0.82 },
        { v: '12', l: 'New markets opened', p: 0.6 },
      ];
      const g = L.wide ? 36 : 26;
      const cardW = row ? (L.s.w - g * 2) / 3 : L.s.w;
      const pad = L.wide ? 56 : L.square ? 32 : 48;
      const valSize = L.wide ? 160 : L.square ? 84 : L.tall ? 136 : 100;
      // All values share one size: the largest that fits every card.
      const valMax = row ? cardW - pad * 2 : (cardW - pad * 2) * 0.56;
      const fit = Math.min(...stats.map((s) => H(env, s.v, { size: valSize, maxWidth: valMax, maxLines: 1, style: { letterSpacing: 0 } }).text.fontSize));
      const cards = stats.map((s, i) => {
        const t = 1.2 + i * 0.3;
        const val = H(env, s.v, { name: `Value ${i + 1}`, start: t + 0.15, duration: till(d, t + 0.15), size: fit, color: pop, maxWidth: row ? cardW - pad * 2 : (cardW - pad * 2) * 0.56, maxLines: 1, style: { letterSpacing: 0, align: 'left' }, textAnim: { in: { id: 'char-rise-in', duration: 0.7 } }, anim: out });
        const lab = B(env, s.l, { name: `Label ${i + 1}`, start: t + 0.3, duration: till(d, t + 0.3), size: L.tall ? 44 : L.wide ? 40 : 30, color: c.textMuted, maxWidth: row ? cardW - pad * 2 : (cardW - pad * 2) * 0.4, maxLines: 2, style: { align: 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.35) });
        const barW = cardW - pad * 2;
        const track = makeShape('rect', { name: `Track ${i + 1}`, start: t + 0.3, duration: till(d, t + 0.3), width: Math.round(barW), height: 12, radius: 6, fill: alpha(c.text, c.dark ? 0.12 : 0.08), anim: A('fade-in', 0.4, 'fade-out', 0.35) });
        const fw = Math.round(barW * s.p);
        const fill = makeShape('rect', { name: `Bar ${i + 1}`, start: t + 0.5, duration: till(d, t + 0.5), width: fw, height: 12, radius: 6, fill: linear(0, c.primary, mix(c.primary, c.accent, 0.6)), anim: A('wipe-right-in', 1.0, 'fade-out', 0.35) });
        const innerH = row ? val.metrics.height + 10 + lab.metrics.height + 30 + 12 : Math.max(val.metrics.height, lab.metrics.height) + 26 + 12;
        const card = makeShape('rect', { name: `Card ${i + 1}`, start: t, duration: till(d, t), width: Math.round(cardW), height: Math.round(innerH + pad * 2), radius: 32, fill: c.surface, shadow: cardShadow(env), anim: A('spring-up-in', 0.6, 'fade-out', 0.4) });
        return { card, val, lab, track, fill, fw, barW, h: innerH + pad * 2 };
      });

      const cardsH = row ? Math.max(...cards.map((k) => k.h)) : cards.reduce((s, k) => s + k.h, 0) + g * 2;
      const rows = holder();
      vstack([{ clips: [kicker], h: kicker.metrics.height, gap: 16 }, { clips: [title], h: title.metrics.height, gap: L.tall ? 70 : 50 }, { clips: [rows], h: cardsH }], { centerY: 0 });
      const top = rows.transform.y - cardsH / 2;
      cards.forEach((k, i) => {
        const cx = row ? -L.s.hw + cardW / 2 + i * (cardW + g) : 0;
        const ctop = row ? top : top + cards.slice(0, i).reduce((s, x) => s + x.h + g, 0);
        const h = row ? cardsH : k.h;
        k.card.shape.height = Math.round(h);
        setXY([k.card], cx, ctop + h / 2);
        const left = cx - cardW / 2 + pad;
        if (row) {
          k.val.transform.y = Math.round(ctop + pad + k.val.metrics.height / 2);
          k.lab.transform.y = Math.round(ctop + pad + k.val.metrics.height + 10 + k.lab.metrics.height / 2);
        } else {
          const lh = Math.max(k.val.metrics.height, k.lab.metrics.height);
          k.val.transform.y = Math.round(ctop + pad + lh / 2);
          k.lab.transform.y = Math.round(ctop + pad + lh / 2);
          k.lab.transform.x = Math.round(cx + cardW / 2 - pad - k.lab.metrics.width / 2);
          k.lab.text.align = 'right';
        }
        alignLeft(k.val, left);
        if (row) alignLeft(k.lab, left);
        const by = ctop + h - pad - 6;
        setXY([k.track], left + k.barW / 2, by);
        setXY([k.fill], left + k.fw / 2, by);
      });

      return [bg, kicker, title, ...cards.flatMap((k) => [k.card, k.val, k.lab, k.track, k.fill])];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Team member intro
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-business-team-intro',
    name: 'Team Member Intro',
    category: 'business',
    tags: ['team', 'employee', 'profile', 'about us', 'hiring', 'people', 'meet the team'],
    duration: 7,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'solid', 'dots'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const z = split(L, { media: L.wide ? 0.4 : L.square ? 0.44 : 0.5, mediaSide: 'left', sideMid: false });
      const align = z.stacked ? 'center' : 'left';

      const m = fitAspect(z.media, z.stacked ? 1 : 0.8, z.stacked ? 0.92 : 0.94);
      const off = L.wide ? 30 : 22;
      const outline = makeShape('rect', { name: 'Offset frame', start: 0.2, duration: till(d, 0.2), width: m.w, height: m.h, radius: 36, x: z.media.x + off, y: z.media.y + off, fill: alpha(c.bg, 0), stroke: { color: pop, width: 4 }, anim: A('fade-in', 0.6, 'fade-out', 0.4) });
      const photo = makeSlot({ name: 'Portrait', start: 0.3, duration: till(d, 0.3), width: m.w, height: m.h, radius: 36, x: z.media.x, y: z.media.y, shadow: cardShadow(env), anim: A('mask-up-in', 0.8, 'fade-out', 0.4) });

      const hello = label(env, 'Meet the team', { start: 0.7, duration: till(d, 0.7), size: L.tall ? 32 : 26, color: pop, track: 0.26, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const name = H(env, 'Priya Raman', { name: 'Name', start: 0.85, duration: till(d, 0.85), size: L.wide ? 128 : L.tall ? 120 : L.square ? 82 : 96, maxWidth: z.text.w, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-rise-in', duration: 0.8 } }, anim: out });
      const role = strong(env, 'Head of Product Design', { name: 'Role', start: 1.2, duration: till(d, 1.2), size: L.tall ? 46 : L.wide ? 42 : 34, weight: 600, color: c.text, maxWidth: z.text.w, maxLines: 2, style: { align }, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const bio = B(env, 'Turns messy problems into calm, simple tools people love to use.', { name: 'Bio', start: 1.5, duration: till(d, 1.5), size: L.tall ? 38 : L.wide ? 34 : 28, color: c.textMuted, maxWidth: z.text.w, maxLines: 3, style: { align }, anim: A('fade-in', 0.6, 'fade-out', 0.35) });
      const chipSize = L.tall ? 30 : L.wide ? 28 : 24;
      const chips = ['9 years at Halden', 'Based in Lisbon'].map((t, i) => pill(env, t, { size: chipSize, fill: alpha(c.text, c.dark ? 0.12 : 0.07), color: c.text, weight: 600, stroke: { color: alpha(c.text, 0.2), width: 2 }, start: 1.9 + i * 0.15, duration: till(d, 1.9 + i * 0.15), anim: A('pop-soft-in', 0.4, 'fade-out', 0.35) }));
      const chipRow = holder();
      const oneRow = chips[0].w + 14 + chips[1].w <= z.text.w;
      const chipsW = oneRow ? chips[0].w + 14 + chips[1].w : Math.max(chips[0].w, chips[1].w);
      const chipsH = oneRow ? chips[0].h : chips[0].h + 12 + chips[1].h;
      column([tItem(hello, 18), tItem(name, 16), tItem(role, 20), tItem(bio, L.tall ? 44 : 34), { clips: [chipRow], w: chipsW, h: chipsH }], z.text, align);
      if (oneRow) {
        hrow(chips.map((p) => ({ clips: p.clips, w: p.w })), { left: chipRow.transform.x - chipsW / 2, gap: 14 });
        setXY(chips.flatMap((p) => p.clips), undefined, chipRow.transform.y);
      } else {
        const top = chipRow.transform.y - chipsH / 2;
        chips.forEach((p, i) => setXY(p.clips, align === 'left' ? chipRow.transform.x - chipsW / 2 + p.w / 2 : chipRow.transform.x, top + i * (chips[0].h + 12) + p.h / 2));
      }

      return [bg, outline, photo, hello, name, role, bio, ...chips.flatMap((p) => p.clips)];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Agenda timeline
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-business-agenda-timeline',
    name: 'Agenda Timeline',
    category: 'business',
    tags: ['agenda', 'timeline', 'schedule', 'meeting', 'conference', 'roadmap', 'steps'],
    duration: 9,
    poster: 0.75,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['flow', 'grid', 'solid'] as const), { duration: d });
      const pop = vivid(env, c.bg, 3);
      const out = A(undefined, 0, 'fade-out', 0.4);
      const horizontal = L.wide;
      const items = [
        ['09:00', 'Welcome & coffee'],
        ['09:30', 'Product roadmap'],
        ['11:00', 'Customer panel'],
        ['12:30', 'Lunch & demos'],
      ];

      const kicker = label(env, 'Thursday, 14 May', { start: 0.2, duration: till(d, 0.2), size: L.tall ? 32 : 28, color: pop, track: 0.22, anim: A('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      const title = H(env, "Today's agenda", { name: 'Title', start: 0.35, duration: till(d, 0.35), size: L.tall ? 124 : L.wide ? 112 : 88, maxWidth: L.s.w, maxLines: 2, style: { align: horizontal ? 'left' : 'left' }, textAnim: { in: { id: 'word-rise-in', duration: 0.8 } }, anim: out });
      const step = Math.min(0.9, (d * 0.5) / items.length);
      const t0 = 1.1;
      const dotD = L.tall ? 38 : 32;
      const timeSize = L.tall ? 46 : L.wide ? 42 : 32;
      const topicSize = L.tall ? 66 : L.wide ? 56 : 42;

      const rows = items.map(([tm, tp], i) => {
        const s = t0 + i * step;
        const dot = makeShape('ellipse', { name: `Dot ${i + 1}`, start: s, duration: till(d, s), width: dotD, height: dotD, fill: i === 0 ? pop : c.bg, stroke: { color: pop, width: 5 }, anim: A('pop-in', 0.4, 'pop-out', 0.3, i === 0 ? 'pulse' : undefined, 1.2) });
        const time = label(env, tm, { start: s + 0.1, duration: till(d, s + 0.1), size: timeSize, color: pop, track: 0.08, style: { align: horizontal ? 'center' : 'left' }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
        const topic = strong(env, tp, { name: `Topic ${i + 1}`, start: s + 0.2, duration: till(d, s + 0.2), size: topicSize, weight: 600, maxWidth: horizontal ? (L.s.w / items.length) - 30 : L.s.w - 120, maxLines: 2, style: { align: horizontal ? 'center' : 'left' }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.35) });
        return { dot, time, topic };
      });

      if (horizontal) {
        const head = vstack([{ clips: [kicker], h: kicker.metrics.height, gap: 14 }, { clips: [title], h: title.metrics.height }], { top: -L.s.hh + 40 });
        alignLeft(kicker, -L.s.hw);
        alignLeft(title, -L.s.hw);
        const timeH = Math.max(...rows.map((rw) => rw.time.metrics.height));
        const topicH = Math.max(...rows.map((rw) => rw.topic.metrics.height));
        // Centre the time / line / topic block in the space below the heading.
        const lineY = -L.s.hh + 40 + head + (L.s.h - 40 - head) / 2 + (timeH - topicH) / 2;
        const line = makeShape('rect', { name: 'Timeline', start: 0.8, duration: till(d, 0.8), width: L.s.w, height: 6, radius: 3, y: lineY, fill: alpha(c.text, 0.2), anim: A('wipe-right-in', 1.0, 'fade-out', 0.4) });
        const colW = L.s.w / items.length;
        rows.forEach((rw, i) => {
          const x = -L.s.hw + colW / 2 + i * colW;
          setXY([rw.dot], x, lineY);
          setXY([rw.time], x, lineY - 40 - rw.time.metrics.height / 2);
          setXY([rw.topic], x, lineY + 40 + rw.topic.metrics.height / 2);
        });
        return [bg, kicker, title, line, ...rows.flatMap((rw) => [rw.dot, rw.time, rw.topic])];
      }

      const rowGap = L.tall ? 76 : L.square ? 30 : 44;
      const rowH = rows.map((rw) => rw.time.metrics.height + 6 + rw.topic.metrics.height);
      const listH = rowH.reduce((s, h) => s + h, 0) + rowGap * (items.length - 1);
      const listHold = holder();
      vstack([{ clips: [kicker], h: kicker.metrics.height, gap: 14 }, { clips: [title], h: title.metrics.height, gap: L.tall ? 90 : 56 }, { clips: [listHold], h: listH }], { centerY: 0 });
      alignLeft(kicker, -L.s.hw);
      alignLeft(title, -L.s.hw);
      const top = listHold.transform.y - listH / 2;
      const lineX = -L.s.hw + dotD / 2;
      const textX = lineX + dotD / 2 + 44;
      let y = top;
      const firstY = top + rows[0].time.metrics.height / 2;
      let lastY = firstY;
      rows.forEach((rw, i) => {
        rw.time.transform.y = Math.round(y + rw.time.metrics.height / 2);
        rw.topic.transform.y = Math.round(y + rw.time.metrics.height + 6 + rw.topic.metrics.height / 2);
        alignLeft(rw.time, textX);
        alignLeft(rw.topic, textX);
        setXY([rw.dot], lineX, rw.time.transform.y);
        lastY = rw.time.transform.y;
        y += rowH[i] + rowGap;
      });
      const line = makeShape('rect', { name: 'Timeline', start: 0.8, duration: till(d, 0.8), width: 6, height: Math.round(lastY - firstY), radius: 3, x: lineX, y: (firstY + lastY) / 2, fill: alpha(c.text, 0.2), anim: A('wipe-down-in', 1.2, 'fade-out', 0.4) });
      return [bg, kicker, title, line, ...rows.flatMap((rw) => [rw.dot, rw.time, rw.topic])];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 5. Logo reveal
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-business-logo-reveal',
    name: 'Clean Logo Reveal',
    category: 'business',
    tags: ['logo', 'reveal', 'brand', 'intro', 'corporate', 'sting', 'ident'],
    duration: 5,
    poster: 0.65,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['glow', 'solid', 'spot'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const size = L.tall ? 380 : L.wide ? 340 : 300;
      const logoY = L.tall ? -120 : -90;
      const lineLen = Math.round(size * 0.9);

      // Four strokes shoot in and meet at the logo, then dissolve.
      const strokes: ShapeClip[] = [
        { w: lineLen, h: 6, x: -size * 0.75, y: logoY, a: 'fly-right-in' },
        { w: lineLen, h: 6, x: size * 0.75, y: logoY, a: 'fly-left-in' },
        { w: 6, h: lineLen, x: 0, y: logoY - size * 0.75, a: 'fly-down-in' },
        { w: 6, h: lineLen, x: 0, y: logoY + size * 0.75, a: 'fly-up-in' },
      ].map((s, i) => makeShape('rect', { name: `Stroke ${i + 1}`, start: 0.1 + i * 0.05, duration: 1.1, width: s.w, height: s.h, radius: 3, x: s.x, y: s.y, fill: i % 2 ? c.secondary : pop, anim: A(s.a, 0.55, 'fade-out', 0.35) }));
      const ring = makeShape('ellipse', { name: 'Shock ring', start: 0.7, duration: 1.0, width: size * 1.5, height: size * 1.5, y: logoY, fill: alpha(c.bg, 0), stroke: { color: alpha(pop, 0.8), width: 4 }, anim: A('zoom-in', 0.6, 'fade-out', 0.4) });
      const glow = makeShape('ellipse', { name: 'Glow', start: 0.8, duration: till(d, 0.8), width: size * 2.2, height: size * 2.2, y: logoY, fill: radial(alpha(c.primary, c.dark ? 0.45 : 0.25), alpha(c.primary, 0)), anim: A('fade-in', 0.8, 'fade-out', 0.4, 'breathe', 4) });
      const logo = makeSlot({ name: 'Logo', start: 0.85, duration: till(d, 0.85), width: size, height: size, radius: Math.round(size * 0.12), y: logoY, anim: A('zoom-blur-in', 0.7, 'zoom-soft-out', 0.45) });

      const name = H(env, 'Halden & Co.', { name: 'Company name', start: 1.4, duration: till(d, 1.4), size: L.tall ? 104 : L.wide ? 92 : 80, maxWidth: L.s.w, maxLines: 1, textAnim: { in: { id: 'tracking-expand-in', duration: 1.0 } }, anim: A(undefined, 0, 'fade-out', 0.4) });
      const rule = makeShape('rect', { name: 'Rule', start: 1.8, duration: till(d, 1.8), width: 90, height: 5, radius: 2.5, fill: pop, anim: A('wipe-center-in', 0.5, 'fade-out', 0.35) });
      const tag = label(env, 'Advisory · Strategy · Growth', { start: 2.0, duration: till(d, 2.0), size: L.tall ? 32 : 26, color: c.textMuted, track: 0.22, maxWidth: L.s.w, maxLines: 1, anim: A('fade-in', 0.6, 'fade-out', 0.35) });
      vstack([{ clips: [name], h: name.metrics.height, gap: 24 }, { clips: [rule], h: 5, gap: 24 }, { clips: [tag], h: tag.metrics.height }], { top: logoY + size / 2 + (L.tall ? 80 : 56) });
      void textOn;
      return [bg, glow, ...strokes, ring, logo, name, rule, tag];
    },
  },
];

export default templates;
