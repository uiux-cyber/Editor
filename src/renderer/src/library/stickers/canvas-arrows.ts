import { Ease, clamp01, smoothstep } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  bell01,
  bez,
  blockArrow,
  circle,
  darken,
  drawOn,
  headPts,
  hgrad,
  ink,
  lgrad,
  lighten,
  noShadow,
  poly,
  rrect,
  sample,
  seg,
  shaded,
  shadow,
  sticker,
  vgrad,
  wave,
  wobble,
} from './_lib/draw';

function bounceArrow(id: string, name: string, angle: number, keywords: string): StickerDef {
  return sticker({
    id,
    name,
    category: 'arrows',
    keywords,
    period: 1,
    colors: ['#ff3b5c', '#ff9a5c', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      // Recoil, then snap forward: a pointing "bounce" with the impact at the loop point.
      const d = 16 - 30 * Math.abs(Math.sin(p * PI));
      ctx.translate(128, 128);
      ctx.rotate(angle);
      ctx.translate(d, 0);
      blockArrow(ctx, 164, 60, 130, 78);
      shadow(ctx, 12, 6);
      ctx.lineWidth = 24;
      ctx.strokeStyle = c[2];
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = ctx.strokeStyle = hgrad(ctx, -82, 82, c[1], c[0]);
      ctx.lineWidth = 9;
      ctx.fill();
      ctx.stroke();
    },
  });
}

// Hand-drawn curved arrow.
const CURVE = wobble(sample(48, bez(46, 208, 30, 84, 170, 30, 282, 120)), 2.2, 11);
const CURVE_HEAD = headPts(282, 120, Math.atan2(90, 112), 58, 0.68);

// Hand-drawn arrow with a loop.
const LOOP = wobble(
  sample(84, (u) => {
    const g = smoothstep(0.18, 0.82, u);
    return [40 + 330 * u + 50 * Math.sin(TAU * g), 186 - 26 * u - 50 * (1 - Math.cos(TAU * g))];
  }),
  1.8,
  23,
);
const LOOP_END = LOOP.length - 2;
const LOOP_HEAD = headPts(LOOP[LOOP_END], LOOP[LOOP_END + 1], Math.atan2(LOOP[LOOP_END + 1] - LOOP[LOOP_END - 5], LOOP[LOOP_END] - LOOP[LOOP_END - 6]), 50);

// Tapered swoosh arrow outline.
const SWOOSH: number[] = (() => {
  const curve = bez(34, 206, 110, 72, 250, 46, 338, 112);
  const n = 36;
  const left: number[] = [];
  const right: number[] = [];
  let ex = 0;
  let ey = 0;
  let dx = 1;
  let dy = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const [x, y] = curve(u);
    const [x2, y2] = curve(Math.min(1, u + 0.01));
    const [x1, y1] = curve(Math.max(0, u - 0.01));
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    dx = (x2 - x1) / len;
    dy = (y2 - y1) / len;
    const hw = (3 + 42 * Math.pow(u, 0.9)) / 2;
    left.push(x - dy * hw, y + dx * hw);
    right.unshift(x + dy * hw, y - dx * hw);
    ex = x;
    ey = y;
  }
  // `right` is already in reverse point order (unshift keeps each x, y pair intact).
  const head = [ex - dy * 52, ey + dx * 52, ex + dx * 86, ey + dy * 86, ex + dy * 52, ey - dx * 52];
  return [...left, ...head, ...right];
})();

