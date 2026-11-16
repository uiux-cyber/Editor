import { seededRandom } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  bell01,
  bevel,
  bez,
  bump,
  circle,
  darken,
  drawOn,
  ink,
  lgrad,
  lighten,
  mix,
  noShadow,
  poly,
  rgrad,
  rrect,
  sample,
  seg,
  shadow,
  sticker,
  strokePts,
  text,
  vgrad,
  wave,
  wobble,
  type Ctx,
} from './_lib/draw';

/** Irregular comic burst centred on the origin: alternating outer / inner points. */
function spikes(n: number, rx: number, ry: number, inner: number, jitter: number, seed: number): number[] {
  const rnd = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - PI / 2 + (rnd() - 0.5) * 0.07;
    const k = i % 2 === 0 ? 1 - jitter * rnd() : inner + jitter * 0.6 * rnd();
    out.push(Math.cos(a) * rx * k, Math.sin(a) * ry * k);
  }
  return out;
}

/** Puffy cloud outline (overlapping circles around an ellipse) centred on (cx, cy). */
function puff(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU;
    const rr = r + r * 0.16 * Math.sin(i * 2.4);
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, rr, 0, TAU);
  }
  ctx.moveTo(cx + rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
}

/** One opening quotation mark ("6" shape) centred near the origin. */
function quoteMark(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.moveTo(x + 0.44 * s, y + 0.28 * s);
  ctx.arc(x, y + 0.28 * s, 0.44 * s, 0, TAU);
  ctx.moveTo(x - 0.44 * s, y + 0.28 * s);
  ctx.bezierCurveTo(x - 0.44 * s, y - 0.36 * s, x - 0.12 * s, y - 0.78 * s, x + 0.4 * s, y - 0.9 * s);
  ctx.lineTo(x + 0.4 * s, y - 0.58 * s);
  ctx.bezierCurveTo(x + 0.16 * s, y - 0.5 * s, x, y - 0.34 * s, x - 0.02 * s, y - 0.12 * s);
  ctx.closePath();
}

const SHOUT = spikes(13, 148, 102, 0.7, 0.14, 7);
const WOW = spikes(12, 136, 98, 0.73, 0.12, 21);
const BOOM_OUT = spikes(16, 150, 108, 0.74, 0.16, 33);
const BOOM_IN = spikes(14, 112, 78, 0.76, 0.1, 44);

const HL_CIRCLE = wobble(
  sample(96, (u) => {
    const a = -2.3 + u * TAU * 1.08;
    const k = 1.04 - 0.09 * u;
    return [218 + Math.cos(a) * 184 * k, 128 + Math.sin(a) * 92 * k];
  }),
  3,
  5,
  12,
);
const UNDERLINE = wobble([...sample(40, bez(44, 112, 260, 82, 560, 90, 776, 104)), ...sample(34, bez(776, 104, 815, 130, 640, 146, 200, 164)).slice(2)], 2.5, 9, 12);
const HIGHLIGHT = wobble(
  sample(30, (u) => [56 + 810 * u, 134 - 8 * u]),
  2,
  3,
);

