import { Ease, seededRandom } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  body,
  bump,
  circle,
  darken,
  flame,
  fract,
  groundShadow,
  lgrad,
  lighten,
  mix,
  noShadow,
  poly,
  rgrad,
  ribbon,
  rrect,
  seg,
  shadow,
  star,
  sticker,
  sweep,
  text,
  twinkle,
  vgrad,
  wave,
  type Ctx,
} from './_lib/draw';

interface Bit {
  a: number;
  v: number;
  w: number;
  h: number;
  o: number;
  spin: number;
  col: number;
  round: boolean;
}
function bits(n: number, seed: number, spread: number, vMin: number, vMax: number): Bit[] {
  const r = seededRandom(seed);
  const out: Bit[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      a: (r() - 0.5) * spread,
      v: vMin + r() * (vMax - vMin),
      w: 10 + r() * 8,
      h: 6 + r() * 5,
      o: r(),
      spin: 1 + Math.floor(r() * 2),
      col: Math.floor(r() * 4),
      round: r() < 0.22,
    });
  }
  return out;
}

const BURST = bits(72, 1201, 3, 84, 150);
const POPPER = bits(30, 1302, 1.25, 58, 116);
const SPRINKLES = bits(14, 1403, 1, 0, 1);

/** One piece of confetti at its local phase `ph` (0..1), flying from (ox, oy) along `dir`. */
function confetti(ctx: Ctx, b: Bit, ph: number, ox: number, oy: number, dir: number, gravity: number, c: string[]): void {
  const e = 1 - Math.pow(1 - ph, 3);
  const a = dir + b.a;
  // Pieces thrown far off-axis travel a little less, which keeps a wide fan inside the box.
  const v = b.v * (1 - 0.27 * Math.abs(b.a));
  const x = ox + Math.cos(a) * v * e;
  const y = oy + Math.sin(a) * v * e + gravity * ph * ph;
  const k = Math.min(1, ph * 8);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(b.o * TAU + ph * TAU * b.spin * 0.5);
  ctx.globalAlpha = ph < 0.78 ? 1 : 1 - (ph - 0.78) / 0.22;
  ctx.fillStyle = c[b.col % c.length];
  if (b.round) {
    circle(ctx, 0, 0, b.h * 0.7 * k);
    ctx.fill();
  } else {
    // Flutter: the strip flips around its long axis.
    ctx.scale(k, k * (0.25 + 0.75 * Math.abs(Math.cos(TAU * (ph * b.spin * 1.5 + b.o)))));
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
  }
  ctx.restore();
}

function balloon(ctx: Ctx, x: number, y: number, rx: number, ry: number, col: string): void {
  ctx.fillStyle = darken(col, 0.18);
  poly(ctx, [x - 7, y + ry + 9, x + 7, y + ry + 9, x, y + ry - 4]);
  ctx.fill();
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, 3, x, y, ry * 1.15);
  g.addColorStop(0, lighten(col, 0.5));
  g.addColorStop(0.45, col);
  g.addColorStop(1, darken(col, 0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.42, y - ry * 0.46, rx * 0.16, ry * 0.24, 0.5, 0, TAU);
  ctx.fill();
}