const stickers: StickerDef[] = [
  bounceArrow('arrow-bounce-right', 'Bouncing Arrow Right', 0, 'arrow right point next bounce direction here'),
  bounceArrow('arrow-bounce-left', 'Bouncing Arrow Left', PI, 'arrow left point back bounce direction here'),
  bounceArrow('arrow-bounce-up', 'Bouncing Arrow Up', -PI / 2, 'arrow up point above bounce direction top'),
  bounceArrow('arrow-bounce-down', 'Bouncing Arrow Down', PI / 2, 'arrow down point below bounce direction link description'),
  sticker({
    id: 'arrow-curved-sketch',
    name: 'Hand-Drawn Curved Arrow',
    category: 'arrows',
    keywords: 'arrow curved hand drawn sketch doodle point marker',
    aspect: 1.3,
    period: 2.6,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      ink(ctx, CURVE, clamp01(f / 0.72), c[0], 13, a, c[1]);
      ink(ctx, CURVE_HEAD, clamp01((f - 0.72) / 0.28), c[0], 13, a, c[1]);
    },
  }),
  sticker({
    id: 'chevrons-flow',
    name: 'Flowing Chevrons',
    category: 'arrows',
    keywords: 'chevrons arrows right next forward flow direction speed',
    aspect: 2.2,
    period: 1.1,
    colors: ['#ffc531', '#ff8a00'],
    draw: (ctx, p, env, c) => {
      const x0 = (env.w - 412) / 2;
      ctx.fillStyle = ctx.strokeStyle = hgrad(ctx, x0, x0 + 412, c[0], c[1]);
      ctx.lineWidth = 9;
      for (let i = 0; i < 4; i++) {
        const k = bell01(p + 0.5 - (i - 1.5) * 0.17);
        const x = x0 + i * 104 + 8 * k;
        ctx.globalAlpha = 0.42 + 0.58 * k * k;
        poly(ctx, [x, 58, x + 44, 58, x + 98, 128, x + 44, 198, x, 198, x + 54, 128]);
        ctx.fill();
        ctx.stroke();
      }
    },
  }),
  sticker({
    id: 'refresh-spin',
    name: 'Refresh Arrows',
    category: 'arrows',
    keywords: 'refresh reload sync loop repeat rotate update again',
    period: 1.6,
    colors: ['#22c55e', '#14b8a6'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      ctx.rotate(Ease.easeInOutCubic(p) * TAU);
      const R = 72;
      const paint = lgrad(ctx, -80, -80, 80, 80, lighten(c[0], 0.15), c[1]);
      ctx.strokeStyle = ctx.fillStyle = paint;
      for (let i = 0; i < 2; i++) {
        ctx.rotate(PI);
        ctx.lineWidth = 24;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, R, -2.55, -0.62);
        ctx.stroke();
        const e = -0.52;
        const px = Math.cos(e) * R;
        const py = Math.sin(e) * R;
        const tx = -Math.sin(e);
        const ty = Math.cos(e);
        ctx.lineWidth = 8;
        poly(ctx, [px + Math.cos(e) * 27, py + Math.sin(e) * 27, px - Math.cos(e) * 27, py - Math.sin(e) * 27, px + tx * 42, py + ty * 42]);
        ctx.fill();
        ctx.stroke();
      }
    },
  }),
  sticker({
    id: 'arrow-dash-trail',
    name: 'Dashed Trail Arrow',
    category: 'arrows',
    keywords: 'arrow dashed trail pointing right path route move',
    aspect: 2.4,
    period: 0.9,
    colors: ['#2f80ff', '#22d3ee'],
    draw: (ctx, p, env, c) => {
      const xe = env.w - 128;
      const nudge = 5 * wave(p);
      ctx.save();
      ctx.lineWidth = 18;
      ctx.setLineDash([22, 44]);
      ctx.lineDashOffset = -p * 66;
      ctx.strokeStyle = hgrad(ctx, 30, xe, alpha(c[1], 0), c[1], c[0]);
      ctx.beginPath();
      ctx.moveTo(34, 128);
      ctx.lineTo(xe - 6, 128);
      ctx.stroke();
      ctx.restore();
      ctx.translate(nudge, 0);
      shadow(ctx, 10, 5, alpha(darken(c[0], 0.6), 0.35));
      ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, 70, 186, lighten(c[0], 0.2), c[0]);
      ctx.lineWidth = 14;
      poly(ctx, [xe, 76, xe + 86, 128, xe, 180]);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'arrow-zigzag',
    name: 'Zig-Zag Arrow',
    category: 'arrows',
    keywords: 'arrow zigzag zig zag lightning down trend point',
    aspect: 1.5,
    colors: ['#ffc531', '#14161f'],
    draw: (ctx, _p, _env, c) => {
      const shaft = [44, 56, 146, 150, 192, 92, 287, 178];
      const head = [258, 212, 336, 220, 316, 144];
      shadow(ctx, 12, 7);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 46;
      poly(ctx, shaft, false);
      ctx.stroke();
      noShadow(ctx);
      ctx.lineWidth = 18;
      ctx.fillStyle = c[1];
      poly(ctx, head);
      ctx.fill();
      ctx.stroke();
      const paint = lgrad(ctx, 40, 50, 330, 220, lighten(c[0], 0.35), c[0], darken(c[0], 0.08));
      ctx.strokeStyle = ctx.fillStyle = paint;
      ctx.lineWidth = 28;
      poly(ctx, shaft, false);
      ctx.stroke();
      ctx.lineWidth = 2;
      poly(ctx, head);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'arrow-swoosh',
    name: 'Swoosh Arrow',
    category: 'arrows',
    keywords: 'arrow swoosh curve swing growth up point dynamic',
    aspect: 1.7,
    colors: ['#ff4f9a', '#ff8a00'],
    draw: (ctx, _p, _env, c) => {
      shadow(ctx, 12, 7, alpha(darken(c[0], 0.6), 0.35));
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, 30, 200, 420, 100, c[1], c[0]);
      ctx.lineWidth = 6;
      poly(ctx, SWOOSH);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'arrow-loop-sketch',
    name: 'Hand-Drawn Loop Arrow',
    category: 'arrows',
    keywords: 'arrow loop curly hand drawn sketch doodle swirl point',
    aspect: 1.8,
    period: 3,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      ink(ctx, LOOP, clamp01(f / 0.8), c[0], 12, a, c[1]);
      ink(ctx, LOOP_HEAD, clamp01((f - 0.8) / 0.2), c[0], 12, a, c[1]);
    },
  }),
  sticker({
    id: 'arrow-circle-next',
    name: 'Next Button',
    category: 'arrows',
    keywords: 'next arrow button circle continue forward go right',
    period: 1.8,
    colors: ['#14161f', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -94, 94, lighten(c[0], 0.2), c[0]);
      circle(ctx, 0, 0, 94);
      ctx.fill();
      noShadow(ctx);
      circle(ctx, 0, 0, 86);
      ctx.clip();
      const u = seg(p, 0.42, 0.95);
      const x = u < 0.5 ? Ease.easeInCubic(u * 2) * 170 : -170 * (1 - Ease.easeOutCubic((u - 0.5) * 2));
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(x - 42, 0);
      ctx.lineTo(x + 38, 0);
      ctx.moveTo(x + 8, -32);
      ctx.lineTo(x + 40, 0);
      ctx.lineTo(x + 8, 32);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'scroll-indicator',
    name: 'Scroll Down Mouse',
    category: 'arrows',
    keywords: 'scroll down mouse wheel more below indicator swipe',
    aspect: 0.7,
    period: 1.6,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      shaded(ctx, c[0], c[1], 9, () => rrect(ctx, cx - 42, 24, 84, 136, 42));
      const u = Ease.easeOutCubic(p);
      ctx.globalAlpha = Math.sin(p * PI);
      shaded(ctx, c[0], c[1], 11, () => {
        ctx.beginPath();
        ctx.moveTo(cx, 56 + 30 * u);
        ctx.lineTo(cx, 68 + 30 * u);
      });
      for (let i = 0; i < 2; i++) {
        const k = bell01(p - 0.25 - i * 0.2);
        ctx.globalAlpha = 0.25 + 0.75 * k;
        const y = 188 + i * 26;
        shaded(ctx, c[0], c[1], 9, () => {
          ctx.beginPath();
          ctx.moveTo(cx - 24, y);
          ctx.lineTo(cx, y + 18);
          ctx.lineTo(cx + 24, y);
        });
      }
    },
  }),
  sticker({
    id: 'arrow-u-turn',
    name: 'U-Turn Arrow',
    category: 'arrows',
    keywords: 'arrow u turn back return down reverse reply',
    colors: ['#2f80ff', '#7cc4ff'],
    draw: (ctx, _p, _env, c) => {
      ctx.translate(114, 124);
      const paint = lgrad(ctx, -70, 80, 80, -70, c[1], c[0]);
      shadow(ctx, 12, 7, alpha(darken(c[0], 0.6), 0.35));
      ctx.strokeStyle = paint;
      ctx.lineWidth = 36;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-58, 76);
      ctx.lineTo(-58, -10);
      ctx.arc(0, -10, 58, PI, 0);
      ctx.lineTo(58, 24);
      ctx.stroke();
      ctx.fillStyle = paint;
      ctx.lineWidth = 12;
      poly(ctx, [10, 26, 106, 26, 58, 88]);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'arrow-neon',
    name: 'Neon Arrow',
    category: 'arrows',
    keywords: 'arrow neon glow sign light right retro bar',
    aspect: 1.7,
    period: 2.4,
    colors: ['#22d3ee', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const flick = (p > 0.62 && p < 0.66) || (p > 0.7 && p < 0.725) ? 0.35 : 1;
      const glow = 0.85 + 0.15 * wave(p * 3);
      ctx.translate(env.w / 2, 128);
      ctx.globalAlpha = flick;
      blockArrow(ctx, 300, 62, 150, 96);
      shadow(ctx, 26 * glow, 0, c[0]);
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 13;
      ctx.stroke();
      noShadow(ctx);
      ctx.strokeStyle = lighten(c[0], 0.2);
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = alpha(c[1], 0.92);
      ctx.lineWidth = 4;
      ctx.stroke();
    },
  }),
];

export default stickers;
