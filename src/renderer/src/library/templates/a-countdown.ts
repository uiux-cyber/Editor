import { kf, linear, makeGenerator, makeShape } from '@/core/factory';
import type { Clip } from '@/core/types';
import type { TemplateDef } from '../types';
import { accentOn, an, inkOn, label, life, title, tone } from './_lib/a-kit';
import { alpha, pick, safeArea, stack } from './_lib/kit';

/* Countdowns: one text clip per number, each popping in and out on its own beat. */

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'countdown-pop-321',
    name: 'Pop 3-2-1',
    category: 'countdown',
    tags: ['countdown', '321', 'go', 'timer', 'start', 'energetic'],
    duration: 4,
    poster: 0.38,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const per = d / 4;
      const D = env.portrait ? 640 : 560;
      const discFill = c.primary;
      const ring = accentOn(env, c.bg);
      const clips: Clip[] = [
        makeGenerator('sunburst', { name: 'Rays', duration: d, params: { colorA: c.bg, colorB: tone(c.bg2, c.bg, 0.2), colorC: tone(c.primary, c.bg, 0.45), rays: 18, centerX: 0.5, centerY: 0.5, twist: 0.12, glow: 0.6, speed: 0.6 } }),
      ];
      ['3', '2', '1'].forEach((n, i) => {
        const t0 = i * per;
        clips.push(
          makeShape('ellipse', { name: `Ring ${n}`, start: t0, duration: per, width: D + 120, height: D + 120, fill: '#00000000', stroke: { color: ring, width: 10 }, anim: an('zoom-blur-in', 0.4, 'scale-up-out', 0.3) }),
          makeShape('ellipse', { name: `Disc ${n}`, start: t0, duration: per, width: D, height: D, fill: discFill, anim: an('pop-in', 0.35, 'pop-out', 0.22) }),
          title(env, n, { name: `Number ${n}`, start: t0 + 0.04, duration: per - 0.04, size: Math.round(D * 0.7), color: inkOn(env, discFill), maxWidth: D * 0.8, maxLines: 1, anim: an('stomp-in', 0.38, 'scale-up-out', 0.22) }),
        );
      });
      const goFill = c.secondary;
      const go = title(env, pick(env.rng, ['Go!', 'Let’s go!', 'Action!']), { name: 'Go', start: 3 * per + 0.05, duration: per - 0.05, size: env.portrait ? 230 : 250, color: inkOn(env, goFill), maxWidth: (D + 200) * 0.82, maxLines: 1, anim: an('elastic-in', 0.6, 'zoom-soft-out', 0.25) });
      const goW = Math.round(Math.max(D, go.metrics.inkWidth + 160));
      clips.push(
        makeShape('pill', { name: 'Go burst', start: 3 * per, duration: per, width: goW, height: Math.round(go.metrics.height + 120), fill: goFill, anim: an('elastic-in', 0.6, 'zoom-soft-out', 0.25) }),
        go,
      );
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'countdown-five-blocks',
    name: 'Five Block Countdown',
    category: 'countdown',
    tags: ['countdown', '54321', 'blocks', 'bold', 'colour', 'start'],
    duration: 6,
    poster: 0.25,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const per = d / 6;
      const fills = [c.primary, c.secondary, c.accent, c.bg2, c.primary, c.bg];
      const dirs = pick(env.rng, [
        ['wipe-up-in', 'mask-up-in', 'mask-up-out'],
        ['wipe-right-in', 'mask-left-in', 'mask-left-out'],
      ] as const);
      const size = Math.round(Math.min(env.ch * 0.62, env.cw * 0.8, 860));
      const clips: Clip[] = [makeShape('rect', { name: 'Backdrop', duration: d, width: env.cw, height: env.ch, fill: c.bg })];
      ['5', '4', '3', '2', '1'].forEach((n, i) => {
        const t0 = i * per;
        const fill = fills[i];
        clips.push(
          makeShape('rect', { name: `Panel ${n}`, start: t0, duration: Math.min(per + 0.45, d - t0), width: env.cw, height: env.ch, fill, anim: an(dirs[0], 0.4) }),
          title(env, n, { name: `Number ${n}`, start: t0 + 0.08, duration: per - 0.08, size, color: inkOn(env, fill), maxWidth: safe.w, maxLines: 1, anim: an(dirs[1], 0.4, dirs[2], 0.3) }),
        );
      });
      const endFill = fills[5];
      const t5 = 5 * per;
      const end = title(env, 'Here we go', { name: 'Final', start: t5 + 0.2, duration: per - 0.2, size: env.portrait ? 170 : 180, color: inkOn(env, endFill), maxWidth: safe.w, maxLines: 2, textAnim: { in: { id: 'word-pop-in', duration: 0.5 } }, anim: an(undefined, 0, 'fade-out', 0.25) });
      clips.push(makeShape('rect', { name: 'Panel final', start: t5, duration: per, width: env.cw, height: env.ch, fill: endFill, anim: an(dirs[0], 0.4, 'fade-out', 0.3) }), end);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'countdown-digital-timer',
    name: 'Digital Timer',
    category: 'countdown',
    tags: ['countdown', 'timer', 'starting soon', 'stream', 'digital', 'clock'],
    duration: 7,
    poster: 0.39,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const n = 5;
      const per = (d - 1.6) / n;
      const accent = accentOn(env, c.bg);
      const size = env.portrait ? 230 : 250;
      const kick = label(env, pick(env.rng, ['Starting soon', 'We start in', 'Doors open in']), { name: 'Label', ...life(env, 0.2, 1.6), size: 32, weight: 700, track: 0.34, color: accent, anim: an('fade-in', 0.5, 'fade-out', 0.3) });
      const digits = Array.from({ length: n }, (_, i) => `00:0${n - i}`);
      const probe = title(env, '00:00', { name: 'probe', duration: 1, size, maxWidth: safe.w, maxLines: 1 });
      const s = probe.text.fontSize;
      const barW = Math.round(Math.min(safe.w, Math.max(probe.metrics.inkWidth, 700)));
      const barH = 16;
      const digitBox = { transform: { y: 0 } };
      const barBox = { transform: { y: 0 } };
      stack(
        [
          { clip: kick, height: kick.metrics.height, gap: 40 },
          { clip: digitBox, height: probe.metrics.height, gap: 54 },
          { clip: barBox, height: barH },
        ],
        { centerY: 0 },
      );
      const clips: Clip[] = [
        makeGenerator('circuit', { name: 'Circuit', duration: d, params: { colorBg: c.bg, colorA: tone(c.text, c.bg, 0.9), colorB: tone(c.primary, c.bg, 0.45), size: 84, lineWidth: 4, speed: 0.6 } }),
        makeShape('rect', { name: 'Vignette', duration: d, width: env.cw * 1.1, height: env.ch * 1.1, fill: { type: 'radial', stops: [{ offset: 0, color: alpha(c.bg, 0.7) }, { offset: 0.6, color: alpha(c.bg, 0.4) }, { offset: 1, color: alpha(c.bg, 0) }] } }),
        kick,
      ];
      digits.forEach((t, i) => {
        clips.push(title(env, t, { name: `Time ${t}`, start: i * per, duration: per, size: s, x: 0, y: digitBox.transform.y, anim: an(i === 0 ? 'fade-in' : 'mask-up-in', 0.3, 'mask-up-out', 0.25) }));
      });
      const tEnd = n * per;
      const by = barBox.transform.y;
      const left = -barW / 2;
      const fx = (k: number): number => Math.round(left + (barW * k) / 2);
      clips.push(
        makeShape('pill', { name: 'Track', ...life(env, 0.3, 1.6), width: barW, height: barH, y: by, fill: alpha(c.text, 0.14), anim: an('wipe-right-in', 0.5, 'fade-out', 0.3) }),
        makeShape('pill', {
          name: 'Progress',
          start: 0.3,
          duration: tEnd - 0.3,
          width: barW,
          height: barH,
          x: fx(1),
          y: by,
          fill: linear(0, c.primary, c.secondary),
          keyframes: { scaleX: [kf(0, 1, 'linear'), kf(tEnd - 0.3, 0.02)], x: [kf(0, fx(1), 'linear'), kf(tEnd - 0.3, fx(0.02))] },
          anim: an('wipe-right-in', 0.5, 'fade-out', 0.2),
        }),
      );
      const liveFill = c.primary;
      const live = title(env, 'We’re live!', { name: 'Live', start: tEnd + 0.1, duration: d - tEnd - 0.1, size: env.portrait ? 170 : 180, color: c.text, maxWidth: safe.w, maxLines: 2, anim: an('elastic-in', 0.7, 'zoom-soft-out', 0.35) });
      const dot = 46;
      clips.push(
        live,
        makeShape('ellipse', { name: 'Live dot', start: tEnd + 0.3, duration: d - tEnd - 0.3, width: dot, height: dot, y: Math.round(live.transform.y - live.metrics.height / 2 - 70), fill: liveFill, anim: an('pop-in', 0.4, 'fade-out', 0.3, 'fade-pulse', 1.0) }),
        makeShape('ellipse', { name: 'Live halo', start: tEnd + 0.3, duration: d - tEnd - 0.3, width: dot * 2.2, height: dot * 2.2, y: Math.round(live.transform.y - live.metrics.height / 2 - 70), fill: '#00000000', stroke: { color: alpha(liveFill, 0.6), width: 4 }, anim: an('zoom-soft-in', 0.5, 'fade-out', 0.3, 'pulse', 1.0) }),
      );
      return clips;
    },
  },
];

export default templates;