const stickers: StickerDef[] = [
  sticker({
    id: 'confetti-burst',
    name: 'Confetti Burst',
    category: 'celebration',
    keywords: 'confetti burst party celebrate congrats win hooray yay',
    period: 2.4,
    colors: ['#ff3b5c', '#ffc531', '#22d3ee', '#7c5cff'],
    draw: (ctx, p, _env, c) => {
      // Two alternating bursts so the loop is never empty.
      BURST.forEach((b, i) => {
        const ph = fract(p + (i % 2) * 0.5);
        confetti(ctx, b, ph, 128, 196, -PI / 2, 46, c);
      });
    },
  }),
  sticker({
    id: 'party-popper',
    name: 'Party Popper',
    category: 'celebration',
    keywords: 'party popper celebrate congrats tada confetti hooray new year',
    period: 2,
    colors: ['#7c5cff', '#ffc531', '#ff4f9a', '#22d3ee'],
    draw: (ctx, p, _env, c) => {
      POPPER.forEach((b, i) => confetti(ctx, b, fract(p + i / POPPER.length), 112, 150, -PI / 4, 44, c));
      for (let s = 0; s < 2; s++) {
        const ph = fract(p + s * 0.5);
        const dir = -PI / 4 + (s === 0 ? -0.42 : 0.38);
        const reach = 108 * Ease.easeOutCubic(Math.min(1, ph * 1.6));
        ctx.globalAlpha = ph < 0.6 ? 1 : 1 - (ph - 0.6) / 0.4;
        ctx.strokeStyle = c[s === 0 ? 2 : 3];
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let i = 0; i <= 22; i++) {
          const u = i / 22;
          const d = 14 + reach * u;
          const wig = Math.sin(u * 15 + s * 2) * 9 * u;
          const x = 112 + Math.cos(dir) * d - Math.sin(dir) * wig;
          const y = 150 + Math.sin(dir) * d + Math.cos(dir) * wig + 26 * ph * ph * u;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const kick = 1 + 0.05 * wave(p * 2);
      ctx.translate(46, 216);
      ctx.rotate(-PI / 4);
      ctx.scale(kick, 2 - kick);
      shadow(ctx, 10, 5);
      ctx.fillStyle = lgrad(ctx, 0, -40, 0, 40, lighten(c[0], 0.25), c[0], darken(c[0], 0.2));
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(98, -42);
      ctx.quadraticCurveTo(112, 0, 98, 42);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 11;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(24 + i * 30, -50);
        ctx.lineTo(44 + i * 30, 50);
      }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = darken(c[0], 0.42);
      ctx.beginPath();
      ctx.ellipse(99, 0, 8, 42, 0, 0, TAU);
      ctx.fill();
    },
  }),
  sticker({
    id: 'fireworks',
    name: 'Fireworks',
    category: 'celebration',
    keywords: 'fireworks celebration new year festival party sparkle night',
    aspect: 1.2,
    period: 3,
    colors: ['#ff4f9a', '#ffc531', '#22d3ee'],
    draw: (ctx, p, _env, c) => {
      const shells = [
        [96, 96, 74, 0, 0],
        [216, 82, 62, 0.37, 0.26],
        [168, 174, 54, 0.68, 0.13],
      ];
      shells.forEach(([x, y, R, off, rot], si) => {
        const ph = fract(p + off);
        const e = Ease.easeOutCubic(seg(ph, 0.04, 0.72));
        if (e <= 0) return;
        const fade = 1 - seg(ph, 0.5, 0.96);
        const col = c[si % 3];
        ctx.save();
        ctx.translate(x, y + 16 * ph * ph);
        ctx.rotate(rot);
        ctx.fillStyle = rgrad(ctx, 0, 0, 0, R * 0.5, alpha(col, 0.5 * fade * (1 - e * 0.6)), alpha(col, 0));
        circle(ctx, 0, 0, R * 0.5);
        ctx.fill();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = col;
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * TAU) / 12;
          ctx.moveTo(Math.cos(a) * R * e * 0.58, Math.sin(a) * R * e * 0.58);
          ctx.lineTo(Math.cos(a) * R * e, Math.sin(a) * R * e);
        }
        ctx.stroke();
        ctx.strokeStyle = lighten(col, 0.55);
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = ((i + 0.5) * TAU) / 12;
          ctx.moveTo(Math.cos(a) * R * e * 0.36, Math.sin(a) * R * e * 0.36);
          ctx.lineTo(Math.cos(a) * R * e * 0.62, Math.sin(a) * R * e * 0.62);
        }
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 12; i++) {
          const a = (i * TAU) / 12;
          circle(ctx, Math.cos(a) * R * e, Math.sin(a) * R * e, 3.2);
          ctx.fill();
        }
        ctx.restore();
      });
    },
  }),
  sticker({
    id: 'balloons-bob',
    name: 'Party Balloons',
    category: 'celebration',
    keywords: 'balloons party birthday celebrate float kids festive',
    aspect: 0.9,
    period: 3,
    colors: ['#ff3b5c', '#ffc531', '#2f80ff'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      const spec = [
        [cx - 48, 104, 38, 48, 0, 0],
        [cx + 50, 100, 38, 48, 2, 0.33],
        [cx, 70, 42, 53, 1, 0.66],
      ];
      const pos = spec.map(([x, y, , , , o]) => [x + 3 * wave(p, o + 0.25), y + 6 * wave(p, o)]);
      ctx.strokeStyle = 'rgba(150,156,178,0.95)';
      ctx.lineWidth = 2.5;
      spec.forEach(([, , , ry], i) => {
        ctx.beginPath();
        ctx.moveTo(pos[i][0], pos[i][1] + ry + 8);
        ctx.quadraticCurveTo(pos[i][0] + 6 * wave(p, i * 0.3), 190, cx, 240);
        ctx.stroke();
      });
      spec.forEach(([, , rx, ry, ci], i) => balloon(ctx, pos[i][0], pos[i][1], rx, ry, c[ci]));
    },
  }),
  sticker({
    id: 'trophy-shine',
    name: 'Trophy',
    category: 'celebration',
    keywords: 'trophy winner champion cup award victory first prize',
    aspect: 0.9,
    period: 2.8,
    colors: ['#ffc531', '#ff9d00', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const gold = lgrad(ctx, -60, 30, 60, 190, lighten(c[0], 0.45), c[0], c[1]);
      ctx.translate(env.w / 2, 0);
      groundShadow(ctx, 0, 232, 62, 8);
      ctx.strokeStyle = gold;
      ctx.lineWidth = 12;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 52, 58);
        ctx.bezierCurveTo(s * 96, 54, s * 98, 112, s * 40, 118);
        ctx.stroke();
      }
      ctx.fillStyle = vgrad(ctx, 196, 230, darken(c[1], 0.25), darken(c[1], 0.45));
      rrect(ctx, -50, 198, 100, 30, 7);
      ctx.fill();
      ctx.fillStyle = gold;
      rrect(ctx, -32, 182, 64, 20, 6);
      ctx.fill();
      ctx.fillRect(-9, 146, 18, 40);
      const cup = (): void => {
        ctx.beginPath();
        ctx.moveTo(-60, 36);
        ctx.lineTo(60, 36);
        ctx.bezierCurveTo(60, 104, 34, 150, 0, 154);
        ctx.bezierCurveTo(-34, 150, -60, 104, -60, 36);
        ctx.closePath();
      };
      cup();
      ctx.fill();
      ctx.fillStyle = alpha(darken(c[1], 0.3), 0.35);
      rrect(ctx, -66, 28, 132, 16, 8);
      ctx.fill();
      ctx.fillStyle = gold;
      rrect(ctx, -66, 26, 132, 14, 7);
      ctx.fill();
      ctx.fillStyle = ctx.strokeStyle = alpha(c[2], 0.92);
      ctx.lineWidth = 4;
      star(ctx, 0, 90, 5, 24, 10.5);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      cup();
      ctx.clip();
      sweep(ctx, -60, 60, 36, 154, seg(p, 0.1, 0.5), 40, 0.6);
      ctx.restore();
      twinkle(ctx, 62, 50, 26, fract(p + 0.55), c[2]);
      twinkle(ctx, -64, 150, 18, fract(p + 0.05), c[2]);
    },
  }),
  sticker({
    id: 'gift-wiggle',
    name: 'Gift Box',
    category: 'celebration',
    keywords: 'gift present box surprise birthday christmas giveaway reward',
    period: 2,
    colors: ['#ff3b5c', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      const u = seg(p, 0.4, 0.95);
      const hop = bump(p, 0.4, 0.62);
      groundShadow(ctx, 128, 232, 92, 9);
      ctx.translate(128, 228);
      ctx.rotate(Math.sin(u * TAU * 3) * (1 - u) * 0.08);
      ctx.translate(-128, -228);
      ctx.fillStyle = body(ctx, c[0], 120, 228);
      rrect(ctx, 54, 120, 148, 108, 12);
      ctx.fill();
      ctx.fillStyle = alpha(darken(c[0], 0.5), 0.3);
      ctx.fillRect(54, 120, 148, 16);
      ctx.fillStyle = vgrad(ctx, 120, 228, c[1], darken(c[1], 0.14));
      ctx.fillRect(113, 120, 30, 108);
      ctx.translate(128, 100 - 14 * hop);
      ctx.rotate(-0.06 * hop);
      ctx.fillStyle = vgrad(ctx, -18, 26, lighten(c[0], 0.22), c[0]);
      rrect(ctx, -86, -18, 172, 44, 10);
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, -18, 26, lighten(c[1], 0.15), c[1]);
      ctx.fillRect(-15, -18, 30, 44);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.scale(s, 1);
        ctx.fillStyle = lgrad(ctx, 0, -60, 60, -10, lighten(c[1], 0.2), darken(c[1], 0.08));
        ctx.beginPath();
        ctx.moveTo(2, -18);
        ctx.bezierCurveTo(14, -74, 78, -70, 60, -32);
        ctx.bezierCurveTo(48, -12, 20, -14, 2, -18);
        ctx.fill();
        ctx.fillStyle = alpha(darken(c[1], 0.45), 0.5);
        ctx.beginPath();
        ctx.ellipse(34, -40, 15, 8, -0.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = darken(c[1], 0.1);
      rrect(ctx, -13, -30, 26, 22, 8);
      ctx.fill();
    },
  }),
  sticker({
    id: 'cake-candles',
    name: 'Birthday Cake',
    category: 'celebration',
    keywords: 'cake birthday candles party dessert celebrate anniversary sweet',
    period: 1,
    colors: ['#ff8fb8', '#fff3e0', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      groundShadow(ctx, 128, 230, 104, 9);
      ctx.fillStyle = vgrad(ctx, 150, 226, c[1], darken(c[1], 0.12));
      rrect(ctx, 40, 150, 176, 76, 16);
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 96, 160, lighten(c[0], 0.15), c[0]);
      rrect(ctx, 70, 96, 116, 66, 14);
      ctx.fill();
      // Frosting drips.
      const drip = (x0: number, x1: number, y: number, n: number, col: string): void => {
        const w = (x1 - x0) / n;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x0, y - 8);
        ctx.lineTo(x0, y);
        for (let i = 0; i < n; i++) {
          const d = 10 + ((i * 7) % 3) * 6;
          ctx.bezierCurveTo(x0 + i * w, y + d * 1.4, x0 + (i + 1) * w, y + d * 1.4, x0 + (i + 1) * w, y);
        }
        ctx.lineTo(x1, y - 8);
        ctx.closePath();
        ctx.fill();
      };
      drip(40, 216, 158, 7, c[0]);
      ctx.fillStyle = c[0];
      rrect(ctx, 40, 148, 176, 16, 8);
      ctx.fill();
      drip(70, 186, 104, 5, c[1]);
      ctx.fillStyle = c[1];
      rrect(ctx, 70, 94, 116, 16, 8);
      ctx.fill();
      const sprinkleCols = ['#22d3ee', '#7c5cff', '#ffc531', '#ff3b5c'];
      ctx.lineWidth = 4;
      SPRINKLES.forEach((b, i) => {
        const x = 54 + (i / (SPRINKLES.length - 1)) * 148;
        const y = 192 + (b.o - 0.5) * 36;
        ctx.strokeStyle = sprinkleCols[b.col];
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(b.a * 3) * 5, y - Math.sin(b.a * 3) * 5);
        ctx.lineTo(x + Math.cos(b.a * 3) * 5, y + Math.sin(b.a * 3) * 5);
        ctx.stroke();
      });
      for (let i = 0; i < 3; i++) {
        const x = 100 + i * 28;
        ctx.fillStyle = i === 1 ? '#22d3ee' : '#7c5cff';
        rrect(ctx, x - 5, 62, 10, 34, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x - 5, 70, 10, 5);
        ctx.fillRect(x - 5, 82, 10, 5);
        const sway = 0.6 * wave(p, i * 0.31) + 0.3 * wave(p * 2, i * 0.17);
        ctx.fillStyle = rgrad(ctx, x, 44, 0, 22, alpha(c[2], 0.4), alpha(c[2], 0));
        circle(ctx, x, 44, 22);
        ctx.fill();
        ctx.fillStyle = vgrad(ctx, 28, 60, '#ff8a00', c[2]);
        flame(ctx, x, 44, 16, sway, wave(p * 2, i * 0.4));
        ctx.fill();
        ctx.fillStyle = lighten(c[2], 0.6);
        flame(ctx, x, 51, 8, sway, 0);
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'congrats-banner',
    name: 'Congrats Banner',
    category: 'celebration',
    keywords: 'congrats congratulations banner ribbon well done bravo celebrate',
    aspect: 3.3,
    period: 2.2,
    colors: ['#7c5cff', '#ffffff', '#ffc531'],
    draw: (ctx, p, env, c) => {
      const W = env.w;
      ribbon(ctx, 96, W - 96, 74, 180, c[0], 24, 64);
      text(ctx, 'CONGRATS!', W / 2, 129, { size: 70, maxW: W - 270, fill: c[1], weight: 900, spacing: 0.04 });
      twinkle(ctx, 134, 42, 28, fract(p + 0.1), c[2]);
      twinkle(ctx, W - 150, 44, 34, fract(p + 0.55), c[2]);
      twinkle(ctx, W / 2 - 60, 34, 18, fract(p * 2 + 0.3), c[2]);
      twinkle(ctx, W - 250, 222, 20, fract(p + 0.8), c[2]);
      twinkle(ctx, 250, 224, 24, fract(p + 0.35), c[2]);
    },
  }),
  sticker({
    id: 'streamers',
    name: 'Party Streamers',
    category: 'celebration',
    keywords: 'streamers ribbons party serpentine decoration hanging festive carnival',
    aspect: 1.4,
    period: 2.4,
    colors: ['#ff3b5c', '#ffc531', '#22d3ee', '#7c5cff'],
    draw: (ctx, p, env, c) => {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const x0 = 38 + (k * (env.w - 76)) / (n - 1);
        const L = 150 + ((k * 37) % 70);
        const lam = 52 + ((k * 13) % 18);
        const dir = k % 2 === 0 ? 1 : -1;
        ctx.strokeStyle = c[k % 4];
        ctx.lineWidth = 9;
        ctx.beginPath();
        for (let i = 0; i <= 26; i++) {
          const u = i / 26;
          const y = 12 + L * u;
          const x = x0 + Math.sin(TAU * ((L * u) / lam + dir * p + k * 0.21)) * 15 * (0.25 + 0.75 * u);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
  }),
  sticker({
    id: 'bunting-flags',
    name: 'Bunting Flags',
    category: 'celebration',
    keywords: 'bunting flags garland party pennant decoration festival birthday',
    aspect: 3,
    period: 2.4,
    colors: ['#ff3b5c', '#ffc531', '#22d3ee', '#7c5cff'],
    draw: (ctx, p, env, c) => {
      const W = env.w;
      const n = 9;
      const at = (u: number): [number, number, number] => {
        const v = 1 - u;
        const x = v * v * 22 + 2 * v * u * (W / 2) + u * u * (W - 22);
        const y = v * v * 40 + 2 * v * u * 138 + u * u * 40;
        return [x, y, Math.atan2(2 * (138 - 40) * (1 - 2 * u), W - 44)];
      };
      for (let i = 0; i < n; i++) {
        const [x, y, a] = at((i + 0.5) / n);
        const col = c[i % 4];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + 0.09 * wave(p, i * 0.13));
        ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, 0, 96, lighten(col, 0.18), col, darken(col, 0.14));
        ctx.lineWidth = 5;
        poly(ctx, [-33, 2, 33, 2, 0, 92]);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = '#eef0f6';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(22, 40);
      ctx.quadraticCurveTo(W / 2, 138, W - 22, 40);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,31,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },
  }),
  sticker({
    id: 'disco-ball',
    name: 'Disco Ball',
    category: 'celebration',
    keywords: 'disco ball party dance club music night shine retro',
    aspect: 0.85,
    period: 2,
    colors: ['#cfd6ff', '#7c5cff', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const cx = env.w / 2;
      const R = 78;
      ctx.strokeStyle = 'rgba(160,166,188,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx, 60);
      ctx.stroke();
      ctx.fillStyle = darken(c[0], 0.35);
      rrect(ctx, cx - 14, 52, 28, 14, 4);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, 142);
      const g = ctx.createRadialGradient(-26, -30, 6, 0, 0, R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, c[0]);
      g.addColorStop(1, mix(c[1], '#14161f', 0.35));
      ctx.fillStyle = g;
      circle(ctx, 0, 0, R);
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = alpha(mix(c[1], '#14161f', 0.5), 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = -3; k <= 3; k++) {
        const lat = (k * PI) / 8;
        const y = R * Math.sin(lat);
        const rx = R * Math.cos(lat);
        ctx.moveTo(-rx, y);
        ctx.ellipse(0, y, rx, 9 * Math.cos(lat), 0, PI, 0, true);
      }
      for (let j = 0; j < 8; j++) {
        const th = ((j + p) / 8) * PI - PI / 2;
        const x = R * Math.sin(th);
        ctx.moveTo(0, -R);
        ctx.ellipse(0, 0, Math.abs(x), R, 0, -PI / 2, PI / 2, x < 0);
      }
      ctx.stroke();
      const tiles = [
        [-30, -34, 0],
        [26, -8, 0.35],
        [-8, 30, 0.6],
        [40, 38, 0.15],
        [-48, 10, 0.8],
      ];
      for (const [x, y, o] of tiles) twinkle(ctx, x, y, 22, fract(p + o), c[2]);
      ctx.restore();
      twinkle(ctx, cx + 76, 78, 22, fract(p + 0.5), c[2]);
      twinkle(ctx, cx - 82, 190, 18, fract(p + 0.2), c[2]);
      twinkle(ctx, cx - 70, 74, 14, fract(p * 2 + 0.7), c[2]);
    },
  }),
];

export default stickers;
