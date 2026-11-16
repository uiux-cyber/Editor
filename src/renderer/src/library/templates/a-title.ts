import { kf, linear, makeGenerator, makeShape, makeSlot } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { accentOn, an, atLeft, atRight, copy, inkOn, label, life, mutedOn, slotFill, title, tone, type MText } from './_lib/a-kit';
import { alpha, chance, mix, pick, safeArea, stack } from './_lib/kit';

const CLEAR = '#00000000';

/** Lines of a heading at one shared size (the size the longest line needs to fit `maxW`). */
function linesAtOneSize(env: TemplateEnv, lines: string[], size: number, maxW: number, base: (s: number) => Parameters<typeof title>[2]): MText[] {
  const first = lines.map((l) => title(env, l, { ...base(size), maxWidth: maxW, maxLines: 1 }));
  const s = Math.min(...first.map((t) => t.text.fontSize));
  return lines.map((l) => title(env, l, { ...base(s) }));
}

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'title-chapter-card',
    name: 'Chapter Card',
    category: 'title',
    tags: ['title', 'chapter', 'editorial', 'documentary', 'section', 'number'],
    duration: 5,
    poster: 0.55,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const wide = env.cw > env.ch * 1.2;
      const num = pick(env.rng, ['01', '02', '03']);
      const numColor = accentOn(env, c.bg);
      const clips: Clip[] = [makeGenerator('paper', { name: 'Paper', duration: d, params: { colorA: c.bg, colorB: mix(c.bg, c.bg2, 0.9), roughness: 0.5, fibres: 0.35, speed: 0 } })];
      const n = title(env, num, { name: 'Number', ...life(env, 0.3, 0.1), size: wide ? 330 : 300, color: numColor, maxWidth: safe.w, maxLines: 1, anim: an('mask-up-in', 0.7, 'mask-down-out', 0.45) });
      const kick = label(env, 'Chapter ' + ['one', 'two', 'three'][Number(num) - 1], { name: 'Chapter', ...life(env, 0.6, 0.2), size: 28, weight: 600, track: 0.3, color: mutedOn(env, c.bg), anim: an('fade-in', 0.6, 'fade-out', 0.4) });
      if (wide) {
        const textW = Math.min(820, safe.w - n.metrics.inkWidth - 160);
        const head = title(env, 'The Quiet Beginning', { name: 'Title', ...life(env, 0.75), size: 120, maxWidth: textW, maxLines: 3, style: { align: 'left' }, textAnim: { in: { id: 'line-rise-in', duration: 0.9 } }, anim: an(undefined, 0, 'fade-out', 0.45) });
        const groupW = n.metrics.inkWidth + 120 + Math.max(head.metrics.inkWidth, kick.metrics.inkWidth);
        const x0 = -groupW / 2;
        n.transform.x = Math.round(x0 + n.metrics.inkWidth / 2);
        const ruleX = Math.round(x0 + n.metrics.inkWidth + 60);
        const tx = ruleX + 60;
        stack(
          [
            { clip: kick, height: kick.metrics.height, gap: 22 },
            { clip: head, height: head.metrics.height },
          ],
          { centerY: 0 },
        );
        atLeft(kick, tx);
        atLeft(head, tx);
        const h = Math.max(n.metrics.height, kick.metrics.height + 22 + head.metrics.height);
        clips.push(n, makeShape('rect', { name: 'Rule', ...life(env, 0.5, 0.2), width: 3, height: Math.round(h * 0.9), x: ruleX, fill: alpha(c.text, 0.35), anim: an('wipe-down-in', 0.6, 'wipe-up-out', 0.4) }), kick, head);
      } else {
        const head = title(env, 'The Quiet Beginning', { name: 'Title', ...life(env, 0.75), size: env.portrait ? 128 : 112, maxWidth: safe.w, maxLines: 3, textAnim: { in: { id: 'line-rise-in', duration: 0.9 } }, anim: an(undefined, 0, 'fade-out', 0.45) });
        const rule = makeShape('rect', { name: 'Rule', ...life(env, 0.5, 0.2), width: 120, height: 3, fill: alpha(c.text, 0.35), anim: an('wipe-center-in', 0.6, 'wipe-center-out', 0.4) });
        stack(
          [
            { clip: n, height: n.metrics.height, gap: 30 },
            { clip: rule, height: 3, gap: 40 },
            { clip: kick, height: kick.metrics.height, gap: 22 },
            { clip: head, height: head.metrics.height },
          ],
          { centerY: 0 },
        );
        clips.push(n, rule, kick, head);
      }
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'title-marker-highlight',
    name: 'Marker Highlight',
    category: 'title',
    tags: ['title', 'highlight', 'marker', 'youtube', 'tips', 'bold'],
    duration: 5,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const marks = [c.primary, c.secondary];
      const lines = pick(env.rng, [
        ['Ten tips for', 'better sleep'],
        ['How I plan', 'my whole week'],
        ['The easiest', 'pasta recipe'],
      ]);
      const tilt = pick(env.rng, [-2, -1.2, 1.2]);
      const base = env.portrait ? 150 : 140;
      const texts = linesAtOneSize(env, lines, base, safe.w * 0.86 - 60, (s) => ({ name: 'Line', size: s }));
      const clips: Clip[] = [
        makeShape('rect', { name: 'Backdrop', duration: d, width: env.cw, height: env.ch, fill: c.bg }),
        makeGenerator('halftone', { name: 'Halftone', duration: d, opacity: 0.6, params: { colorA: mix(c.bg, c.text, 0.07), colorB: c.bg, size: 26, angle: 30, speed: 0.3 } }),
      ];
      const items: { mark: ShapeClip; text: MText; h: number }[] = texts.map((t, i) => {
        const fill = marks[i % marks.length];
        t.name = `Line ${i + 1}`;
        t.text.fill = { type: 'solid', color: inkOn(env, fill) };
        Object.assign(t, life(env, 0.5 + i * 0.3, 0.65 - i * 0.1));
        t.anim = an('soft-slide-up-in', 0.5, 'fade-out', 0.3);
        const padX = Math.round(t.text.fontSize * 0.28);
        const h = Math.round(t.metrics.height + t.text.fontSize * 0.22);
        const mark = makeShape('rect', {
          name: `Highlight ${i + 1}`,
          ...life(env, 0.3 + i * 0.3, 0.2 - i * 0.1),
          width: Math.round(t.metrics.inkWidth + padX * 2),
          height: h,
          radius: 10,
          rotation: tilt * (i % 2 === 0 ? 1 : -0.6),
          fill,
          anim: an('wipe-right-in', 0.45, 'wipe-left-out', 0.4),
        });
        return { mark, text: t, h };
      });
      stack(
        items.map((it) => ({ clip: it.mark, height: it.h, gap: 26 })),
        { centerY: -36 },
      );
      for (const it of items) {
        it.text.transform.y = it.mark.transform.y;
        clips.push(it.mark, it.text);
      }
      const last = items[items.length - 1];
      const sub = label(env, 'Episode 4  ·  Health & habits', { name: 'Subtitle', ...life(env, 1.2, 0.1), size: 30, weight: 600, track: 0.2, color: mutedOn(env, c.bg), maxWidth: safe.w, maxLines: 1, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) });
      sub.transform.y = Math.round(last.mark.transform.y + last.h / 2 + 60 + sub.metrics.height / 2);
      clips.push(sub);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'title-glass-mesh',
    name: 'Glass Mesh',
    category: 'title',
    tags: ['title', 'gradient', 'mesh', 'glass', 'card', 'modern', 'tech'],
    duration: 6,
    poster: 0.55,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const card = c.surface;
      const ink = inkOn(env, card);
      const cardW = Math.round(Math.min(safe.w, env.portrait ? safe.w : 1240));
      const pad = env.portrait ? 64 : 80;
      const tagFill = c.primary;
      const tag = label(env, 'New series', { name: 'Tag', ...life(env, 0.8, 0.5), size: 24, weight: 700, track: 0.2, color: inkOn(env, tagFill), anim: an('pop-in', 0.45, 'fade-out', 0.3) });
      const head = title(env, 'Building the Future of Work', { name: 'Title', ...life(env, 0.9, 0.45), size: env.portrait ? 120 : 112, color: ink, maxWidth: cardW - pad * 2, maxLines: 3, textAnim: { in: { id: 'word-rise-in', duration: 1.0 } }, anim: an(undefined, 0, 'fade-out', 0.35) });
      const sub = copy(env, 'A conversation with the people shaping how we live and work.', { name: 'Subtitle', ...life(env, 1.3, 0.45), size: 38, color: mutedOn(env, card), maxWidth: Math.min(cardW - pad * 2, 900), maxLines: 3, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.35) });
      const tagH = Math.round(tag.metrics.height + 14);
      const tagW = Math.round(tag.metrics.inkWidth + 40);
      const innerH = tagH + 36 + head.metrics.height + 30 + sub.metrics.height;
      const cardH = Math.round(innerH + pad * 2);
      const tagBox = makeShape('pill', { name: 'Tag pill', ...life(env, 0.7, 0.45), width: tagW, height: tagH, fill: tagFill, anim: an('pop-in', 0.45, 'pop-out', 0.3) });
      stack(
        [
          { clip: tagBox, height: tagH, gap: 36 },
          { clip: head, height: head.metrics.height, gap: 30 },
          { clip: sub, height: sub.metrics.height },
        ],
        { centerY: 0 },
      );
      tag.transform.y = tagBox.transform.y;
      if (!env.portrait && chance(env.rng, 0.5)) {
        const lx = -cardW / 2 + pad;
        for (const t of [head, sub]) {
          t.text.align = 'left';
          atLeft(t, lx);
        }
        tagBox.transform.x = Math.round(lx + tagW / 2);
        tag.transform.x = tagBox.transform.x;
      }
      return [
        makeGenerator('mesh-gradient', { name: 'Mesh', duration: d, params: { colorA: c.primary, colorB: c.secondary, colorC: c.accent, colorD: c.bg2, warp: 0.7, speed: 0.6 } }),
        makeShape('rect', {
          name: 'Glass card',
          ...life(env, 0.3, 0.05),
          width: cardW,
          height: cardH,
          radius: 44,
          fill: alpha(card, 0.8),
          stroke: { color: alpha(c.dark ? '#ffffff' : card, 0.4), width: 2 },
          shadow: { color: alpha('#000000', 0.25), blur: 50, x: 0, y: 24 },
          anim: an('zoom-soft-in', 0.7, 'zoom-soft-out', 0.5),
        }),
        tagBox,
        tag,
        head,
        sub,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'title-corner-frame',
    name: 'Corner Frame',
    category: 'title',
    tags: ['title', 'frame', 'minimal', 'brackets', 'architecture', 'clean'],
    duration: 5,
    poster: 0.55,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const accent = accentOn(env, c.bg);
      const w = Math.min(safe.w - 120, env.portrait ? safe.w - 80 : 1300);
      const head = title(env, 'Form Follows Feeling', { name: 'Title', ...life(env, 0.6, 0.1), size: env.portrait ? 130 : 128, maxWidth: w - 120, maxLines: 3, textAnim: { in: { id: 'char-blur-in', duration: 1.1 } }, anim: an(undefined, 0, 'blur-out', 0.45) });
      const sub = label(env, 'An architecture film', { name: 'Subtitle', ...life(env, 1.2, 0.15), size: 28, weight: 500, track: 0.32, color: mutedOn(env, c.bg), maxWidth: w - 120, maxLines: 1, anim: an('fade-in', 0.6, 'fade-out', 0.35) });
      stack(
        [
          { clip: head, height: head.metrics.height, gap: 40 },
          { clip: sub, height: sub.metrics.height },
        ],
        { centerY: 0 },
      );
      const fw = Math.round(Math.max(head.metrics.inkWidth, sub.metrics.inkWidth) + 200);
      const fh = Math.round(head.metrics.height + 40 + sub.metrics.height + 180);
      const arm = Math.round(Math.min(fw, fh) * 0.16 + 30);
      const t = 5;
      const clips: Clip[] = [
        chance(env.rng, 0.5)
          ? makeGenerator('topographic', { name: 'Contours', duration: d, params: { colorBg: c.bg, colorA: tone(c.text, c.bg, 0.88), colorB: tone(c.primary, c.bg, 0.55), levels: 18, lineWidth: 1.6, scale: 1, speed: 0.25 } })
          : makeGenerator('grid-lines', { name: 'Grid', duration: d, params: { colorBg: c.bg, colorA: tone(c.text, c.bg, 0.82), size: 72, major: 5, lineWidth: 1.2, fade: 0.75, angle: 0, speed: 0.2 } }),
      ];
      const corners: [number, number][] = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ];
      corners.forEach(([sx, sy], i) => {
        const cx = (sx * fw) / 2;
        const cy = (sy * fh) / 2;
        const off = 70;
        const s = 0.2 + i * 0.06;
        const kx = (v: number): ReturnType<typeof kf>[] => [kf(0, v + sx * off, 'easeOutCubic'), kf(0.9, v)];
        const ky = (v: number): ReturnType<typeof kf>[] => [kf(0, v + sy * off, 'easeOutCubic'), kf(0.9, v)];
        const hx = Math.round(cx - (sx * arm) / 2);
        const hy = Math.round(cy - (sy * t) / 2);
        const vx = Math.round(cx - (sx * t) / 2);
        const vy = Math.round(cy - (sy * arm) / 2);
        clips.push(
          makeShape('rect', { name: `Corner ${i + 1}a`, ...life(env, s, 0.05), width: arm, height: t, x: hx, y: hy, fill: accent, keyframes: { x: kx(hx), y: ky(hy) }, anim: an('fade-in', 0.4, 'fade-out', 0.4) }),
          makeShape('rect', { name: `Corner ${i + 1}b`, ...life(env, s, 0.05), width: t, height: arm, x: vx, y: vy, fill: accent, keyframes: { x: kx(vx), y: ky(vy) }, anim: an('fade-in', 0.4, 'fade-out', 0.4) }),
        );
      });
      const vol = label(env, 'Vol. 02', { name: 'Volume', ...life(env, 1.0, 0.2), size: 22, weight: 700, track: 0.26, color: accent, anim: an('fade-in', 0.5, 'fade-out', 0.3) });
      vol.transform.y = Math.round(-fh / 2 + 34 + vol.metrics.height / 2);
      atLeft(vol, -fw / 2 + 34);
      const year = label(env, '2026', { name: 'Year', ...life(env, 1.1, 0.2), size: 22, weight: 700, track: 0.26, color: accent, anim: an('fade-in', 0.5, 'fade-out', 0.3) });
      year.transform.y = Math.round(fh / 2 - 34 - year.metrics.height / 2);
      atRight(year, fw / 2 - 34);
      clips.push(vol, year, head, sub);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'title-split-line',
    name: 'Split Line',
    category: 'title',
    tags: ['title', 'line', 'reveal', 'event', 'minimal', 'elegant'],
    duration: 5,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const w = Math.min(safe.w, 1500);
      const lineColor = accentOn(env, c.bg);
      const head = title(env, 'Design Week', { name: 'Title', ...life(env, 0.6, 0.35), size: env.portrait ? 170 : 190, maxWidth: w, maxLines: 2, anim: an('mask-up-in', 0.75, 'mask-down-out', 0.5) });
      const sub = label(env, 'Milan  ·  April 14 – 20', { name: 'Subtitle', ...life(env, 0.85, 0.35), size: 34, weight: 600, track: 0.3, color: mutedOn(env, c.bg), maxWidth: w, maxLines: 1, anim: an('mask-down-in', 0.7, 'mask-up-out', 0.5) });
      const lineY = Math.round((head.metrics.height - sub.metrics.height) / 2 - 20);
      head.transform.y = Math.round(lineY - 8 - head.metrics.height / 2);
      sub.transform.y = Math.round(lineY + 16 + sub.metrics.height / 2);
      const lw = Math.round(Math.min(safe.w, Math.max(head.metrics.inkWidth, sub.metrics.inkWidth) + 240));
      return [
        makeGenerator('radial-glow', { name: 'Glow', duration: d, params: { colorA: tone(c.bg2, c.bg, 0.2), colorB: c.bg, centerX: 0.5, centerY: 0.5, radius: 0.8, speed: 0.5 } }),
        makeShape('rect', { name: 'Line', ...life(env, 0.2), width: lw, height: 4, radius: 2, y: lineY, fill: linear(0, alpha(lineColor, 0), lineColor, lineColor, alpha(lineColor, 0)), anim: an('wipe-center-in', 0.7, 'wipe-center-out', 0.45) }),
        makeShape(pick(env.rng, ['ellipse', 'diamond'] as const), { name: 'Ornament', ...life(env, 0.35, 0.1), width: 18, height: 18, y: lineY, fill: lineColor, anim: an('pop-in', 0.4, 'pop-out', 0.3) }),
        head,
        sub,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'title-photo-overlay',
    name: 'Photo Title',
    category: 'title',
    tags: ['title', 'photo', 'cover', 'travel', 'full bleed', 'cinematic'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const centered = env.portrait || chance(env.rng, 0.4);
      const align = centered ? 'center' : 'left';
      const shade = c.dark ? c.bg : c.text;
      const ink = inkOn(env, shade);
      const w = centered ? safe.w : Math.min(safe.w * 0.7, 1150);
      const x0 = -env.cw / 2 + safe.mx;
      const kick = label(env, 'Field notes', { name: 'Kicker', ...life(env, 0.8, 0.25), size: 26, weight: 700, track: 0.22, color: inkOn(env, c.primary), style: { align }, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const head = title(env, 'Iceland in Winter', { name: 'Title', ...life(env, 0.9, 0.15), size: env.portrait ? 150 : 150, color: ink, maxWidth: w, maxLines: 2, style: { align }, textAnim: { in: { id: 'char-rise-in', duration: 1.0 } }, anim: an(undefined, 0, 'fade-out', 0.45) });
      const sub = copy(env, 'Seven days chasing light across the north', { name: 'Subtitle', ...life(env, 1.4, 0.1), size: 40, color: alpha(ink, 0.82), maxWidth: Math.min(w, 900), maxLines: 2, style: { align }, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const tagH = Math.round(kick.metrics.height + 14);
      const tagW = Math.round(kick.metrics.inkWidth + 36);
      const tagBox = makeShape('rect', { name: 'Kicker tag', ...life(env, 0.7, 0.2), width: tagW, height: tagH, radius: 6, fill: c.primary, anim: an('wipe-right-in', 0.45, 'fade-out', 0.3) });
      const bottom = env.ch / 2 - safe.my;
      const total = stack(
        [
          { clip: tagBox, height: tagH, gap: 30 },
          { clip: head, height: head.metrics.height, gap: 24 },
          { clip: sub, height: sub.metrics.height },
        ],
        { top: 0 },
      );
      const shift = bottom - total;
      for (const cl of [tagBox, head, sub]) cl.transform.y += Math.round(shift);
      kick.transform.y = tagBox.transform.y;
      if (!centered) {
        atLeft(head, x0);
        atLeft(sub, x0);
        tagBox.transform.x = Math.round(x0 + tagW / 2);
        kick.transform.x = tagBox.transform.x;
      }
      const scrimH = Math.round(Math.min(env.ch, total + safe.my + 520));
      return [
        makeSlot({ name: 'Photo', duration: d, width: env.cw, height: env.ch, fill: slotFill(env), keyframes: { scaleX: [kf(0, 1, 'linear'), kf(d, 1.08)], scaleY: [kf(0, 1, 'linear'), kf(d, 1.08)] }, anim: an('fade-in', 0.6, 'fade-out', 0.5) }),
        makeShape('rect', { name: 'Scrim', duration: d, width: env.cw, height: scrimH, y: Math.round(env.ch / 2 - scrimH / 2), fill: linear(90, alpha(shade, 0), alpha(shade, 0.55), alpha(shade, 0.9)), anim: an('fade-in', 0.8, 'fade-out', 0.5) }),
        tagBox,
        kick,
        head,
        sub,
      ];
    },
  },
];

export default templates;