const stickers: StickerDef[] = [
  sticker({
    id: 'bubble-round',
    name: 'Speech Bubble',
    category: 'callouts',
    keywords: 'speech bubble talk say dialog comic chat balloon',
    aspect: 1.3,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, _p, env, c) => {
      const cx = env.w / 2;
      ctx.beginPath();
      ctx.ellipse(cx, 110, 142, 88, 0, 0, TAU);
      ctx.moveTo(86, 164);
      ctx.lineTo(152, 184);
      ctx.lineTo(56, 228);
      ctx.closePath();
      shadow(ctx, 12, 6);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 16;
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = vgrad(ctx, 22, 210, c[0], darken(c[0], 0.07));
      ctx.fill();
    },
  }),
  sticker({
    id: 'bubble-cloud',
    name: 'Cloud Bubble',
    category: 'callouts',
    keywords: 'speech bubble cloud fluffy talk dialog comic soft',
    aspect: 1.3,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, _p, env, c) => {
      const cx = env.w / 2;
      puff(ctx, cx, 108, 92, 44, 38);
      ctx.moveTo(98, 156);
      ctx.lineTo(156, 164);
      ctx.lineTo(60, 228);
      ctx.closePath();
      shadow(ctx, 12, 6);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 16;
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = vgrad(ctx, 16, 210, c[0], darken(c[0], 0.07));
      ctx.fill();
    },
  }),
  sticker({
    id: 'bubble-shout',
    name: 'Shout Bubble',
    category: 'callouts',
    keywords: 'shout burst bubble yell loud comic spiky scream',
    aspect: 1.3,
    colors: ['#ffffff', '#14161f', '#ffc531'],
    draw: (ctx, _p, env, c) => {
      ctx.translate(env.w / 2 - 3, 122);
      ctx.save();
      ctx.translate(8, 10);
      ctx.fillStyle = ctx.strokeStyle = c[2];
      ctx.lineWidth = 12;
      poly(ctx, SHOUT);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      poly(ctx, SHOUT);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.fillStyle = c[0];
      ctx.fill();
    },
  }),
  sticker({
    id: 'bubble-thought',
    name: 'Thought Bubble',
    category: 'callouts',
    keywords: 'thought bubble think idea dream wonder cloud hmm',
    aspect: 1.3,
    period: 2.4,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2 + 8;
      const dy = 3 * wave(p);
      const fill = vgrad(ctx, 16, 200, c[0], darken(c[0], 0.07));
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 16;
      puff(ctx, cx, 100 + dy, 90, 36, 34);
      shadow(ctx, 12, 6);
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = fill;
      ctx.fill();
      const dots = [
        [96, 198, 17],
        [62, 218, 12],
        [40, 233, 7],
      ];
      for (let i = 0; i < 3; i++) {
        const k = 0.72 + 0.28 * bell01(p - i * 0.16);
        circle(ctx, dots[i][0], dots[i][1], dots[i][2] * k);
        ctx.lineWidth = 14;
        ctx.stroke();
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'quote-marks',
    name: 'Quote Marks',
    category: 'callouts',
    keywords: 'quote quotation marks saying testimonial review words',
    aspect: 1.2,
    colors: ['#ff4f9a', '#ff8a00'],
    draw: (ctx, _p, env, c) => {
      const cx = env.w / 2;
      shadow(ctx, 12, 7, alpha(darken(c[0], 0.6), 0.35));
      ctx.fillStyle = lgrad(ctx, cx - 110, 40, cx + 110, 220, c[0], c[1]);
      ctx.beginPath();
      quoteMark(ctx, cx - 64, 136, 104);
      quoteMark(ctx, cx + 64, 136, 104);
      ctx.fill();
      noShadow(ctx);
    },
  }),
  sticker({
    id: 'circle-highlight',
    name: 'Hand-Drawn Circle',
    category: 'callouts',
    keywords: 'circle highlight hand drawn marker ring emphasis mark this',
    aspect: 1.7,
    period: 2.8,
    colors: ['#ff3b30', '#14161f'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      ink(ctx, HL_CIRCLE, f, c[0], 10, a, c[1]);
    },
  }),
  sticker({
    id: 'underline-scribble',
    name: 'Scribble Underline',
    category: 'callouts',
    keywords: 'underline scribble hand drawn marker emphasis line stroke',
    aspect: 3.2,
    period: 2.4,
    colors: ['#ffd60a', '#14161f'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      ink(ctx, UNDERLINE, f, c[0], 12, a, c[1]);
    },
  }),
  sticker({
    id: 'highlighter-stroke',
    name: 'Highlighter Stroke',
    category: 'callouts',
    keywords: 'highlighter marker stroke highlight text emphasis yellow swipe',
    aspect: 3.6,
    period: 2.6,
    colors: ['#fff34d', '#ffc800'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      if (f <= 0 || a <= 0) return;
      ctx.globalAlpha = 0.88 * a;
      ctx.transform(1, 0, -0.2, 1, 26, 0);
      ctx.lineCap = 'butt';
      ctx.lineWidth = 94;
      const edge = mix(c[0], c[1], 0.55);
      ctx.strokeStyle = vgrad(ctx, 82, 180, edge, c[0], c[0], c[0], edge);
      strokePts(ctx, HIGHLIGHT, f);
    },
  }),
  sticker({
    id: 'wow-burst',
    name: 'Wow Burst',
    category: 'callouts',
    keywords: 'wow amazing burst comic pop surprise omg reaction',
    aspect: 1.25,
    period: 1.6,
    colors: ['#ffd60a', '#ff3b5c', '#14161f'],
    draw: (ctx, p, env, c) => {
      ctx.translate(env.w / 2 - 3, 124);
      ctx.rotate(0.035 * wave(p));
      const s = 0.94 + 0.05 * bell01(p * 2);
      ctx.scale(s, s);
      ctx.save();
      ctx.translate(8, 10);
      ctx.fillStyle = ctx.strokeStyle = c[1];
      ctx.lineWidth = 12;
      poly(ctx, WOW);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      poly(ctx, WOW);
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.fillStyle = rgrad(ctx, 0, -6, 10, 140, lighten(c[0], 0.55), c[0]);
      ctx.fill();
      ctx.rotate(-0.1);
      text(ctx, 'WOW!', 5, 8, { size: 104, family: 'Bangers', weight: 400, maxW: 176, fill: c[2], stroke: c[2], strokeW: 16 });
      text(ctx, 'WOW!', 0, 2, { size: 104, family: 'Bangers', weight: 400, maxW: 176, fill: c[1], stroke: c[2], strokeW: 14 });
    },
  }),
  sticker({
    id: 'boom-burst',
    name: 'Boom Explosion',
    category: 'callouts',
    keywords: 'boom explosion bang comic blast pow impact burst',
    aspect: 1.3,
    period: 1.2,
    colors: ['#ff4d1a', '#ffd60a', '#14161f', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const k = bell01(p * 2);
      ctx.translate(env.w / 2 + 3 * Math.sin(p * TAU * 3), 128 + 2.5 * Math.cos(p * TAU * 4));
      const s = 0.93 + 0.06 * k;
      ctx.scale(s, s);
      poly(ctx, BOOM_OUT);
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.fillStyle = rgrad(ctx, 0, 0, 40, 150, mix(c[0], c[1], 0.5), c[0]);
      ctx.fill();
      ctx.save();
      ctx.rotate(0.05 * wave(p));
      ctx.scale(1 + 0.05 * k, 1 + 0.05 * k);
      poly(ctx, BOOM_IN);
      ctx.fillStyle = ctx.strokeStyle = rgrad(ctx, 0, 0, 10, 110, lighten(c[1], 0.6), c[1]);
      ctx.lineWidth = 5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.rotate(-0.08);
      text(ctx, 'BOOM!', 4, 8, { size: 92, family: 'Bangers', weight: 400, maxW: 176, fill: c[2], stroke: c[2], strokeW: 16 });
      text(ctx, 'BOOM!', 0, 2, { size: 92, family: 'Bangers', weight: 400, maxW: 176, fill: c[3], stroke: c[2], strokeW: 14 });
    },
  }),
  sticker({
    id: 'question-mark',
    name: 'Question Mark',
    category: 'callouts',
    keywords: 'question mark ask why what confused huh faq',
    aspect: 0.8,
    period: 1.8,
    colors: ['#7c5cff', '#ffffff'],
    draw: (ctx, p, env, c) => {
      ctx.translate(env.w / 2, 132 - 9 * Math.abs(Math.sin(p * TAU)));
      ctx.rotate(0.13 * wave(p));
      shadow(ctx, 12, 7);
      text(ctx, '?', 0, 0, { size: 214, weight: 900, fill: null, stroke: c[1], strokeW: 28 });
      noShadow(ctx);
      text(ctx, '?', 0, 0, { size: 214, weight: 900, fill: vgrad(ctx, -80, 80, lighten(c[0], 0.3), c[0], darken(c[0], 0.12)) });
    },
  }),
  sticker({
    id: 'exclamation-mark',
    name: 'Exclamation Mark',
    category: 'callouts',
    keywords: 'exclamation mark alert important attention warning wow',
    aspect: 0.6,
    period: 1.2,
    colors: ['#ff3b30', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const u = seg(p, 0, 0.62);
      ctx.translate(env.w / 2, 226);
      ctx.rotate(Math.sin(u * TAU * 2) * (1 - u) * 0.16);
      const s = 0.94 * (1 + 0.05 * bump(p, 0, 0.3));
      ctx.scale(s, s);
      ctx.translate(0, -98);
      const path = (): void => {
        ctx.beginPath();
        ctx.moveTo(-25, -92);
        ctx.quadraticCurveTo(0, -106, 25, -92);
        ctx.lineTo(13, 30);
        ctx.quadraticCurveTo(0, 40, -13, 30);
        ctx.closePath();
        ctx.moveTo(21, 78);
        ctx.arc(0, 78, 21, 0, TAU);
      };
      path();
      shadow(ctx, 12, 7);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 24;
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, -100, 100, lighten(c[0], 0.25), c[0], darken(c[0], 0.14));
      ctx.lineWidth = 6;
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'lower-third-bar',
    name: 'Lower Third Bar',
    category: 'callouts',
    keywords: 'lower third name bar title tag banner label caption',
    aspect: 3.8,
    colors: ['#14161f', '#ff3b5c', '#ffffff'],
    draw: (ctx, _p, env, c) => {
      const W = env.w;
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, 62, 146, lighten(c[0], 0.18), c[0]);
      rrect(ctx, 66, 62, W - 110, 84, 12);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = vgrad(ctx, 62, 196, lighten(c[1], 0.2), c[1], darken(c[1], 0.12));
      rrect(ctx, 30, 62, 24, 134, 8);
      ctx.fill();
      ctx.fillStyle = alpha(c[2], 0.94);
      rrect(ctx, 66, 154, (W - 110) * 0.6, 42, 10);
      ctx.fill();
      ctx.fillStyle = alpha(c[1], 0.9);
      rrect(ctx, W - 44 - 150, 100, 124, 8, 4);
      ctx.fill();
    },
  }),
  sticker({
    id: 'omg-bubble',
    name: 'OMG Bubble',
    category: 'callouts',
    keywords: 'omg oh my god shock surprise bubble reaction wow',
    aspect: 1.3,
    colors: ['#ff4f9a', '#ffffff'],
    draw: (ctx, _p, env, c) => {
      const W = env.w;
      ctx.translate(W / 2, 128);
      ctx.rotate(-0.07);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = lgrad(ctx, -120, -90, 120, 90, lighten(c[0], 0.2), c[0], darken(c[0], 0.1));
      ctx.beginPath();
      ctx.roundRect(-138, -92, 276, 150, 46);
      ctx.moveTo(40, 50);
      ctx.lineTo(104, 50);
      ctx.lineTo(96, 104);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      bevel(ctx, -138, -92, 276, 150, 46, 0.4);
      text(ctx, 'OMG!', 0, -16, { size: 92, maxW: 220, fill: c[1], weight: 900 });
    },
  }),
  sticker({
    id: 'look-label',
    name: 'Look Pointer Label',
    category: 'callouts',
    keywords: 'look here pointer label tag arrow attention see this',
    aspect: 2.3,
    period: 1,
    colors: ['#ffd60a', '#14161f'],
    draw: (ctx, p, env, c) => {
      const W = env.w;
      ctx.translate(-12 + 14 * Math.abs(Math.sin(p * PI)), 0);
      shadow(ctx, 12, 7);
      ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, 62, 194, lighten(c[0], 0.35), c[0], darken(c[0], 0.06));
      ctx.lineWidth = 18;
      poly(ctx, [42, 72, W - 150, 72, W - 54, 128, W - 150, 184, 42, 184]);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
      text(ctx, 'LOOK!', (42 + W - 126) / 2, 130, { size: 88, maxW: W - 250, fill: c[1], weight: 900, spacing: 0.03 });
    },
  }),
  sticker({
    id: 'censored-bar',
    name: 'Censored Bar',
    category: 'callouts',
    keywords: 'censored bar bleep hide block secret blur redacted',
    aspect: 2.6,
    colors: ['#0d0e14', '#ffffff'],
    draw: (ctx, _p, env, c) => {
      const bw = env.w - 76;
      ctx.translate(env.w / 2, 128);
      ctx.rotate(-0.045);
      shadow(ctx, 12, 6);
      ctx.fillStyle = vgrad(ctx, -56, 56, lighten(c[0], 0.14), c[0]);
      rrect(ctx, -bw / 2, -56, bw, 112, 10);
      ctx.fill();
      noShadow(ctx);
      text(ctx, 'CENSORED', 0, 2, { size: 76, maxW: bw - 70, fill: c[1], weight: 900, spacing: 0.1 });
    },
  }),
  sticker({
    id: 'bubble-message',
    name: 'Message Bubble',
    category: 'callouts',
    keywords: 'message bubble chat text sms blank dialog reply',
    aspect: 1.6,
    colors: ['#2f80ff', '#7cc4ff'],
    draw: (ctx, _p, env, c) => {
      const W = env.w;
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.38));
      ctx.fillStyle = lgrad(ctx, 30, 30, W - 30, 200, c[1], c[0]);
      ctx.beginPath();
      ctx.roundRect(26, 34, W - 52, 152, 44);
      ctx.moveTo(58, 150);
      ctx.lineTo(112, 180);
      ctx.bezierCurveTo(92, 206, 62, 224, 30, 230);
      ctx.bezierCurveTo(50, 208, 58, 184, 58, 150);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      bevel(ctx, 26, 34, W - 52, 152, 44, 0.4);
    },
  }),
  sticker({
    id: 'lol-pop',
    name: 'LOL Letters',
    category: 'callouts',
    keywords: 'lol laugh funny haha joke comic text reaction',
    aspect: 1.5,
    period: 1.2,
    colors: ['#ffd60a', '#ff4f9a', '#14161f'],
    draw: (ctx, p, env, c) => {
      const letters = ['L', 'O', 'L'];
      for (let i = 0; i < 3; i++) {
        const k = Math.max(0, wave(p, -i * 0.16));
        ctx.save();
        ctx.translate(env.w / 2 + (i - 1) * 104, 140 - 26 * k);
        ctx.rotate((i - 1) * 0.1 + 0.06 * k * (i - 1));
        const o = { size: 168, family: 'Bangers' as const, weight: 400, maxW: 110 };
        text(ctx, letters[i], 5, 8, { ...o, fill: c[2], stroke: c[2], strokeW: 20 });
        text(ctx, letters[i], 0, 0, { ...o, fill: vgrad(ctx, -70, 70, c[0], c[1]), stroke: c[2], strokeW: 18 });
        ctx.restore();
      }
    },
  }),
];

export default stickers;
