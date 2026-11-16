import { kf, linear, makeShape, makeSlot, makeSticker, radial } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { A, B, H, alignLeft, alpha, backdrop, column, hrow, label, lay, mix, pItem, pill, setXY, strong, tItem, textOn, till, vivid, vstack, type Txt } from './_lib/b-kit';
import { chance, pick } from './_lib/kit';

const HEAVY = ['Anton', 'Archivo Black', 'Bangers', 'Shrikhand', 'Abril Fatface', 'Righteous', 'Press Start 2P', 'Bebas Neue', 'DM Serif Display'];
/** True when the heading face is heavy enough to read as outlined (hollow) text. */
const outlineFriendly = (env: TemplateEnv): boolean => HEAVY.includes(env.fonts.heading.family) || env.fonts.heading.weight >= 700;

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  // 1. Channel intro
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-youtube-channel-intro',
    name: 'Channel Intro Burst',
    category: 'youtube',
    tags: ['intro', 'channel', 'logo', 'youtube', 'opener', 'creator', 'brand'],
    duration: 5,
    poster: 0.55,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['aurora', 'mesh', 'glow'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const logo = L.tall ? 440 : L.wide ? 360 : 330;

      const burst = makeShape('burst', { name: 'Burst', start: 0.1, duration: till(d, 0.1), width: logo * 1.75, height: logo * 1.75, fill: radial(alpha(c.primary, c.dark ? 0.55 : 0.35), alpha(c.primary, 0)), anim: A('zoom-in', 0.7, 'zoom-out', 0.45, 'spin', 14) });
      const rings = [0, 1].map((i) =>
        makeShape('ellipse', { name: `Ring ${i + 1}`, start: 0.25 + i * 0.18, duration: till(d, 0.25 + i * 0.18), width: logo + 70 + i * 70, height: logo + 70 + i * 70, fill: alpha(c.bg, 0), stroke: { color: alpha(i ? c.secondary : pop, i ? 0.45 : 0.9), width: i ? 3 : 6 }, anim: A('zoom-in', 0.6, 'zoom-out', 0.4) }),
      );
      const disc = makeShape('ellipse', { name: 'Logo backing', start: 0.3, duration: till(d, 0.3), width: logo + 20, height: logo + 20, fill: c.surface, anim: A('pop-in', 0.5, 'pop-out', 0.4) });
      const slot = makeSlot({ name: 'Channel logo', start: 0.4, duration: till(d, 0.4), width: logo, height: logo, radius: logo / 2, anim: A('twist-pop-in', 0.6, 'pop-out', 0.4) });
      const spark = makeSticker('sparkles-twinkle', { name: 'Sparkles', start: 0.9, duration: till(d, 0.9), size: logo * 0.5, colors: [mix(pop, '#ffffff', 0.4), c.secondary], x: logo * 0.55, y: -logo * 0.45, anim: A('pop-in', 0.4, 'fade-out', 0.35) });

      const name = H(env, 'Studio Kettle', { name: 'Channel name', start: 1.0, duration: till(d, 1.0), size: L.tall ? 136 : L.wide ? 128 : 104, maxWidth: L.wide ? 1400 : L.s.w, maxLines: 1, textAnim: { in: { id: pick(r, ['char-spring-in', 'char-rise-in', 'cascade-center-in']), duration: 0.9 } }, anim: A(undefined, 0, 'zoom-out', 0.45) });
      const tag = label(env, 'New videos every Friday', { start: 1.5, duration: till(d, 1.5), size: L.tall ? 36 : 30, color: alpha(c.text, 0.85), track: 0.24, textAnim: { in: { id: 'tracking-in', duration: 1.0 } }, anim: A(undefined, 0, 'fade-out', 0.35) });
      const ringBox = logo + 140;
      vstack(
        [
          { clips: [burst, ...rings, disc, slot], h: ringBox, gap: L.tall ? 60 : 30 },
          { clips: [name], h: name.metrics.height, gap: 18 },
          { clips: [tag], h: tag.metrics.height },
        ],
        { centerY: 0 },
      );
      spark.transform.y += slot.transform.y;
      return [bg, burst, ...rings, disc, slot, spark, name, tag];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 2. End screen with two "watch next" slots
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-youtube-end-screen',
    name: 'Subscribe End Screen',
    category: 'youtube',
    tags: ['end screen', 'outro', 'subscribe', 'watch next', 'youtube', 'thumbnails', 'end card'],
    duration: 12,
    poster: 0.5,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['mesh', 'flow', 'grid'] as const), { duration: d });
      const pop = vivid(env, c.bg);
      const out = A(undefined, 0, 'fade-out', 0.5);

      const head = H(env, 'Thanks for watching!', { name: 'Headline', start: 0.3, duration: till(d, 0.3), size: L.tall ? 100 : L.wide ? 92 : 72, maxWidth: L.wide ? L.s.w * 0.42 : L.s.w, maxLines: 2, style: { align: L.wide ? 'left' : 'center' }, textAnim: { in: { id: 'word-rise-in', duration: 0.8 } }, anim: out });

      // Thumbnails
      const tw = L.wide ? Math.min(L.s.w * 0.5, ((L.s.h - 2 * 40 - 28 - 44) / 2 - 12) * (16 / 9)) : L.square ? (L.s.w - 32) / 2 : L.s.w * (L.tall ? 0.86 : 0.7);
      const th = Math.round((tw * 9) / 16);
      const thumbLabels = ['Watch next', 'Most popular'];
      const thumbs = thumbLabels.map((t, i) => {
        const s = 0.8 + i * 0.3;
        const lab = label(env, t, { start: s + 0.15, duration: till(d, s + 0.15), size: L.tall ? 30 : 26, color: c.textMuted, track: 0.18, style: { align: 'left' }, anim: A('fade-in', 0.5, 'fade-out', 0.4) });
        const frame = makeShape('rect', { name: `Thumb ${i + 1} frame`, start: s, duration: till(d, s), width: Math.round(tw + 12), height: th + 12, radius: 30, fill: linear(135, pop, mix(pop, c.secondary, 0.6)), anim: A('zoom-soft-in', 0.6, 'fade-out', 0.4) });
        const slot = makeSlot({ name: `Next video ${i + 1}`, start: s, duration: till(d, s), width: Math.round(tw), height: th, radius: 24, anim: A('zoom-soft-in', 0.6, 'fade-out', 0.4) });
        return { lab, frame, slot };
      });

      // Channel block
      const av = L.wide ? 300 : L.tall ? 220 : 170;
      const avatar = makeSlot({ name: 'Channel avatar', start: 0.6, duration: till(d, 0.6), width: av, height: av, radius: av / 2, anim: A('pop-in', 0.5, 'pop-out', 0.4) });
      const avRing = makeShape('ellipse', { name: 'Avatar ring', start: 0.55, duration: till(d, 0.55), width: av + 20, height: av + 20, fill: alpha(c.bg, 0), stroke: { color: pop, width: 5 }, anim: A('zoom-in', 0.5, 'fade-out', 0.4) });
      const chan = strong(env, 'Studio Kettle', { name: 'Channel name', start: 0.9, duration: till(d, 0.9), size: L.tall ? 48 : L.wide ? 48 : 38, weight: 700, style: { align: 'left' }, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.4) });
      const subs = B(env, '312K subscribers', { name: 'Subscribers', start: 1.0, duration: till(d, 1.0), size: L.tall ? 32 : L.wide ? 32 : 26, color: c.textMuted, style: { align: 'left' }, anim: A('soft-slide-left-in', 0.45, 'fade-out', 0.4) });
      const btn = pill(env, 'Subscribe', { size: L.tall ? 38 : L.wide ? 38 : 30, fill: c.primary, start: 1.4, duration: till(d, 1.4), anim: A('pop-up-in', 0.5, 'pop-out', 0.35, 'pulse', 1.6) });
      const bellS = Math.round(btn.h * 1.05);
      const bell = makeSticker('bell-ring', { name: 'Bell', start: 1.7, duration: till(d, 1.7), size: bellS, colors: [c.secondary, mix(c.secondary, c.primary, 0.4), '#ffffff'], anim: A('pop-in', 0.4, 'pop-out', 0.3) });

      // Channel row: avatar | name, subs, button + bell
      const infoW = Math.max(chan.metrics.inkWidth, subs.metrics.inkWidth, btn.w + 16 + bellS);
      const infoH = chan.metrics.height + 4 + subs.metrics.height + 20 + btn.h;
      const rowW = av + 40 + infoW;
      const rowH = Math.max(av + 20, infoH);
      const placeChannel = (left: number, cy: number): void => {
        setXY([avatar, avRing], left + av / 2 + 10, cy);
        const ix = left + av + 40;
        vstack([{ clips: [chan], h: chan.metrics.height, gap: 4 }, { clips: [subs], h: subs.metrics.height, gap: 20 }, { clips: btn.clips, h: btn.h }], { centerY: cy });
        alignLeft(chan, ix);
        alignLeft(subs, ix);
        setXY(btn.clips, ix + btn.w / 2);
        setXY([bell], ix + btn.w + 16 + bellS / 2, btn.box.transform.y);
      };

      if (L.wide) {
        const left = -L.s.hw;
        vstack([{ clips: [head], h: head.metrics.height, gap: 70 }, { clips: [], h: rowH }], { centerY: 0 });
        alignLeft(head, left);
        placeChannel(left, head.transform.y + head.metrics.height / 2 + 70 + rowH / 2);
        const tx = L.s.hw - tw / 2;
        const items = thumbs.map((t) => [
          { clips: [t.lab], h: t.lab.metrics.height, gap: 14 },
          { clips: [t.frame, t.slot], h: th + 12, gap: 44 },
        ]);
        vstack(items.flat(), { centerY: 0 });
        for (const t of thumbs) {
          setXY([t.frame, t.slot], tx);
          alignLeft(t.lab, tx - tw / 2);
        }
      } else if (L.square) {
        const thumbRowY = 30;
        thumbs.forEach((t, i) => {
          const x = -L.s.hw + tw / 2 + i * (tw + 32);
          setXY([t.frame, t.slot], x, thumbRowY);
          t.lab.transform.y = thumbRowY - th / 2 - 22 - t.lab.metrics.height / 2;
          alignLeft(t.lab, x - tw / 2);
        });
        head.transform.y = Math.round(-L.s.hh + head.metrics.height / 2);
        placeChannel(-rowW / 2, L.s.hh - rowH / 2);
      } else {
        const rows = [
          { clips: [head], h: head.metrics.height, gap: L.tall ? 60 : 40 },
          ...thumbs.flatMap((t, i) => [
            { clips: [t.lab], h: t.lab.metrics.height, gap: 14 },
            { clips: [t.frame, t.slot], h: th + 12, gap: i === 0 ? 36 : L.tall ? 70 : 44 },
          ]),
          { clips: [], h: rowH },
        ];
        const total = vstack(rows, { centerY: 0 });
        for (const t of thumbs) alignLeft(t.lab, -tw / 2);
        placeChannel(-rowW / 2, total / 2 - rowH / 2);
      }

      return [bg, head, ...thumbs.flatMap((t) => [t.lab, t.frame, t.slot]), avRing, avatar, chan, subs, ...btn.clips, bell];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 3. Chapter title card
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-youtube-chapter-card',
    name: 'Chapter Title Card',
    category: 'youtube',
    tags: ['chapter', 'section', 'part', 'title card', 'youtube', 'tutorial', 'timestamp'],
    duration: 4,
    poster: 0.55,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const bg = backdrop(env, pick(r, ['flow', 'grid', 'mesh'] as const), { duration: d });
      const pop = vivid(env, c.bg, 3);
      const hollow = outlineFriendly(env) && chance(r, 0.5);
      const out = A(undefined, 0, 'fade-out', 0.35);
      const side = L.wide;

      const numSize = L.wide ? 400 : L.tall ? 380 : 300;
      const num = H(env, '02', {
        name: 'Chapter number',
        start: 0.1,
        duration: till(d, 0.1),
        size: numSize,
        color: hollow ? alpha(c.bg, 0) : pop,
        style: { letterSpacing: 0, uppercase: false, lineHeight: 0.95, ...(hollow ? { stroke: { color: pop, width: Math.round(numSize * 0.018) } } : {}) },
        anim: A('slide-right-in', 0.7, 'slide-left-out', 0.4),
      });
      const textW = side ? L.s.w * 0.58 : L.s.w;
      const align = side ? 'left' : 'center';
      const kick = label(env, 'Chapter two', { start: 0.4, duration: till(d, 0.4), size: L.tall ? 34 : 30, color: pop, track: 0.3, style: { align }, anim: A('soft-slide-up-in', 0.45, 'fade-out', 0.3) });
      const title = H(env, 'Setting up the studio', { name: 'Chapter title', start: 0.55, duration: till(d, 0.55), size: L.tall ? 120 : L.wide ? 118 : 92, maxWidth: textW, maxLines: 2, style: { align }, textAnim: { in: { id: 'line-rise-in', duration: 0.7 } }, anim: out });
      const stamp = pill(env, '04:32', { size: L.tall ? 32 : 28, fill: alpha(c.text, c.dark ? 0.14 : 0.08), color: c.text, weight: 600, start: 0.9, duration: till(d, 0.9), stroke: { color: alpha(c.text, 0.25), width: 2 }, anim: A('pop-soft-in', 0.4, 'fade-out', 0.3) });
      const trackW = side ? Math.min(textW, 760) : L.s.w * 0.8;
      const track = makeShape('rect', { name: 'Progress track', start: 1.0, duration: till(d, 1.0), width: Math.round(trackW), height: 10, radius: 5, fill: alpha(c.text, c.dark ? 0.16 : 0.1), anim: A('wipe-right-in', 0.5, 'fade-out', 0.3) });
      const fill = makeShape('rect', { name: 'Progress', start: 1.2, duration: till(d, 1.2), width: Math.round(trackW * 0.4), height: 10, radius: 5, fill: linear(0, c.primary, pop), anim: A('wipe-right-in', 0.8, 'fade-out', 0.3) });

      if (side) {
        const left = -L.s.hw;
        num.transform.x = Math.round(left + num.metrics.inkWidth / 2);
        const divX = left + num.metrics.inkWidth + 70;
        const tx = divX + 70;
        const tw = L.s.hw - tx;
        const title2 = H(env, 'Setting up the studio', { name: 'Chapter title', start: 0.55, duration: till(d, 0.55), size: 118, maxWidth: tw, maxLines: 2, style: { align: 'left' }, textAnim: { in: { id: 'line-rise-in', duration: 0.7 } }, anim: out });
        const div = makeShape('rect', { name: 'Divider', start: 0.3, duration: till(d, 0.3), width: 6, height: Math.round(numSize * 0.8), radius: 3, x: divX, fill: alpha(c.text, 0.25), anim: A('wipe-down-in', 0.5, 'fade-out', 0.3) });
        const stampRow = { clips: stamp.clips, h: stamp.h, gap: 26 };
        vstack([{ clips: [kick], h: kick.metrics.height, gap: 14 }, { clips: [title2], h: title2.metrics.height, gap: 26 }, stampRow, { clips: [track, fill], h: 10 }], { centerY: 0 });
        alignLeft(kick, tx);
        alignLeft(title2, tx);
        setXY(stamp.clips, tx + stamp.w / 2);
        track.transform.x = Math.round(tx + Math.min(tw, trackW) / 2);
        track.shape.width = Math.round(Math.min(tw, trackW));
        fill.shape.width = Math.round(track.shape.width * 0.4);
        fill.transform.x = Math.round(tx + fill.shape.width / 2);
        return [bg, num, div, kick, title2, ...stamp.clips, track, fill];
      }
      vstack(
        [
          { clips: [num], h: num.metrics.height * 0.9, gap: L.tall ? 30 : 10 },
          { clips: [kick], h: kick.metrics.height, gap: 16 },
          { clips: [title], h: title.metrics.height, gap: 30 },
          { clips: stamp.clips, h: stamp.h, gap: 34 },
          { clips: [track, fill], h: 10 },
        ],
        { centerY: 0 },
      );
      fill.transform.x = Math.round(-trackW / 2 + fill.shape.width / 2);
      return [bg, num, kick, title, ...stamp.clips, track, fill];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 4. Like & subscribe overlay (no background)
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-youtube-like-subscribe',
    name: 'Like & Subscribe Overlay',
    category: 'youtube',
    tags: ['like', 'subscribe', 'bell', 'overlay', 'youtube', 'call to action', 'cursor'],
    duration: 6,
    poster: 0.62,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const k = L.tall ? 1.35 : L.wide ? 1.25 : 1.05;
      const pop = vivid(env, c.surface);
      const out = A(undefined, 0, 'pop-soft-out', 0.4);
      const inA = A('pop-soft-in', 0.45);

      const thumbS = Math.round(84 * k);
      const thumb = makeSticker('like-thumb', { name: 'Like', start: 0.5, duration: till(d, 0.5), size: thumbS, colors: [pop, textOn(env, pop)], anim: A('pop-in', 0.45, 'pop-out', 0.35) });
      const likeT = strong(env, 'Like', { name: 'Like label', start: 0.6, duration: till(d, 0.6), size: Math.round(40 * k), weight: 700, color: c.text, anim: A('fade-in', 0.4, 'fade-out', 0.35) });
      const sub = pill(env, 'Subscribe', { size: Math.round(38 * k), fill: c.primary, start: 0.7, duration: 2.3 - 0.7, anim: A('pop-in', 0.45) });
      const subd = pill(env, 'Subscribed', { size: Math.round(38 * k), fill: alpha(c.text, c.dark ? 0.18 : 0.1), color: c.text, minWidth: sub.w, start: 2.3, duration: till(d, 2.3), anim: A('pop-soft-in', 0.25, 'pop-out', 0.35) });
      const bellS = Math.round(84 * k);
      const bell = makeSticker('bell-ring', { name: 'Bell', start: 0.8, duration: till(d, 0.8), size: bellS, colors: [c.secondary, mix(c.secondary, c.primary, 0.4), '#ffffff'], anim: A('pop-in', 0.45, 'pop-out', 0.35) });

      const pad = Math.round(26 * k);
      const g1 = Math.round(14 * k);
      const g2 = Math.round(36 * k);
      const contentW = thumbS + g1 + likeT.metrics.inkWidth + g2 + Math.max(sub.w, subd.w) + g1 + bellS;
      const barW = contentW + pad * 2;
      const barH = Math.max(thumbS, sub.h) + pad * 1.4;
      const y = L.portrait ? L.s.hh - barH / 2 - (L.tall ? 120 : 20) : L.s.hh - barH / 2;
      const bar = makeShape('rect', { name: 'Bar', start: 0.3, duration: till(d, 0.3), width: Math.round(barW), height: Math.round(barH), radius: barH / 2, y, fill: alpha(c.surface, 0.96), shadow: { color: alpha('#000000', 0.35), blur: 30, x: 0, y: 10 }, anim: A('stretch-h-in', 0.5, 'collapse-h-out', 0.45) });
      const sep = makeShape('rect', { name: 'Separator', start: 0.6, duration: till(d, 0.6), width: 3, height: Math.round(barH * 0.5), y, fill: alpha(c.text, 0.2), anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      hrow(
        [
          { clips: [thumb], w: thumbS, gap: g1 },
          { clips: [likeT], w: likeT.metrics.inkWidth, gap: g2 / 2 },
          { clips: [sep], w: 3, gap: g2 / 2 },
          { clips: [...sub.clips, ...subd.clips], w: Math.max(sub.w, subd.w), gap: g1 },
          { clips: [bell], w: bellS },
        ],
        { centerX: 0 },
      );
      setXY([thumb, likeT, ...sub.clips, ...subd.clips, bell], undefined, y);

      // A cursor clicks Like, then Subscribe, then the bell.
      const cs = Math.round(110 * k);
      const off = cs * 0.32;
      const tx = (x: number): number => x + off;
      const ty = y + off;
      const cursor = makeSticker('cursor-click', { name: 'Cursor', start: 1.0, duration: 3.6 - 1.0, size: cs, anim: A('fade-in', 0.3, 'fade-out', 0.35) });
      cursor.keyframes = {
        x: [kf(0, tx(thumb.transform.x) + 120, 'easeOutCubic'), kf(0.35, tx(thumb.transform.x), 'hold'), kf(0.75, tx(thumb.transform.x), 'easeInOutCubic'), kf(1.2, tx(sub.box.transform.x), 'hold'), kf(1.6, tx(sub.box.transform.x), 'easeInOutCubic'), kf(2.0, tx(bell.transform.x), 'hold')],
        y: [kf(0, ty + 140, 'easeOutCubic'), kf(0.35, ty, 'hold')],
      };
      cursor.transform.x = Math.round(tx(thumb.transform.x));
      cursor.transform.y = Math.round(ty);
      void inA;
      void out;
      return [bar, sep, thumb, likeT, ...sub.clips, ...subd.clips, bell, cursor];
    },
  },

  // -------------------------------------------------------------------------------------------
  // 5. Comment highlight overlay
  // -------------------------------------------------------------------------------------------
  {
    id: 'b-youtube-comment-callout',
    name: 'Comment Highlight',
    category: 'youtube',
    tags: ['comment', 'reply', 'community', 'overlay', 'youtube', 'q&a', 'viewer question'],
    duration: 7,
    poster: 0.6,
    build: (env) => {
      const L = lay(env);
      const c = env.palette;
      const d = env.duration;
      const r = env.rng;
      const pop = vivid(env, c.surface);
      const k = L.tall ? 1.2 : L.wide ? 1.15 : 0.92;
      const cardW = Math.round(L.wide ? 1000 : L.s.w);
      const pad = Math.round(40 * k);
      const av = Math.round(96 * k);
      const innerW = cardW - pad * 2 - av - 24;

      const tag = pill(env, 'Top comment', { size: Math.round(26 * k), fill: pop, upper: true, track: 0.16, start: 0.2, duration: till(d, 0.2), anim: A('pop-in', 0.4, 'pop-out', 0.3) });
      const user = strong(env, '@nina.bakes', { name: 'Username', start: 0.6, duration: till(d, 0.6), size: Math.round(34 * k), weight: 700, color: c.text, anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      const when = B(env, '2 days ago', { name: 'Time', start: 0.65, duration: till(d, 0.65), size: Math.round(28 * k), color: c.textMuted, anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      const text = B(env, 'Can you do a full video on sourdough starters? Mine keeps going flat after day three!', { name: 'Comment', start: 0.8, duration: till(d, 0.8), size: Math.round(36 * k), color: c.text, maxWidth: innerW, maxLines: 4, style: { align: 'left', lineHeight: 1.3 }, textAnim: { in: { id: 'word-fade-in', duration: 1.2 } }, anim: A(undefined, 0, 'fade-out', 0.3) });
      const likeS = Math.round(46 * k);
      const like = makeSticker('like-thumb', { name: 'Likes icon', start: 1.6, duration: till(d, 1.6), size: likeS, colors: [pop, textOn(env, pop)], anim: A('pop-in', 0.4, 'pop-out', 0.3) });
      const count = strong(env, '1.2K', { name: 'Likes', start: 1.65, duration: till(d, 1.65), size: Math.round(30 * k), weight: 600, color: c.textMuted, anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      const reply = label(env, 'Reply', { start: 1.75, duration: till(d, 1.75), size: Math.round(24 * k), color: c.text, track: 0.12, anim: A('fade-in', 0.4, 'fade-out', 0.3) });
      const heart = makeSticker('neon-heart', { name: 'Creator heart', start: 2.2, duration: till(d, 2.2), size: likeS, colors: [c.accent, '#ffffff'], anim: A('pop-in', 0.45, 'pop-out', 0.3, 'heartbeat', 1.2) });

      const headH = Math.max(user.metrics.height, when.metrics.height);
      const footH = Math.max(likeS, count.metrics.height);
      const bodyH = headH + 10 + text.metrics.height + 22 + footH;
      const cardH = Math.round(Math.max(av, bodyH) + pad * 2);

      const cx = L.wide ? -L.s.hw + cardW / 2 : 0;
      const cy = L.wide ? -L.s.hh + tag.h + 20 + cardH / 2 : L.portrait ? -L.s.hh * 0.35 : -L.s.hh + tag.h + 20 + cardH / 2;
      const card = makeShape('rect', { name: 'Card', start: 0.3, duration: till(d, 0.3), width: cardW, height: cardH, radius: 32, x: cx, y: cy, fill: c.surface, shadow: { color: alpha('#000000', 0.4), blur: 36, x: 0, y: 14 }, anim: A('spring-up-in', 0.6, 'sink-out', 0.5) });
      setXY(tag.clips, cx - cardW / 2 + tag.w / 2, cy - cardH / 2 - 20 - tag.h / 2 + 8);
      const left = cx - cardW / 2 + pad;
      const avatar = makeSlot({ name: 'Viewer avatar', start: 0.5, duration: till(d, 0.5), width: av, height: av, radius: av / 2, x: left + av / 2, y: cy - cardH / 2 + pad + av / 2, anim: A('pop-in', 0.45, 'pop-out', 0.3) });
      const tx = left + av + 24;
      const top = cy - cardH / 2 + pad;
      user.transform.y = when.transform.y = Math.round(top + headH / 2);
      alignLeft(user, tx);
      alignLeft(when, tx + user.metrics.inkWidth + 18);
      text.transform.y = Math.round(top + headH + 10 + text.metrics.height / 2);
      alignLeft(text, tx);
      const fy = top + headH + 10 + text.metrics.height + 22 + footH / 2;
      hrow(
        [
          { clips: [like], w: likeS, gap: 10 },
          { clips: [count], w: count.metrics.inkWidth, gap: 36 },
          { clips: [reply], w: reply.metrics.inkWidth, gap: 36 },
          { clips: [heart], w: likeS },
        ],
        { left: tx },
      );
      setXY([like, count, reply, heart], undefined, fy);
      void r;
      return [card, ...tag.clips, avatar, user, when, text, like, count, reply, heart];
    },
  },
];

export default templates;
