import { Ease, lerp, seededRandom } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  bell01,
  bolt,
  bump,
  circle,
  cloud,
  darken,
  flame,
  fract,
  heart,
  hgrad,
  lgrad,
  lighten,
  mix,
  noShadow,
  poly,
  rgrad,
  shadow,
  sparkle,
  star,
  sticker,
  vgrad,
  wave,
  type Ctx,
  type Paint,
} from './_lib/draw';

/** Seeded particle parameters; `o` spreads the life-cycle offsets evenly so loops stay populated. */
interface Mote {
  x: number;
  y: number;
  s: number;
  o: number;
  q: number;
  k: number;
}
function motes(n: number, seed: number): Mote[] {
  const r = seededRandom(seed);
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r(), y: r(), s: r(), o: (i + r() * 0.6) / n, q: r(), k: r() });
  return out;
}

const HEARTS = motes(7, 101);
const BUBBLES = motes(9, 202);
const EMBERS = motes(6, 303);
const BOKEH = motes(13, 404);
const NOTES = motes(5, 505);
const FLAKES = motes(9, 606);
const LEAVES = motes(7, 707);
const TRAIL = motes(6, 808);

/** Four alternating sets of focus-line wedges: [angle, half width, inner radius factor]. */
const SPEED: number[][] = [0, 1, 2, 3].map((f) => {
  const r = seededRandom(900 + f * 17);
  const out: number[] = [];
  const n = 42;
  for (let i = 0; i < n; i++) out.push(((i + r() * 0.8) / n) * TAU, 0.012 + r() * 0.022, 0.5 + r() * 0.3);
  return out;
});

function note(ctx: Ctx, x: number, y: number, s: number, beamed: boolean, color: Paint): void {
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = 0.15 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(x, y, 0.36 * s, 0.27 * s, -0.35, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 0.3 * s, y - 0.06 * s);
  ctx.lineTo(x + 0.3 * s, y - 1.25 * s);
  if (beamed) {
    ctx.moveTo(x + 1.2 * s, y - 0.26 * s);
    ctx.lineTo(x + 1.2 * s, y - 1.45 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + 0.9 * s, y - 0.2 * s, 0.36 * s, 0.27 * s, -0.35, 0, TAU);
    ctx.fill();
    poly(ctx, [x + 0.3 * s, y - 1.25 * s, x + 1.2 * s, y - 1.45 * s, x + 1.2 * s, y - 1.15 * s, x + 0.3 * s, y - 0.95 * s]);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.bezierCurveTo(x + 0.42 * s, y - 0.9 * s, x + 0.9 * s, y - 0.88 * s, x + 0.72 * s, y - 0.42 * s);
    ctx.stroke();
  }
}

function flake(ctx: Ctx, R: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * R, cy * R);
    for (const d of [-1, 1]) {
      const b = a + d * 0.95;
      ctx.moveTo(cx * R * 0.56, cy * R * 0.56);
      ctx.lineTo(cx * R * 0.56 + Math.cos(b) * R * 0.34, cy * R * 0.56 + Math.sin(b) * R * 0.34);
    }
  }
  ctx.stroke();
}

/** Crescent: circle (cx, cy, R) minus circle (cx + ox, cy + oy, r). */
function crescent(ctx: Ctx, cx: number, cy: number, R: number, ox: number, oy: number, r: number): void {
  const d = Math.hypot(ox, oy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const ux = ox / d;
  const uy = oy / d;
  const x1 = a * ux - h * uy;
  const y1 = a * uy + h * ux;
  const x2 = a * ux + h * uy;
  const y2 = a * uy - h * ux;
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.atan2(y1, x1), Math.atan2(y2, x2));
  ctx.arc(cx + ox, cy + oy, r, Math.atan2(y2 - oy, x2 - ox), Math.atan2(y1 - oy, x1 - ox), true);
  ctx.closePath();
}

