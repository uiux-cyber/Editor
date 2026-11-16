import { Ease, clamp01, lerp } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  bell01,
  body,
  bump,
  circle,
  darken,
  drawOn,
  flame,
  fract,
  groundShadow,
  heart,
  hgrad,
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
  star,
  sticker,
  strokePts,
  text,
  vgrad,
  wave,
  type Ctx,
} from './_lib/draw';

const line = (x0: number, y0: number, x1: number, y1: number, n = 12): number[] => sample(n, (u) => [lerp(x0, x1, u), lerp(y0, y1, u)]);

const CHECK = [...line(-46, 4, -15, 35), ...line(-15, 35, 48, -31, 18).slice(2)];
const CROSS_A = line(-35, -35, 35, 35, 14);
const CROSS_B = line(35, -35, -35, 35, 14);

/** ECG trace across a 666 px wide box (aspect 2.6). */
const ECG: number[] = (() => {
  const keys = [
    [24, 0], [150, 0], [176, -16], [202, 0], [246, 0], [264, 14], [296, -92], [330, 74], [352, -10], [372, 0],
    [420, 0], [452, -26], [486, 0], [642, 0],
  ];
  const out: number[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [x0, y0] = keys[i];
    const [x1, y1] = keys[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 8));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) out.push(lerp(x0, x1, k / n), 132 + lerp(y0, y1, k / n));
  }
  return out;
})();

