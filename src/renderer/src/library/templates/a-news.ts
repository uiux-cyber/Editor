import { kf, linear, makeShape, makeSlot } from '@/core/factory';
import type { Clip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { an, atLeft, atRight, copy, darkPanel, inkOn, label, life, lightPanel, overlayBox, slotFill, title, vivid, vividOn, vivids, type MText } from './_lib/a-kit';
import { alpha, chance, pick, safeArea } from './_lib/kit';

/*
 * News overlays: straps, tickers and info panels that sit on top of footage. Tickers scroll
 * with linear x keyframes underneath an opaque tag box, so the text never shows in the margins.
 */

const HEADLINES = [
  'City council approves new riverside park',
  'Markets close higher for a third straight day',
  'Heatwave expected to ease by the weekend',
  'Local team clinches spot in the national final',
  'New rail line opens to commuters next month',
  'Museum unveils restored 17th-century map collection',
];

interface TickerOpts {
  /** Visible band: text appears from under `right` and disappears under `left`. */
  left: number;
  right: number;
  y: number;
  start: number;
  end: number;
  /** px per second. */
  speed: number;
  size: number;
  color: string;
}

/**
 * A crawl made of one clip per headline. Each clip lives only while it crosses the band and
 * moves with linear x keyframes, so the band is full from the first frame and nothing is parked
 * far outside the frame.
 */
function ticker(env: TemplateEnv, o: TickerOpts): Clip[] {
  const out: Clip[] = [];
  const first = Math.floor(env.rng() * HEADLINES.length);
  let cursor = o.left + 24;
  for (let i = 0; i < 24; i++) {
    const text = copy(env, HEADLINES[(first + i) % HEADLINES.length] + '      •', { name: `Headline ${i + 1}`, duration: 1, size: o.size, weight: 600, color: o.color });
    const w = text.metrics.width;
    const L0 = cursor;
    cursor += w + o.size * 1.6;
    const tIn = Math.max(o.start, o.start + (L0 - o.right) / o.speed);
    if (tIn >= o.end - 0.05) break;
    const tOut = Math.min(o.end, o.start + (L0 + w - o.left) / o.speed);
    const xAt = (t: number): number => Math.round(L0 - o.speed * (t - o.start) + w / 2);
    text.start = Math.round(tIn * 1000) / 1000;
    text.duration = Math.round((tOut - tIn) * 1000) / 1000;
    text.transform.x = xAt(tIn);
    text.transform.y = o.y;
    text.keyframes = { x: [kf(0, xAt(tIn), 'linear'), kf(text.duration, xAt(tOut), 'linear')] };
    text.anim = an(tIn <= o.start + 0.001 ? 'fade-in' : undefined, 0.4, tOut >= o.end - 0.001 ? 'fade-out' : undefined, 0.3);
    out.push(text);
  }
  return out;
}

const panelShadow = { color: '#00000059', blur: 22, x: 0, y: 8 };

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'news-breaking-bar',
    name: 'Breaking News Bar',
    category: 'news',
    tags: ['news', 'breaking', 'headline', 'ticker', 'broadcast', 'overlay'],
    duration: 8,
    poster: 0.5,
    music: { soundId: 'music-tense-pulse' },
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const box = overlayBox(env);
      const k = box.k;
      const wide = !env.portrait;
      const tagFill = vivid(env);
      const barFill = lightPanel(env);
      const tickFill = darkPanel(env);
      const pad = Math.round(26 * k);

      const brk = label(env, 'Breaking news', { name: 'Label', ...life(env, 0.4, 0.6), size: 30 * k, weight: 800, track: 0.08, color: inkOn(env, tagFill), maxWidth: 520 * k, maxLines: 1, style: { align: 'left' }, anim: an('mask-up-in', 0.45, 'fade-out', 0.3) });
      const dot = Math.round(16 * k);
      const tagW = Math.round(pad + dot + 14 + brk.metrics.inkWidth + pad);
      const barW = wide ? Math.round(box.right - box.left - tagW) : Math.round(box.right - box.left);
      const headline = title(env, 'City council approves new riverside park', {
        name: 'Headline',
        ...life(env, 0.75, 0.6),
        size: 52 * k,
        color: inkOn(env, barFill),
        maxWidth: barW - pad * 2,
        maxLines: wide ? 1 : 2,
        style: { align: 'left' },
        anim: an('mask-up-in', 0.5, 'fade-out', 0.3),
      });
      const tickH = Math.round(54 * k);
      const barH = Math.round(headline.metrics.height + 34 * k);
      const tagH = wide ? barH : Math.round(brk.metrics.height + 22 * k);
      const tickY = Math.round(box.bottom - tickH / 2);
      const barY = Math.round(box.bottom - tickH - barH / 2);
      const tagY = wide ? barY : Math.round(barY - barH / 2 - tagH / 2);
      const tagX = box.left + tagW / 2;
      const barLeft = wide ? box.left + tagW : box.left;

      brk.transform.y = tagY;
      atLeft(brk, box.left + pad + dot + 14);
      headline.transform.y = barY;
      atLeft(headline, barLeft + pad);

      // Ticker
      const clock = label(env, '10:24', { name: 'Clock', ...life(env, 0.9, 0.3), size: 26 * k, weight: 700, track: 0.06, color: inkOn(env, tagFill), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const clockW = Math.round(clock.metrics.inkWidth + pad * 2);
      const clockRight = box.left + clockW;
      clock.transform.y = tickY;
      atLeft(clock, box.left + pad);
      const crawl = ticker(env, { left: clockRight, right: env.cw / 2, y: tickY, start: 1.0, end: env.duration - 0.3, speed: 140, size: 28 * k, color: inkOn(env, tickFill) });

      return [
        makeShape('rect', { name: 'Ticker band', ...life(env, 0.6, 0.05), width: env.cw, height: tickH, y: tickY, fill: tickFill, anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.4) }),
        ...crawl,
        makeShape('rect', { name: 'Clock box', ...life(env, 0.7, 0.05), width: Math.round(clockRight + env.cw / 2), height: tickH, x: Math.round((-env.cw / 2 + clockRight) / 2), y: tickY, fill: tagFill, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.35) }),
        clock,
        makeShape('rect', { name: 'Headline bar', ...life(env, 0.5, 0.1), width: barW, height: barH, x: barLeft + barW / 2, y: barY, fill: barFill, shadow: panelShadow, anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.45) }),
        makeShape('rect', { name: 'Label block', ...life(env, 0.2, 0.15), width: tagW, height: tagH, x: tagX, y: tagY, fill: tagFill, anim: an('wipe-right-in', 0.45, 'wipe-left-out', 0.4) }),
        makeShape('ellipse', { name: 'Alert dot', ...life(env, 0.5, 0.6), width: dot, height: dot, x: box.left + pad + dot / 2, y: tagY, fill: inkOn(env, tagFill), anim: an('pop-in', 0.4, 'pop-out', 0.3, 'blink', 1.2) }),
        brk,
        headline,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'news-headline-strap',
    name: 'Headline Strap',
    category: 'news',
    tags: ['news', 'headline', 'live', 'strap', 'broadcast', 'overlay'],
    duration: 7,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const safe = safeArea(env);
      const k = box.k;
      const strapFill = lightPanel(env);
      const edge = vivid(env);
      const tabFill = pick(env.rng, [c.secondary, c.accent, darkPanel(env)]);
      const pad = Math.round(30 * k);
      const edgeW = Math.round(16 * k);
      const maxW = env.portrait ? box.maxW : Math.min(box.right - box.left, 1400);
      const tab = label(env, 'Developing story', { name: 'Tab', ...life(env, 0.6, 0.6), size: 24 * k, weight: 800, track: 0.14, color: inkOn(env, tabFill), maxWidth: maxW, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const head = title(env, 'Storm season arrives early as coastal towns prepare', {
        name: 'Headline',
        ...life(env, 0.7, 0.6),
        size: 54 * k,
        color: inkOn(env, strapFill),
        maxWidth: maxW - edgeW - pad * 2,
        maxLines: 2,
        style: { align: 'left' },
        anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.3),
      });
      const strapH = Math.round(head.metrics.height + 40 * k);
      const strapW = Math.round(edgeW + pad + head.metrics.inkWidth + pad + 20);
      const tabH = Math.round(tab.metrics.height + 16 * k);
      const tabW = Math.round(tab.metrics.inkWidth + pad * 1.4);
      const strapY = Math.round(box.bottom - strapH / 2);
      const tabY = Math.round(box.bottom - strapH - tabH / 2);
      head.transform.y = strapY;
      atLeft(head, box.left + edgeW + pad);
      tab.transform.y = tabY;
      atLeft(tab, box.left + edgeW + pad * 0.7);

      // Live bug, top-right corner.
      const top = -env.ch / 2 + safe.my;
      const right = env.cw / 2 - safe.mx;
      const live = label(env, 'Live', { name: 'Live', ...life(env, 0.3, 0.3), size: 26 * k, weight: 800, track: 0.16, color: inkOn(env, edge), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const time = label(env, '09:41', { name: 'Time', ...life(env, 0.45, 0.3), size: 26 * k, weight: 600, track: 0.06, color: inkOn(env, darkPanel(env)), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const bugH = Math.round(live.metrics.height + 18 * k);
      const dot = Math.round(14 * k);
      const liveW = Math.round(18 * k + dot + 10 + live.metrics.inkWidth + 20 * k);
      const timeW = Math.round(time.metrics.inkWidth + 36 * k);
      const bugY = Math.round(top + bugH / 2);
      time.transform.y = bugY;
      atRight(time, right - 18 * k);
      const liveRight = right - timeW;
      live.transform.y = bugY;
      atRight(live, liveRight - 20 * k);

      return [
        makeShape('rect', { name: 'Strap', ...life(env, 0.3, 0.1), width: strapW, height: strapH, x: box.left + strapW / 2, y: strapY, fill: strapFill, shadow: panelShadow, anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.45) }),
        makeShape('rect', { name: 'Edge', ...life(env, 0.2, 0.05), width: edgeW, height: strapH, x: box.left + edgeW / 2, y: strapY, fill: edge, anim: an('wipe-up-in', 0.4, 'wipe-down-out', 0.35) }),
        makeShape('rect', { name: 'Tab', ...life(env, 0.5, 0.45), width: tabW, height: tabH, x: box.left + edgeW + tabW / 2, y: tabY, fill: tabFill, anim: an('wipe-up-in', 0.4, 'wipe-down-out', 0.3) }),
        tab,
        head,
        makeShape('rect', { name: 'Time box', ...life(env, 0.3, 0.05), width: timeW, height: bugH, x: right - timeW / 2, y: bugY, fill: darkPanel(env), anim: an('wipe-left-in', 0.45, 'wipe-right-out', 0.35) }),
        makeShape('rect', { name: 'Live box', ...life(env, 0.15, 0.05), width: liveW, height: bugH, x: liveRight - liveW / 2, y: bugY, fill: edge, anim: an('wipe-left-in', 0.45, 'wipe-right-out', 0.35) }),
        makeShape('ellipse', { name: 'Live dot', ...life(env, 0.35, 0.3), width: dot, height: dot, x: Math.round(liveRight - liveW + 18 * k + dot / 2), y: bugY, fill: inkOn(env, edge), anim: an('pop-in', 0.3, 'fade-out', 0.3, 'blink', 1.2) }),
        live,
        time,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'news-live-ticker',
    name: 'Live Ticker',
    category: 'news',
    tags: ['news', 'ticker', 'crawl', 'headlines', 'scrolling', 'overlay'],
    duration: 10,
    poster: 0.4,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const band = darkPanel(env);
      const tagFill = vivid(env);
      const clockFill = lightPanel(env);
      const h = Math.round(64 * k);
      const y = Math.round(box.bottom - h / 2);
      const pad = Math.round(26 * k);

      const tag = label(env, 'Latest', { name: 'Tag', ...life(env, 0.4, 0.35), size: 28 * k, weight: 800, track: 0.14, color: inkOn(env, tagFill), anim: an('mask-up-in', 0.45, 'fade-out', 0.3) });
      const tagRight = Math.round(box.left + tag.metrics.inkWidth + pad * 2);
      tag.transform.y = y;
      atLeft(tag, box.left + pad);
      const clock = label(env, '14:05', { name: 'Clock', ...life(env, 0.6, 0.35), size: 28 * k, weight: 700, track: 0.04, color: inkOn(env, clockFill), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const clockLeft = Math.round(box.right - clock.metrics.inkWidth - pad * 2);
      clock.transform.y = y;
      atRight(clock, box.right - pad);
      const crawl = ticker(env, { left: tagRight + 30 * k, right: clockLeft, y, start: 0.6, end: env.duration - 0.2, speed: 150, size: 31 * k, color: inkOn(env, band) });
      return [
        makeShape('rect', { name: 'Top rule', ...life(env, 0.1, 0.05), width: env.cw, height: Math.round(5 * k), y: Math.round(y - h / 2 - 2.5 * k), fill: linear(0, vivids(env)[0], vivids(env)[1]), anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.4) }),
        makeShape('rect', { name: 'Band', ...life(env, 0.2, 0.05), width: env.cw, height: h, y, fill: alpha(band, 0.94), anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.4) }),
        ...crawl,
        makeShape('rect', { name: 'Tag box', ...life(env, 0.3, 0.1), width: Math.round(tagRight + env.cw / 2), height: h, x: Math.round((-env.cw / 2 + tagRight) / 2), y, fill: tagFill, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.35) }),
        makeShape('chevron', { name: 'Arrow', ...life(env, 0.6, 0.3), width: Math.round(18 * k), height: Math.round(26 * k), x: tagRight + Math.round(20 * k), y, fill: tagFill, anim: an('fade-in', 0.3, 'fade-out', 0.3) }),
        tag,
        makeShape('rect', { name: 'Clock box', ...life(env, 0.4, 0.1), width: Math.round(env.cw / 2 - clockLeft), height: h, x: Math.round((clockLeft + env.cw / 2) / 2), y, fill: clockFill, anim: an('wipe-left-in', 0.5, 'wipe-right-out', 0.35) }),
        clock,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'news-key-facts',
    name: 'Key Facts Panel',
    category: 'news',
    tags: ['news', 'explainer', 'facts', 'panel', 'picture in picture', 'overlay'],
    duration: 9,
    poster: 0.55,
    build: (env) => {
      const c = env.palette;
      const safe = safeArea(env);
      const wide = env.cw > env.ch * 1.2;
      const panel = lightPanel(env);
      const ink = inkOn(env, panel);
      const pw = wide ? Math.min(620, Math.round(safe.w * 0.36)) : Math.round(safe.w);
      const s = wide ? 1 : env.portrait ? 1.3 : 1.15;
      const pad = Math.round(34 * s);
      const right = env.cw / 2 - safe.mx;
      const px = wide ? Math.round((right - pw / 2) * (chance(env.rng, 0.5) ? 1 : -1)) : 0;
      const innerW = pw - pad * 2;
      const slotH = Math.round(wide ? (innerW * 9) / 16 : (innerW * 9) / 16 * 0.8);

      const mark = vividOn(env, panel);
      const tag = label(env, 'Key facts', { name: 'Tag', ...life(env, 0.7, 0.6), size: 22 * s, weight: 800, track: 0.18, color: inkOn(env, mark), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const head = title(env, 'Riverside Park Plan', { name: 'Title', ...life(env, 0.8, 0.6), size: 54 * s, color: ink, maxWidth: innerW, maxLines: 2, style: { align: 'left' }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.3) });
      const facts = ['12 hectares of new green space', 'Construction starts in spring', 'Budget of $48 million approved'];
      const items: MText[] = facts.map((f, i) =>
        copy(env, f, { name: `Fact ${i + 1}`, ...life(env, 1.3 + i * 0.35, 0.6), size: 30 * s, weight: 500, color: ink, maxWidth: innerW - 40 * s, maxLines: 2, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) }),
      );
      const tagH = tag.metrics.height + 12;
      const gap = 22;
      const listH = items.reduce((s, t) => s + t.metrics.height, 0) + gap * (items.length - 1);
      const ph = Math.round(pad + slotH + 28 + tagH + 18 + head.metrics.height + 26 + listH + pad);
      const bottomLimit = env.ch / 2 - safe.my;
      const py = wide ? 0 : Math.round(Math.min(bottomLimit - ph / 2, env.ch * 0.06));
      const left = px - pw / 2 + pad;
      let y = py - ph / 2 + pad;
      const slotY = Math.round(y + slotH / 2);
      y += slotH + 28;
      tag.transform.y = Math.round(y + tagH / 2);
      atLeft(tag, left + 12);
      y += tagH + 18;
      head.transform.y = Math.round(y + head.metrics.height / 2);
      atLeft(head, left);
      y += head.metrics.height + 26;
      const bullets: Clip[] = [];
      items.forEach((t, i) => {
        t.transform.y = Math.round(y + t.metrics.height / 2);
        atLeft(t, left + 40 * s);
        const firstLine = y + Math.min(t.metrics.height, 30 * s * 1.3) / 2;
        bullets.push(makeShape('rect', { name: `Bullet ${i + 1}`, ...life(env, 1.25 + i * 0.35, 0.6), width: Math.round(14 * s), height: Math.round(14 * s), radius: 3, rotation: 45, x: left + 9 * s, y: Math.round(firstLine), fill: mark, anim: an('pop-in', 0.4, 'pop-out', 0.3) }));
        y += t.metrics.height + gap;
      });
      return [
        makeShape('rect', { name: 'Panel', ...life(env, 0.2, 0.05), width: pw, height: ph, radius: 24, x: px, y: py, fill: panel, shadow: { color: '#00000066', blur: 40, x: 0, y: 16 }, anim: an('slide-left-in', 0.6, 'slide-right-out', 0.5) }),
        makeSlot({ name: 'Photo', ...life(env, 0.45, 0.6), width: innerW, height: slotH, radius: 14, x: px, y: slotY, fill: slotFill(env), anim: an('zoom-soft-in', 0.6, 'fade-out', 0.3) }),
        makeShape('rect', { name: 'Tag box', ...life(env, 0.6, 0.6), width: Math.round(tag.metrics.inkWidth + 24), height: Math.round(tagH), radius: 4, x: Math.round(left + (tag.metrics.inkWidth + 24) / 2), y: tag.transform.y, fill: mark, anim: an('wipe-right-in', 0.4, 'fade-out', 0.3) }),
        tag,
        head,
        ...bullets,
        ...items,
      ];
    },
  },
];

export default templates;