const stickers: StickerDef[] = [
  sticker({
    id: 'sparkles-twinkle',
    name: 'Twinkling Sparkles',
    category: 'decor',
    keywords: 'sparkles twinkle shine glitter stars magic clean new',
    period: 2,
    colors: ['#ffffff', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      const pts = [
        [124, 124, 70, 0],
        [56, 58, 30, 0.35],
        [202, 66, 26, 0.62],
        [62, 196, 22, 0.82],
        [194, 190, 38, 0.18],
      ];
      for (const [x, y, R, o] of pts) {
        const k = 0.62 + 0.38 * wave(p, o);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(0.22 * wave(p, o + 0.25));
        ctx.fillStyle = rgrad(ctx, 0, 0, 0, R * k, c[0], c[0], mix(c[0], c[1], 0.75));
        ctx.strokeStyle = alpha(c[1], 0.55);
        ctx.lineWidth = 2;
        sparkle(ctx, 0, 0, R * k, 0.17);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'shine-glint',
    name: 'Shine Glint',
    category: 'decor',
    keywords: 'shine glint flare light gleam bling sparkle lens',
    period: 2.4,
    colors: ['#ffffff', '#ffe08a'],
    draw: (ctx, p, _env, c) => {
      const k = 0.62 + 0.38 * bell01(p);
      ctx.translate(128, 128);
      ctx.fillStyle = rgrad(ctx, 0, 0, 0, 86 * k, alpha(c[1], 0.75), alpha(c[1], 0.22), alpha(c[1], 0));
      circle(ctx, 0, 0, 86 * k);
      ctx.fill();
      ctx.rotate(0.28 * wave(p));
      ctx.fillStyle = c[0];
      ctx.strokeStyle = alpha(c[1], 0.7);
      ctx.lineWidth = 2;
      ctx.save();
      ctx.rotate(PI / 4);
      sparkle(ctx, 0, 0, 56 * k, 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      sparkle(ctx, 0, 0, 116 * k, 0.07);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rgrad(ctx, 0, 0, 0, 22, '#ffffff', alpha(c[0], 0));
      circle(ctx, 0, 0, 22);
      ctx.fill();
    },
  }),
  sticker({
    id: 'floating-hearts',
    name: 'Floating Hearts',
    category: 'decor',
    keywords: 'hearts floating love like rising romance valentine react',
    aspect: 0.8,
    period: 3,
    colors: ['#ff3b6b', '#ff8aa8'],
    draw: (ctx, p, env, c) => {
      for (const m of HEARTS) {
        const ph = fract(p + m.o);
        const size = (15 + 19 * m.s) * (0.5 + 0.5 * Math.min(1, ph * 3));
        const x = 54 + m.x * (env.w - 108) + 9 * Math.sin(TAU * (ph * 1.5 + m.q));
        const y = 224 - 184 * ph;
        const col = m.k > 0.5 ? c[0] : c[1];
        ctx.globalAlpha = Math.pow(Math.sin(ph * PI), 0.6);
        ctx.fillStyle = vgrad(ctx, y - size, y + size, lighten(col, 0.28), col);
        heart(ctx, x, y, size);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.ellipse(x - size * 0.48, y - size * 0.5, size * 0.2, size * 0.12, -0.6, 0, TAU);
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'rising-bubbles',
    name: 'Rising Bubbles',
    category: 'decor',
    keywords: 'bubbles rising water soda fizz underwater soap float',
    aspect: 0.8,
    period: 4,
    colors: ['#7fdcff', '#ffffff'],
    draw: (ctx, p, env, c) => {
      for (const m of BUBBLES) {
        const ph = fract(p + m.o);
        const r = (8 + 15 * m.s) * (ph > 0.9 ? 1 + (ph - 0.9) * 3 : 1);
        const x = 34 + m.x * (env.w - 68) + 9 * Math.sin(TAU * (ph * 2 + m.q));
        const y = 228 - 196 * ph;
        ctx.globalAlpha = Math.min(1, ph * 6) * (ph > 0.9 ? (1 - ph) / 0.1 : 1);
        ctx.fillStyle = rgrad(ctx, x, y, r * 0.2, r, alpha(c[0], 0.1), alpha(c[0], 0.42));
        circle(ctx, x, y, r);
        ctx.fill();
        ctx.strokeStyle = alpha(c[0], 0.95);
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = alpha(c[1], 0.9);
        ctx.lineWidth = Math.max(1.5, r * 0.16);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.62, -2.5, -1.55);
        ctx.stroke();
      }
    },
  }),
  sticker({
    id: 'fire-flicker',
    name: 'Flickering Fire',
    category: 'decor',
    keywords: 'fire flame burn hot lit campfire blaze heat',
    aspect: 0.85,
    period: 1.2,
    colors: ['#ff3d1a', '#ff9d00', '#ffe27a'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      for (const m of EMBERS) {
        const ph = fract(p + m.o);
        ctx.globalAlpha = Math.sin(ph * PI) * 0.9;
        ctx.fillStyle = mix(c[1], c[2], m.k);
        circle(ctx, cx + (m.x - 0.5) * 120 + 10 * Math.sin(TAU * (ph + m.q)), 120 - 96 * ph, 2 + 3 * m.s);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const s1 = 0.55 * wave(p) + 0.3 * wave(p * 2, 0.2);
      ctx.fillStyle = vgrad(ctx, 40, 240, mix(c[0], c[1], 0.5), c[0], darken(c[0], 0.1));
      flame(ctx, cx, 138, 100, s1, wave(p * 2));
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 96, 240, lighten(c[1], 0.15), c[1]);
      flame(ctx, cx + 2, 168, 70, 0.5 * wave(p, 0.3) + 0.3 * wave(p * 3, 0.1), wave(p * 2, 0.35));
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 150, 240, lighten(c[2], 0.5), c[2]);
      flame(ctx, cx - 1, 196, 42, 0.6 * wave(p, 0.6) + 0.25 * wave(p * 2, 0.5), wave(p * 3, 0.2));
      ctx.fill();
    },
  }),
  sticker({
    id: 'equalizer-bars',
    name: 'Equalizer Bars',
    category: 'decor',
    keywords: 'equalizer music audio bars sound beat spectrum volume',
    aspect: 1.2,
    period: 1.6,
    colors: ['#22d3ee', '#7c5cff'],
    draw: (ctx, p, env, c) => {
      const n = 7;
      const bw = 27;
      const gap = 11;
      const x0 = (env.w - (n * bw + (n - 1) * gap)) / 2;
      ctx.fillStyle = vgrad(ctx, 34, 226, c[1], c[0]);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = 0.5 + 0.5 * Math.sin(TAU * (p * (1 + (i % 3)) + i * 0.37));
        const b = 0.5 + 0.5 * Math.sin(TAU * (p * (2 - (i % 2)) + i * 0.61));
        const h = 34 + 158 * (0.15 + 0.85 * a * (0.45 + 0.55 * b));
        ctx.roundRect(x0 + i * (bw + gap), 226 - h, bw, h, bw / 2);
      }
      ctx.fill();
    },
  }),
  sticker({
    id: 'sound-wave',
    name: 'Sound Wave',
    category: 'decor',
    keywords: 'sound wave audio voice waveform podcast music speaking',
    aspect: 2.6,
    period: 2,
    colors: ['#ff4f9a', '#7c5cff'],
    draw: (ctx, p, env, c) => {
      const n = 31;
      const step = (env.w - 60) / (n - 1);
      ctx.strokeStyle = hgrad(ctx, 30, env.w - 30, c[0], c[1]);
      ctx.lineWidth = 10;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const e = Math.pow(Math.sin((PI * (i + 0.5)) / n), 0.8);
        const a = 0.5 + 0.5 * Math.sin(TAU * (p - i * 0.07));
        const b = 0.5 + 0.5 * Math.sin(TAU * (p * 2 + i * 0.19));
        const h = 6 + 92 * e * (0.2 + 0.8 * a * (0.4 + 0.6 * b));
        const x = 30 + i * step;
        ctx.moveTo(x, 128 - h);
        ctx.lineTo(x, 128 + h);
      }
      ctx.stroke();
    },
  }),
  sticker({
    id: 'loading-spinner',
    name: 'Loading Spinner',
    category: 'decor',
    keywords: 'loading spinner wait buffering progress load circle',
    period: 1,
    colors: ['#ffffff', '#14161f'],
    draw: (ctx, p, _env, c) => {
      const a = p * TAU - PI / 2;
      ctx.translate(128, 128);
      ctx.lineWidth = 22;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = alpha(c[1], 0.28);
      circle(ctx, 0, 0, 80);
      ctx.stroke();
      const g = ctx.createConicGradient(a, 0, 0);
      g.addColorStop(0, alpha(c[0], 0));
      g.addColorStop(0.25, alpha(c[0], 0));
      g.addColorStop(1, c[0]);
      ctx.strokeStyle = g;
      ctx.stroke();
      ctx.fillStyle = c[0];
      circle(ctx, Math.cos(a) * 80, Math.sin(a) * 80, 11);
      ctx.fill();
    },
  }),
  sticker({
    id: 'pulse-rings',
    name: 'Pulse Rings',
    category: 'decor',
    keywords: 'pulse rings radar ping location signal beacon here',
    period: 2,
    colors: ['#22d3ee', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      for (let i = 0; i < 3; i++) {
        const ph = fract(p + i / 3);
        ctx.strokeStyle = alpha(c[0], 0.9 * Math.pow(1 - ph, 1.4));
        ctx.lineWidth = 3 + 7 * (1 - ph);
        circle(ctx, 0, 0, 12 + 100 * Ease.easeOut(ph));
        ctx.stroke();
      }
      ctx.fillStyle = rgrad(ctx, 0, 0, 0, 34, alpha(c[0], 0.55), alpha(c[0], 0));
      circle(ctx, 0, 0, 34);
      ctx.fill();
      ctx.fillStyle = c[0];
      circle(ctx, 0, 0, 19 + 2 * wave(p * 3));
      ctx.fill();
      ctx.fillStyle = c[1];
      circle(ctx, 0, 0, 8);
      ctx.fill();
    },
  }),
  sticker({
    id: 'bokeh-dots',
    name: 'Bokeh Lights',
    category: 'decor',
    keywords: 'bokeh lights dots blur glow soft dreamy overlay',
    aspect: 1.5,
    period: 6,
    colors: ['#ffd9a0', '#ff9ecb', '#9be7ff'],
    draw: (ctx, p, env, c) => {
      for (const m of BOKEH) {
        const r = 20 + 30 * m.s;
        const x = 60 + m.x * (env.w - 120) + 10 * Math.sin(TAU * (p + m.q));
        const y = 62 + m.y * 132 + 8 * Math.cos(TAU * (p + m.o));
        const col = c[Math.floor(m.k * 3) % 3];
        const a = 0.3 + 0.4 * bell01(p + m.o);
        ctx.fillStyle = rgrad(ctx, x, y, 0, r, alpha(col, a * 0.75), alpha(col, a * 0.6), alpha(col, a * 0.85), alpha(col, 0));
        circle(ctx, x, y, r);
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'lightning-flash',
    name: 'Lightning Bolt',
    category: 'decor',
    keywords: 'lightning bolt flash thunder energy power electric zap',
    aspect: 0.8,
    period: 1.5,
    colors: ['#ffe14d', '#ff9d00'],
    draw: (ctx, p, env, c) => {
      const f = Math.max(bump(p, 0.1, 0.2), 0.7 * bump(p, 0.26, 0.42));
      ctx.translate(env.w / 2, 128);
      ctx.scale(1 + 0.05 * f, 1 + 0.05 * f);
      shadow(ctx, 8 + 20 * f, 0, alpha(c[0], 0.55 + 0.45 * f));
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -40, -100, 40, 100, lighten(c[0], 0.3 + 0.6 * f), mix(c[0], '#ffffff', 0.7 * f), mix(c[1], '#ffffff', 0.6 * f));
      ctx.lineWidth = 8;
      bolt(ctx, 0, 0, 100);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'sun-rays-spin',
    name: 'Spinning Sun',
    category: 'decor',
    keywords: 'sun rays sunny summer weather bright day shine',
    period: 4,
    colors: ['#ffc531', '#ff9d00'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      ctx.save();
      ctx.strokeStyle = lgrad(ctx, -100, -100, 100, 100, c[0], c[1]);
      ctx.lineWidth = 15;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        // Two rays (one long, one short) per loop; the turn is baked in so the shading stays put.
        const a = (i * TAU) / 12 + (p * TAU) / 6;
        const long = i % 2 === 0;
        const r1 = (long ? 104 : 92) + (long ? 5 : -5) * wave(p * 2);
        ctx.moveTo(Math.cos(a) * 74, Math.sin(a) * 74);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = lgrad(ctx, -40, -50, 40, 50, lighten(c[0], 0.45), c[0], c[1]);
      circle(ctx, 0, 0, 56);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(-20, -24, 16, 9, -0.7, 0, TAU);
      ctx.fill();
    },
  }),
  sticker({
    id: 'moon-stars',
    name: 'Moon And Stars',
    category: 'decor',
    keywords: 'moon stars night sleep dream crescent sky goodnight',
    period: 3,
    colors: ['#ffe9a8', '#ffc531', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const stars = [
        [190, 60, 22, 0],
        [214, 132, 14, 0.4],
        [160, 112, 10, 0.7],
        [198, 196, 17, 0.25],
      ];
      for (const [x, y, R, o] of stars) {
        const k = 0.6 + 0.4 * wave(p, o);
        ctx.fillStyle = c[2];
        ctx.strokeStyle = alpha(c[1], 0.6);
        ctx.lineWidth = 2;
        sparkle(ctx, x, y, R * k, 0.2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.translate(112, 132);
      ctx.rotate(-0.2 + 0.05 * wave(p));
      shadow(ctx, 16, 0, alpha(c[1], 0.5));
      ctx.fillStyle = lgrad(ctx, -70, -70, 40, 80, lighten(c[0], 0.5), c[0], c[1]);
      crescent(ctx, 0, 0, 84, 38, -22, 70);
      ctx.fill();
      noShadow(ctx);
    },
  }),
  sticker({
    id: 'cloud-drift',
    name: 'Drifting Clouds',
    category: 'decor',
    keywords: 'clouds drift sky weather fluffy float dream air',
    aspect: 1.7,
    period: 6,
    colors: ['#ffffff', '#c7dcff'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      shadow(ctx, 12, 6, 'rgba(30,60,120,0.25)');
      ctx.fillStyle = vgrad(ctx, 130, 226, c[0], mix(c[0], c[1], 0.9));
      cloud(ctx, cx + 92 - 24 * wave(p, 0.3), 182, 150);
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 36, 150, c[0], c[1]);
      cloud(ctx, cx - 42 + 22 * wave(p), 98, 250);
      ctx.fill();
      noShadow(ctx);
    },
  }),
  sticker({
    id: 'music-notes-float',
    name: 'Floating Music Notes',
    category: 'decor',
    keywords: 'music notes song melody sing audio tune dance',
    period: 3,
    colors: ['#ff4f9a', '#7c5cff', '#22d3ee'],
    draw: (ctx, p, _env, c) => {
      NOTES.forEach((m, i) => {
        const ph = fract(p + m.o);
        const s = (28 + 14 * m.s) * (0.6 + 0.4 * Math.min(1, ph * 3));
        const x = 34 + (i / (NOTES.length - 1)) * 140 + 14 * Math.sin(TAU * (ph * 1.5 + m.q));
        const y = 226 - 136 * ph;
        ctx.save();
        ctx.globalAlpha = Math.pow(Math.sin(ph * PI), 0.6);
        ctx.translate(x, y);
        ctx.rotate(0.22 * Math.sin(TAU * (ph + m.q)));
        note(ctx, 0, 0, s, i % 2 === 1, c[i % 3]);
        ctx.restore();
      });
    },
  }),
  sticker({
    id: 'snowflakes-fall',
    name: 'Falling Snowflakes',
    category: 'decor',
    keywords: 'snow snowflakes winter cold christmas falling ice holiday',
    period: 5,
    colors: ['#ffffff', '#bfe6ff'],
    draw: (ctx, p, _env, c) => {
      for (const m of FLAKES) {
        const ph = fract(p + m.o);
        const R = 11 + 15 * m.s;
        ctx.save();
        ctx.translate(48 + m.x * 160 + 10 * Math.sin(TAU * (ph * 2 + m.q)), 36 + 184 * ph);
        ctx.rotate(((ph * TAU) / 6) * (m.k > 0.5 ? 1 : -1));
        ctx.globalAlpha = Math.pow(Math.sin(ph * PI), 0.5);
        ctx.lineWidth = Math.max(2.5, R * 0.17);
        ctx.strokeStyle = 'rgba(20,50,90,0.2)';
        ctx.translate(1.5, 2.5);
        flake(ctx, R);
        ctx.translate(-1.5, -2.5);
        ctx.strokeStyle = m.k > 0.35 ? c[0] : c[1];
        flake(ctx, R);
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'leaves-fall',
    name: 'Falling Leaves',
    category: 'decor',
    keywords: 'leaves fall autumn falling nature season wind cozy',
    period: 5,
    colors: ['#ff8a00', '#e2552b', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      for (const m of LEAVES) {
        const ph = fract(p + m.o);
        const R = 15 + 10 * m.s;
        const col = c[Math.floor(m.k * 3) % 3];
        ctx.save();
        ctx.translate(62 + m.x * 132 + 20 * Math.sin(TAU * (ph * 2 + m.q)), 40 + 176 * ph);
        ctx.rotate(m.q * TAU + 0.9 * Math.sin(TAU * (ph * 2 + m.q + 0.25)));
        ctx.scale(0.45 + 0.55 * Math.abs(Math.cos(TAU * (ph * 1.5 + m.q))), 1);
        ctx.globalAlpha = Math.pow(Math.sin(ph * PI), 0.5);
        ctx.fillStyle = lgrad(ctx, -R * 0.5, -R, R * 0.5, R, lighten(col, 0.25), col, darken(col, 0.15));
        ctx.beginPath();
        ctx.moveTo(0, -R);
        ctx.quadraticCurveTo(R * 0.95, -R * 0.1, 0, R);
        ctx.quadraticCurveTo(-R * 0.95, -R * 0.1, 0, -R);
        ctx.fill();
        ctx.strokeStyle = alpha(darken(col, 0.4), 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.7);
        ctx.lineTo(0, R * 1.25);
        ctx.stroke();
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'rainbow-arc',
    name: 'Rainbow',
    category: 'decor',
    keywords: 'rainbow colorful pride sky clouds happy weather hope',
    aspect: 1.8,
    colors: ['#ff3b5c', '#ffc531', '#22c55e', '#2f80ff'],
    draw: (ctx, _p, env, c) => {
      const cx = env.w / 2;
      ctx.lineCap = 'butt';
      ctx.lineWidth = 24;
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = c[i];
        ctx.beginPath();
        ctx.arc(cx, 204, 156 - i * 23, PI, TAU);
        ctx.stroke();
      }
      shadow(ctx, 10, 5, 'rgba(30,60,120,0.25)');
      ctx.fillStyle = vgrad(ctx, 160, 240, '#ffffff', '#dbe8ff');
      cloud(ctx, cx - 122, 204, 132);
      ctx.fill();
      cloud(ctx, cx + 118, 204, 132);
      ctx.fill();
      noShadow(ctx);
    },
  }),
  sticker({
    id: 'speed-lines',
    name: 'Focus Speed Lines',
    category: 'decor',
    keywords: 'speed lines focus anime manga zoom action dramatic impact',
    aspect: 1.78,
    period: 0.4,
    colors: ['#ffffff', '#bfe6ff'],
    draw: (ctx, p, env, c) => {
      const set = SPEED[Math.floor(p * 4) % 4];
      const rx = env.w / 2;
      ctx.beginPath();
      ctx.rect(10, 10, env.w - 20, 236);
      ctx.clip();
      ctx.translate(rx, 128);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? c[0] : c[1];
        ctx.beginPath();
        for (let i = 0; i < set.length; i += 3) {
          if (((i / 3) % 4 === 0) !== (pass === 1)) continue;
          const a = set[i];
          const hw = set[i + 1];
          const k = set[i + 2];
          ctx.moveTo(Math.cos(a - hw) * 320, Math.sin(a - hw) * 320);
          ctx.lineTo(Math.cos(a + hw) * 320, Math.sin(a + hw) * 320);
          ctx.lineTo(Math.cos(a) * rx * k, Math.sin(a) * 128 * k);
          ctx.closePath();
        }
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'shooting-star',
    name: 'Shooting Star',
    category: 'decor',
    keywords: 'shooting star wish comet falling night magic meteor',
    aspect: 1.6,
    period: 1.6,
    colors: ['#ffd84d', '#ff9d00', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const hx = 112 + 4 * wave(p);
      const hy = 176 - 4 * wave(p);
      const tx = env.w - 34;
      const ty = 36;
      const len = Math.hypot(tx - hx, ty - hy);
      const nx = -(ty - hy) / len;
      const ny = (tx - hx) / len;
      const w = 20 + 3 * wave(p * 2);
      ctx.fillStyle = lgrad(ctx, hx, hy, tx, ty, alpha(c[1], 0.95), alpha(c[0], 0.5), alpha(c[0], 0));
      poly(ctx, [hx + nx * w, hy + ny * w, tx, ty, hx - nx * w, hy - ny * w]);
      ctx.fill();
      ctx.fillStyle = lgrad(ctx, hx, hy, lerp(hx, tx, 0.7), lerp(hy, ty, 0.7), alpha(c[2], 0.9), alpha(c[2], 0));
      poly(ctx, [hx + nx * 8, hy + ny * 8, lerp(hx, tx, 0.7), lerp(hy, ty, 0.7), hx - nx * 8, hy - ny * 8]);
      ctx.fill();
      for (const m of TRAIL) {
        const ph = fract(p + m.o);
        const d = 0.14 + 0.8 * ph;
        const off = (m.x - 0.5) * 44 * (1 - ph * 0.5);
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = m.k > 0.5 ? c[2] : c[0];
        sparkle(ctx, lerp(hx, tx, d) + nx * off, lerp(hy, ty, d) + ny * off, (5 + 9 * m.s) * (1 - ph * 0.6), 0.2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgrad(ctx, hx, hy, 0, 66, alpha(c[0], 0.5), alpha(c[0], 0));
      circle(ctx, hx, hy, 66);
      ctx.fill();
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, hx - 30, hy - 36, hx + 30, hy + 36, lighten(c[0], 0.6), c[0], c[1]);
      ctx.lineWidth = 8;
      star(ctx, hx, hy, 5, 40, 17.5, -PI / 2 + (p * TAU) / 5);
      ctx.fill();
      ctx.stroke();
    },
  }),
];

export default stickers;