/** Stroke the part of a polyline between the fractions f0 and f1. */
function strokeRange(ctx: Ctx, pts: ArrayLike<number>, f0: number, f1: number): void {
  const n = pts.length / 2 - 1;
  const a = clamp01(f0) * n;
  const b = clamp01(f1) * n;
  if (b <= a) return;
  const at = (f: number): [number, number] => {
    const i = Math.min(n - 1, Math.floor(f));
    const u = f - i;
    return [lerp(pts[i * 2], pts[i * 2 + 2], u), lerp(pts[i * 2 + 1], pts[i * 2 + 3], u)];
  };
  ctx.beginPath();
  ctx.moveTo(...at(a));
  for (let i = Math.floor(a) + 1; i < b; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.lineTo(...at(b));
  ctx.stroke();
}

const stickers: StickerDef[] = [
  sticker({
    id: 'rec-indicator',
    name: 'Recording Indicator',
    category: 'animated',
    keywords: 'rec recording record camera live blink red dot',
    aspect: 2.4,
    period: 1.2,
    colors: ['#ff2d2d', '#ffffff', '#14161f'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 70;
      const bh = 120;
      const a = p < 0.5 ? 1 : p < 0.58 ? 1 - 0.82 * seg(p, 0.5, 0.58) : p < 0.92 ? 0.18 : 0.18 + 0.82 * seg(p, 0.92, 1);
      ctx.translate(env.w / 2, 128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = alpha(c[2], 0.86);
      rrect(ctx, -bw / 2, -bh / 2, bw, bh, 30);
      ctx.fill();
      noShadow(ctx);
      const dx = -bw / 2 + 78;
      ctx.fillStyle = rgrad(ctx, dx, 0, 16, 50, alpha(c[0], 0.55 * a), alpha(c[0], 0));
      circle(ctx, dx, 0, 50);
      ctx.fill();
      ctx.fillStyle = alpha(c[0], a);
      circle(ctx, dx, 0, 27);
      ctx.fill();
      text(ctx, 'REC', 56, 2, { size: 84, maxW: bw - 210, fill: c[1], spacing: 0.08 });
    },
  }),
  sticker({
    id: 'countdown-321',
    name: 'Countdown 3-2-1',
    category: 'animated',
    keywords: 'countdown 3 2 1 timer start intro count ready go',
    period: 3,
    colors: ['#14161f', '#ff3b5c', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const n = 3 - Math.min(2, Math.floor(p * 3));
      const u = fract(p * 3);
      ctx.translate(128, 128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -98, 98, lighten(c[0], 0.2), c[0]);
      circle(ctx, 0, 0, 98);
      ctx.fill();
      noShadow(ctx);
      ctx.lineWidth = 12;
      ctx.strokeStyle = alpha(c[2], 0.16);
      circle(ctx, 0, 0, 78);
      ctx.stroke();
      if (u > 0.002) {
        ctx.strokeStyle = c[1];
        ctx.beginPath();
        ctx.arc(0, 0, 78, -PI / 2, -PI / 2 + u * TAU);
        ctx.stroke();
      }
      const s = 1 + 0.4 * (1 - Ease.easeOutCubic(Math.min(1, u * 3.5)));
      ctx.scale(s, s);
      text(ctx, String(n), 0, 2, { size: 100, fill: c[2], weight: 900 });
    },
  }),
  sticker({
    id: 'coin-spin',
    name: 'Spinning Coin',
    category: 'animated',
    keywords: 'coin spin gold money reward points token cash prize',
    period: 1.8,
    colors: ['#ffc531', '#ff9d00', '#fff1a8'],
    draw: (ctx, p, _env, c) => {
      const th = p * TAU;
      const w = Math.abs(Math.cos(th));
      const R = 88;
      const e = 9 * Math.sin(th);
      const ae = Math.abs(e);
      const rx = Math.max(0.6, R * w);
      const fx = Math.cos(th) >= 0 ? e : -e;
      groundShadow(ctx, 128, 236, 24 + 46 * w, 7, 0.3);
      ctx.translate(128, 124);
      ctx.fillStyle = vgrad(ctx, -R, R, c[1], darken(c[1], 0.3));
      ctx.beginPath();
      ctx.ellipse(-ae, 0, rx, R, 0, 0, TAU);
      ctx.moveTo(ae + rx, 0);
      ctx.ellipse(ae, 0, rx, R, 0, 0, TAU);
      ctx.rect(-ae, -R, ae * 2, R * 2);
      ctx.fill();
      ctx.fillStyle = lgrad(ctx, fx - rx, -R, fx + rx, R, lighten(c[0], 0.45), c[0], c[1]);
      ctx.beginPath();
      ctx.ellipse(fx, 0, rx, R, 0, 0, TAU);
      ctx.fill();
      if (w > 0.1) {
        ctx.translate(fx, 0);
        ctx.scale(w, 1);
        ctx.strokeStyle = alpha(darken(c[1], 0.2), 0.7);
        ctx.lineWidth = 5;
        circle(ctx, 0, 0, 70);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle = c[2];
        ctx.lineWidth = 6;
        star(ctx, 0, 2, 5, 40, 17.5);
        ctx.fill();
        ctx.stroke();
      }
    },
  }),
  sticker({
    id: 'rocket-launch',
    name: 'Rocket Launch',
    category: 'animated',
    keywords: 'rocket launch space startup boost fast growth liftoff',
    aspect: 0.8,
    period: 0.8,
    colors: ['#f4f6fb', '#ff3b5c', '#ffb020', '#2f80ff'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      const xs = [-72, 70, -50, 54];
      ctx.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        const ph = fract(p + i / 4);
        const y = 24 + 190 * ph;
        ctx.strokeStyle = alpha(i % 2 === 0 ? c[0] : c[2], 0.75 * Math.sin(ph * PI));
        ctx.beginPath();
        ctx.moveTo(cx + xs[i], y);
        ctx.lineTo(cx + xs[i], y + 24);
        ctx.stroke();
      }
      ctx.translate(cx + 1.5 * Math.sin(p * TAU * 4), 104 + 3 * wave(p));
      ctx.scale(0.86, 0.86);
      const sway = 0.5 * wave(p * 2) + 0.3 * wave(p * 3, 0.2);
      ctx.save();
      ctx.translate(0, 88);
      ctx.scale(1, -1);
      ctx.fillStyle = vgrad(ctx, -44, 40, c[1], c[2]);
      flame(ctx, 0, 0, 40, sway, wave(p * 4));
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, -10, 40, c[2], lighten(c[2], 0.7));
      flame(ctx, 0, 14, 24, -sway, wave(p * 4, 0.3));
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = vgrad(ctx, 4, 56, c[1], darken(c[1], 0.2));
      poly(ctx, [-30, 6, -60, 56, -30, 44]);
      ctx.fill();
      poly(ctx, [30, 6, 60, 56, 30, 44]);
      ctx.fill();
      const hull = (): void => {
        ctx.beginPath();
        ctx.moveTo(0, -98);
        ctx.bezierCurveTo(26, -72, 32, -40, 32, -6);
        ctx.lineTo(32, 44);
        ctx.quadraticCurveTo(32, 50, 26, 50);
        ctx.lineTo(-26, 50);
        ctx.quadraticCurveTo(-32, 50, -32, 44);
        ctx.lineTo(-32, -6);
        ctx.bezierCurveTo(-32, -40, -26, -72, 0, -98);
        ctx.closePath();
      };
      hull();
      ctx.fillStyle = hgrad(ctx, -32, 32, '#ffffff', c[0], darken(c[0], 0.16));
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = hgrad(ctx, -32, 32, lighten(c[1], 0.2), c[1], darken(c[1], 0.14));
      ctx.fillRect(-40, -110, 80, 52);
      ctx.restore();
      ctx.fillStyle = darken(c[0], 0.3);
      circle(ctx, 0, -22, 19);
      ctx.fill();
      ctx.fillStyle = lgrad(ctx, -12, -34, 12, -10, lighten(c[3], 0.4), c[3]);
      circle(ctx, 0, -22, 13.5);
      ctx.fill();
      ctx.fillStyle = darken(c[1], 0.15);
      rrect(ctx, -5, 16, 10, 38, 5);
      ctx.fill();
      ctx.fillStyle = darken(c[0], 0.55);
      rrect(ctx, -18, 48, 36, 9, 3);
      ctx.fill();
    },
  }),
  sticker({
    id: 'lightbulb-idea',
    name: 'Idea Light Bulb',
    category: 'animated',
    keywords: 'idea light bulb tip hint think inspiration smart eureka',
    aspect: 0.9,
    period: 2,
    colors: ['#ffd60a', '#ffffff', '#5b6078'],
    draw: (ctx, p, env, c) => {
      const k = 0.5 + 0.5 * Math.cos(p * TAU);
      ctx.translate(env.w / 2, 114);
      ctx.fillStyle = rgrad(ctx, 0, -8, 40, 96, alpha(c[0], 0.5 * k), alpha(c[0], 0));
      circle(ctx, 0, -8, 96);
      ctx.fill();
      ctx.strokeStyle = alpha(c[0], k);
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = -PI / 2 + (i - 3) * 0.55;
        const r0 = 76;
        const r1 = 80 + 14 * k;
        ctx.moveTo(Math.cos(a) * r0, -8 + Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, -8 + Math.sin(a) * r1);
      }
      ctx.stroke();
      const g = ctx.createRadialGradient(-18, -30, 6, 0, -8, 72);
      g.addColorStop(0, lighten(c[0], 0.35 + 0.5 * k));
      g.addColorStop(1, mix(c[0], c[2], 0.26 * (1 - k)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -8, 60, 0, TAU);
      ctx.moveTo(-36, 34);
      ctx.lineTo(36, 34);
      ctx.lineTo(26, 70);
      ctx.lineTo(-26, 70);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = alpha(darken(c[0], 0.5), 0.75);
      ctx.lineWidth = 4.5;
      poly(ctx, [-15, 50, -10, 6, -3, 22, 3, 6, 10, 22, 15, 50], false);
      ctx.stroke();
      ctx.fillStyle = alpha(c[1], 0.55);
      ctx.beginPath();
      ctx.ellipse(-26, -32, 9, 18, 0.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 66, 100, lighten(c[2], 0.2), c[2]);
      rrect(ctx, -26, 66, 52, 34, 8);
      ctx.fill();
      ctx.strokeStyle = alpha(c[1], 0.4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-22, 78);
      ctx.lineTo(22, 78);
      ctx.moveTo(-22, 89);
      ctx.lineTo(22, 89);
      ctx.stroke();
      ctx.fillStyle = darken(c[2], 0.35);
      rrect(ctx, -12, 98, 24, 12, 6);
      ctx.fill();
    },
  }),
  sticker({
    id: 'googly-eyes',
    name: 'Googly Eyes',
    category: 'animated',
    keywords: 'eyes googly look watching funny stare see silly peek',
    aspect: 1.8,
    period: 3,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, env, c) => {
      const open = 1 - 0.93 * bump(p, 0.46, 0.56);
      const lx = 30 * Math.sin(p * TAU);
      const ly = 12 * Math.sin(p * TAU * 2 + 0.6);
      for (const s of [-1, 1]) {
        const ex = env.w / 2 + s * 92;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ex, 128, 76, 96 * open, 0, 0, TAU);
        shadow(ctx, 12, 6);
        ctx.strokeStyle = c[1];
        ctx.lineWidth = 16;
        ctx.stroke();
        noShadow(ctx);
        ctx.fillStyle = vgrad(ctx, 32, 224, c[0], darken(c[0], 0.1));
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = c[1];
        circle(ctx, ex + lx, 142 + ly, 37);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        circle(ctx, ex + lx - 13, 128 + ly, 11);
        ctx.fill();
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'target-lock',
    name: 'Target Lock',
    category: 'animated',
    keywords: 'target lock crosshair aim focus scope track sniper',
    period: 2,
    colors: ['#ff3b30', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const k = bell01(p * 2);
      ctx.translate(128, 128);
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 9;
      const d = 102 - 12 * k;
      ctx.beginPath();
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.moveTo(sx * d, sy * (d - 32));
          ctx.lineTo(sx * d, sy * d);
          ctx.lineTo(sx * (d - 32), sy * d);
        }
      }
      ctx.stroke();
      ctx.save();
      ctx.rotate((p * TAU) / 4);
      ctx.lineWidth = 7;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 62, (i * PI) / 2 + 0.28, ((i + 1) * PI) / 2 - 0.28);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 9;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * PI) / 2;
        ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
        ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
      }
      ctx.stroke();
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = c[0];
      circle(ctx, 0, 0, 10 + 2.5 * k);
      ctx.fill();
      ctx.fillStyle = c[1];
      circle(ctx, 0, 0, 4);
      ctx.fill();
    },
  }),
  sticker({
    id: 'check-circle',
    name: 'Animated Check Mark',
    category: 'animated',
    keywords: 'check tick yes done correct success approved complete',
    period: 2.4,
    colors: ['#22c55e', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      const s = 1 + 0.06 * bump(p, 0.46, 0.72);
      ctx.translate(128, 128);
      ctx.scale(s, s);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -98, 98);
      circle(ctx, 0, 0, 98);
      ctx.fill();
      noShadow(ctx);
      ctx.globalAlpha = a;
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 24;
      strokePts(ctx, CHECK, f);
    },
  }),
  sticker({
    id: 'cross-circle',
    name: 'Animated Cross Mark',
    category: 'animated',
    keywords: 'cross x no wrong error cancel fail denied close',
    period: 2.4,
    colors: ['#ff3b30', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const [f, a] = drawOn(p);
      const s = 1 + 0.06 * bump(p, 0.46, 0.72);
      ctx.translate(128, 128);
      ctx.scale(s, s);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -98, 98);
      circle(ctx, 0, 0, 98);
      ctx.fill();
      noShadow(ctx);
      ctx.globalAlpha = a;
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 24;
      strokePts(ctx, CROSS_A, clamp01(f * 2));
      strokePts(ctx, CROSS_B, clamp01(f * 2 - 1));
    },
  }),
  sticker({
    id: 'zzz-sleep',
    name: 'Sleepy Zzz',
    category: 'animated',
    keywords: 'zzz sleep sleepy tired boring snore nap night',
    period: 2.4,
    colors: ['#7cc4ff', '#ffffff', '#2f6fd6'],
    draw: (ctx, p, _env, c) => {
      for (let i = 0; i < 3; i++) {
        const ph = fract(p + i / 3);
        const size = 36 + 62 * ph;
        ctx.save();
        ctx.translate(62 + 116 * ph, 204 - 144 * ph);
        ctx.rotate(-0.12 + 0.18 * Math.sin(TAU * ph));
        ctx.globalAlpha = Math.pow(Math.sin(ph * PI), 0.7);
        text(ctx, 'Z', 0, 0, { size, weight: 900, fill: vgrad(ctx, -size * 0.4, size * 0.4, c[0], c[2]), stroke: c[1], strokeW: size * 0.2 });
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'stopwatch-tick',
    name: 'Ticking Stopwatch',
    category: 'animated',
    keywords: 'stopwatch timer time clock speed fast race seconds',
    aspect: 0.9,
    period: 4,
    colors: ['#ffffff', '#14161f', '#ff3b5c'],
    draw: (ctx, p, env, c) => {
      ctx.translate(env.w / 2, 142);
      ctx.fillStyle = c[1];
      rrect(ctx, -13, -114, 26, 30, 5);
      ctx.fill();
      rrect(ctx, -24, -126, 48, 16, 7);
      ctx.fill();
      ctx.save();
      ctx.rotate(0.72);
      rrect(ctx, -9, -106, 18, 24, 5);
      ctx.fill();
      ctx.restore();
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -88, 88, lighten(c[1], 0.22), c[1]);
      circle(ctx, 0, 0, 88);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = vgrad(ctx, -72, 72, c[0], darken(c[0], 0.1));
      circle(ctx, 0, 0, 72);
      ctx.fill();
      ctx.strokeStyle = alpha(c[1], 0.75);
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12;
        const r0 = i % 3 === 0 ? 50 : 56;
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * 63, Math.sin(a) * 63);
      }
      ctx.lineWidth = 5;
      ctx.stroke();
      const steps = 8;
      const a = ((Math.floor(p * steps) + Ease.easeOutBack(Math.min(1, fract(p * steps) * 2.5))) / steps) * TAU - PI / 2;
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * 14, -Math.sin(a) * 14);
      ctx.lineTo(Math.cos(a) * 54, Math.sin(a) * 54);
      ctx.stroke();
      ctx.fillStyle = c[2];
      circle(ctx, 0, 0, 10);
      ctx.fill();
      ctx.fillStyle = c[0];
      circle(ctx, 0, 0, 3.5);
      ctx.fill();
    },
  }),
  sticker({
    id: 'neon-heart',
    name: 'Neon Heart',
    category: 'animated',
    keywords: 'neon heart love glow sign light retro night valentine',
    period: 2.4,
    colors: ['#ff2d95', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const flick = (p > 0.56 && p < 0.6) || (p > 0.64 && p < 0.665) ? 0.35 : 1;
      const glow = 0.85 + 0.15 * wave(p * 3);
      ctx.globalAlpha = flick;
      heart(ctx, 128, 132, 86);
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
  sticker({
    id: 'alert-warning',
    name: 'Warning Sign',
    category: 'animated',
    keywords: 'warning alert caution danger attention sign important careful',
    aspect: 1.1,
    period: 1.2,
    colors: ['#ffc531', '#14161f'],
    draw: (ctx, p, env, c) => {
      const k = bell01(p);
      ctx.translate(env.w / 2, 136);
      ctx.scale(1 + 0.04 * k, 1 + 0.04 * k);
      const tri = [0, -92, 104, 78, -104, 78];
      poly(ctx, tri);
      shadow(ctx, 12, 7);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 36;
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, -100, 86, lighten(c[0], 0.3 + 0.4 * k), mix(c[0], '#ffffff', 0.3 * k));
      ctx.lineWidth = 16;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c[1];
      ctx.beginPath();
      ctx.moveTo(-13, -40);
      ctx.quadraticCurveTo(0, -50, 13, -40);
      ctx.lineTo(7, 22);
      ctx.quadraticCurveTo(0, 28, -7, 22);
      ctx.closePath();
      ctx.moveTo(12, 50);
      ctx.arc(0, 50, 12, 0, TAU);
      ctx.fill();
    },
  }),
  sticker({
    id: 'loading-dots',
    name: 'Loading Dots',
    category: 'animated',
    keywords: 'loading dots wait typing thinking progress ellipsis',
    aspect: 2,
    period: 1.2,
    colors: ['#7c5cff', '#22d3ee'],
    draw: (ctx, p, env, c) => {
      for (let i = 0; i < 3; i++) {
        const k = bell01(p - i * 0.18 + 0.2);
        const col = mix(c[0], c[1], i / 2);
        const x = env.w / 2 + (i - 1) * 132;
        const r = 34 + 22 * k;
        ctx.globalAlpha = 0.55 + 0.45 * k;
        ctx.fillStyle = lgrad(ctx, x - r, 128 - r, x + r, 128 + r, lighten(col, 0.3), col, darken(col, 0.12));
        circle(ctx, x, 128 - 14 * k, r);
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'progress-bar',
    name: 'Progress Bar',
    category: 'animated',
    keywords: 'progress bar loading percent download upload status fill',
    aspect: 3.4,
    period: 3.2,
    colors: ['#22c55e', '#14161f', '#ffffff'],
    draw: (ctx, p, env, c) => {
      // Offset so the poster frame (p = 0) shows a well-filled bar.
      const q = fract(p + 0.55);
      const f = Ease.easeInOut(seg(q, 0, 0.72));
      const a = q > 0.92 ? 1 - seg(q, 0.92, 1) : 1;
      const W = env.w;
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, 90, 166, lighten(c[1], 0.2), c[1]);
      rrect(ctx, 30, 90, W - 60, 76, 38);
      ctx.fill();
      noShadow(ctx);
      const full = W - 80;
      const w = Math.max(56, full * f);
      ctx.save();
      ctx.globalAlpha = a;
      rrect(ctx, 40, 100, w, 56, 28);
      ctx.fillStyle = vgrad(ctx, 100, 156, lighten(c[0], 0.25), c[0], darken(c[0], 0.12));
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      const shift = fract(p * 4) * 56;
      for (let x = -40 + shift; x < w + 60; x += 56) {
        ctx.moveTo(40 + x, 156);
        ctx.lineTo(40 + x + 24, 156);
        ctx.lineTo(40 + x + 52, 100);
        ctx.lineTo(40 + x + 28, 100);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
      text(ctx, `${Math.round(f * 100)}%`, W - 104, 129, { size: 36, fill: alpha(c[2], a), weight: 800 });
    },
  }),
  sticker({
    id: 'heartbeat-line',
    name: 'Heartbeat Line',
    category: 'animated',
    keywords: 'heartbeat pulse ecg heart rate health fitness alive monitor',
    aspect: 2.6,
    period: 1.6,
    colors: ['#ff3b5c', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const u = fract(p + 0.5) * 1.34 - 0.02;
      ctx.lineWidth = 9;
      ctx.strokeStyle = alpha(c[0], 0.38);
      strokePts(ctx, ECG, 1);
      shadow(ctx, 14, 0, alpha(c[0], 0.9));
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 10;
      strokeRange(ctx, ECG, u - 0.3, u);
      noShadow(ctx);
      if (u > 0 && u < 1) {
        const n = ECG.length / 2 - 1;
        const i = Math.min(n - 1, Math.floor(u * n));
        const t = u * n - i;
        const x = lerp(ECG[i * 2], ECG[i * 2 + 2], t);
        const y = lerp(ECG[i * 2 + 1], ECG[i * 2 + 3], t);
        ctx.fillStyle = rgrad(ctx, x, y, 4, 26, alpha(c[0], 0.6), alpha(c[0], 0));
        circle(ctx, x, y, 26);
        ctx.fill();
        ctx.fillStyle = c[1];
        circle(ctx, x, y, 8);
        ctx.fill();
      }
    },
  }),
];

export default stickers;
