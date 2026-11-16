import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  body,
  bolt,
  circle,
  darken,
  flame,
  fract,
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

/** Price-tag outline with its hole on the origin, extending along +x. Fill with 'evenodd'. */
function tag(ctx: Ctx, len: number, h: number): void {
  const hh = h / 2;
  const xs = h * 0.22;
  ctx.beginPath();
  ctx.moveTo(-30, -hh * 0.3);
  ctx.lineTo(xs, -hh);
  ctx.arcTo(len, -hh, len, hh, 20);
  ctx.arcTo(len, hh, xs, hh, 20);
  ctx.lineTo(xs, hh);
  ctx.lineTo(-30, hh * 0.3);
  ctx.closePath();
  ctx.moveTo(13, 0);
  ctx.arc(0, 0, 13, 0, TAU);
}

/** Heraldic shield centred on the origin. */
function shield(ctx: Ctx, w: number, h: number): void {
  const hw = w / 2;
  ctx.beginPath();
  ctx.moveTo(-hw + 14, -h * 0.5);
  ctx.lineTo(hw - 14, -h * 0.5);
  ctx.quadraticCurveTo(hw, -h * 0.5, hw, -h * 0.5 + 14);
  ctx.lineTo(hw, h * 0.04);
  ctx.bezierCurveTo(hw, h * 0.3, hw * 0.5, h * 0.44, 0, h * 0.5);
  ctx.bezierCurveTo(-hw * 0.5, h * 0.44, -hw, h * 0.3, -hw, h * 0.04);
  ctx.lineTo(-hw, -h * 0.5 + 14);
  ctx.quadraticCurveTo(-hw, -h * 0.5, -hw + 14, -h * 0.5);
  ctx.closePath();
}

const stickers: StickerDef[] = [
  sticker({
    id: 'badge-new-burst',
    name: 'New Starburst',
    category: 'badges',
    keywords: 'new badge burst fresh launch just in label',
    period: 4,
    colors: ['#ff3b5c', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      // One tooth per loop. The turn is baked into the path so the shading stays put.
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -90, -100, 90, 100, lighten(c[0], 0.22), c[0], darken(c[0], 0.16));
      ctx.lineWidth = 6;
      star(ctx, 0, 0, 16, 108, 92, -PI / 2 + (p * TAU) / 16);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
      ctx.save();
      const step = (TAU * 78) / 35;
      ctx.setLineDash([3, step - 3]);
      ctx.lineDashOffset = -p * step * 2;
      ctx.strokeStyle = alpha(c[1], 0.65);
      ctx.lineWidth = 4;
      circle(ctx, 0, 0, 78);
      ctx.stroke();
      ctx.restore();
      ctx.rotate(-0.14);
      text(ctx, 'NEW', 0, 2, { size: 66, maxW: 128, fill: c[1], weight: 900, spacing: 0.04 });
    },
  }),
  sticker({
    id: 'badge-sale-tag',
    name: 'Sale Tag',
    category: 'badges',
    keywords: 'sale tag price discount shop deal offer label',
    aspect: 1.4,
    period: 2.4,
    colors: ['#ff2d55', '#ffffff', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      const px = 62;
      const py = 80;
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.bezierCurveTo(px - 44, py - 10, px - 30, py - 70, px + 14, py - 58);
      ctx.stroke();
      ctx.translate(px, py);
      ctx.rotate(0.3 + 0.07 * wave(p));
      shadow(ctx, 14, 8, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -62, 62);
      tag(ctx, 250, 124);
      ctx.fill('evenodd');
      noShadow(ctx);
      ctx.strokeStyle = alpha(c[1], 0.85);
      ctx.lineWidth = 5;
      circle(ctx, 0, 0, 16);
      ctx.stroke();
      text(ctx, 'SALE', 138, 2, { size: 82, maxW: 186, fill: c[1], weight: 900 });
    },
  }),
  sticker({
    id: 'badge-50-off',
    name: '50% Off Seal',
    category: 'badges',
    keywords: '50 percent off discount half price sale deal seal',
    colors: ['#ffc531', '#14161f', '#ff3b5c'],
    draw: (ctx, _p, _env, c) => {
      ctx.translate(128, 128);
      ctx.rotate(-0.16);
      shadow(ctx, 14, 7);
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -90, -100, 90, 100, lighten(c[0], 0.4), c[0], darken(c[0], 0.1));
      ctx.lineWidth = 5;
      star(ctx, 0, 0, 24, 110, 99);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 5;
      circle(ctx, 0, 0, 86);
      ctx.stroke();
      text(ctx, '50%', 0, -16, { size: 84, maxW: 140, fill: c[1], weight: 900 });
      text(ctx, 'OFF', 0, 46, { size: 42, maxW: 110, fill: c[2], weight: 900, spacing: 0.14 });
    },
  }),
  sticker({
    id: 'badge-hot',
    name: 'Hot Flame',
    category: 'badges',
    keywords: 'hot flame fire trending popular deal spicy lit',
    period: 1.2,
    colors: ['#ff3d1a', '#ffb020', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const sway = 0.55 * wave(p) + 0.25 * wave(p * 2, 0.3);
      ctx.fillStyle = vgrad(ctx, 16, 236, mix(c[0], c[1], 0.45), c[0], darken(c[0], 0.12));
      flame(ctx, 128, 134, 100, sway, wave(p * 2));
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 106, 236, lighten(c[1], 0.3), c[1]);
      flame(ctx, 130, 170, 60, -sway * 0.8, wave(p * 2, 0.4));
      ctx.fill();
      text(ctx, 'HOT', 128, 182, { size: 54, maxW: 116, fill: c[2], weight: 900, stroke: darken(c[0], 0.25), strokeW: 10 });
    },
  }),
  sticker({
    id: 'badge-best-seller',
    name: 'Best Seller Ribbon',
    category: 'badges',
    keywords: 'best seller ribbon banner top popular award shop',
    aspect: 2.9,
    colors: ['#ffb300', '#14161f'],
    draw: (ctx, _p, env, c) => {
      ribbon(ctx, 92, env.w - 92, 64, 168, c[0], 24, 62);
      text(ctx, 'BEST SELLER', env.w / 2, 118, { size: 62, maxW: env.w - 250, fill: c[1], weight: 900, spacing: 0.03 });
    },
  }),
  sticker({
    id: 'badge-price-tag',
    name: 'Price Tag',
    category: 'badges',
    keywords: 'price tag dollar cost money shop buy label',
    colors: ['#22c55e', '#ffffff', '#ffc531'],
    draw: (ctx, _p, _env, c) => {
      const a = 2.18;
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(170, 70);
      ctx.bezierCurveTo(196, 40, 232, 44, 222, 16);
      ctx.stroke();
      ctx.save();
      ctx.translate(170, 70);
      ctx.rotate(a);
      shadow(ctx, 14, 8, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -52, 52);
      tag(ctx, 164, 104);
      ctx.fill('evenodd');
      noShadow(ctx);
      ctx.strokeStyle = alpha(c[1], 0.85);
      ctx.lineWidth = 5;
      circle(ctx, 0, 0, 16);
      ctx.stroke();
      ctx.restore();
      ctx.translate(170 + Math.cos(a) * 94, 70 + Math.sin(a) * 94);
      ctx.rotate(a - PI / 2);
      text(ctx, '$', 0, 0, { size: 86, fill: c[1], weight: 900 });
    },
  }),
  sticker({
    id: 'badge-free',
    name: 'Free Badge',
    category: 'badges',
    keywords: 'free badge gift zero cost bonus giveaway label',
    period: 1.6,
    colors: ['#22c55e', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = lgrad(ctx, -80, -90, 80, 90, lighten(c[0], 0.25), c[0], darken(c[0], 0.16));
      circle(ctx, 0, 0, 102);
      ctx.fill();
      noShadow(ctx);
      ctx.save();
      const step = (TAU * 84) / 26;
      ctx.setLineDash([step / 2, step / 2]);
      ctx.lineDashOffset = -p * step;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = alpha(c[1], 0.8);
      ctx.lineWidth = 5;
      circle(ctx, 0, 0, 84);
      ctx.stroke();
      ctx.restore();
      ctx.rotate(-0.12);
      text(ctx, 'FREE', 0, 2, { size: 62, maxW: 136, fill: c[1], weight: 900, spacing: 0.04 });
    },
  }),
  sticker({
    id: 'badge-limited-time',
    name: 'Limited Time Stamp',
    category: 'badges',
    keywords: 'limited time offer stamp hurry urgent deal ends',
    aspect: 1.9,
    colors: ['#ffffff', '#ff3b30'],
    draw: (ctx, _p, env, c) => {
      ctx.translate(env.w / 2, 128);
      ctx.rotate(-0.1);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -84, 84, c[0], darken(c[0], 0.07));
      rrect(ctx, -204, -84, 408, 168, 22);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 7;
      rrect(ctx, -191, -71, 382, 142, 14);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      rrect(ctx, -180, -60, 360, 120, 8);
      ctx.stroke();
      text(ctx, 'LIMITED', 0, -18, { size: 66, maxW: 320, fill: c[1], weight: 900, spacing: 0.05 });
      text(ctx, 'TIME OFFER', 0, 34, { size: 30, maxW: 320, fill: c[1], weight: 800, spacing: 0.22 });
    },
  }),
  sticker({
    id: 'badge-rosette',
    name: 'Award Rosette',
    category: 'badges',
    keywords: 'award rosette ribbon winner prize first place best',
    colors: ['#ffb300', '#ff3b5c', '#ffffff'],
    draw: (ctx, _p, _env, c) => {
      ctx.translate(128, 104);
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.rotate(side * -0.3);
        ctx.fillStyle = vgrad(ctx, 30, 140, c[1], darken(c[1], side < 0 ? 0.12 : 0.3));
        poly(ctx, [-24, 30, 24, 30, 24, 138, 0, 116, -24, 138]);
        ctx.fill();
        ctx.restore();
      }
      shadow(ctx, 12, 6);
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -70, -80, 70, 80, lighten(c[0], 0.3), c[0], darken(c[0], 0.14));
      ctx.lineWidth = 5;
      star(ctx, 0, 0, 20, 88, 78);
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
      ctx.fillStyle = lgrad(ctx, -50, -60, 50, 60, lighten(c[0], 0.5), lighten(c[0], 0.1));
      circle(ctx, 0, 0, 62);
      ctx.fill();
      ctx.strokeStyle = alpha(darken(c[0], 0.2), 0.55);
      ctx.lineWidth = 3;
      circle(ctx, 0, 0, 62);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle = c[2];
      ctx.lineWidth = 6;
      star(ctx, 0, 2, 5, 34, 15);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'badge-medal',
    name: 'Gold Medal',
    category: 'badges',
    keywords: 'medal gold first winner champion award number one',
    period: 2.6,
    colors: ['#ffc531', '#ff9d00', '#2f80ff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 10);
      ctx.rotate(0.045 * wave(p));
      ctx.translate(-128, -10);
      ctx.fillStyle = darken(c[2], 0.25);
      poly(ctx, [198, 14, 156, 14, 112, 112, 148, 124]);
      ctx.fill();
      ctx.fillStyle = vgrad(ctx, 14, 124, lighten(c[2], 0.15), c[2]);
      poly(ctx, [58, 14, 100, 14, 144, 112, 108, 124]);
      ctx.fill();
      shadow(ctx, 12, 6);
      ctx.fillStyle = lgrad(ctx, 70, 96, 186, 228, lighten(c[0], 0.35), c[0], c[1]);
      circle(ctx, 128, 164, 72);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = alpha(darken(c[1], 0.25), 0.6);
      ctx.lineWidth = 4;
      circle(ctx, 128, 164, 56);
      ctx.stroke();
      text(ctx, '1', 128, 166, { size: 76, fill: darken(c[1], 0.3), weight: 900 });
      circle(ctx, 128, 164, 72);
      ctx.clip();
      sweep(ctx, 56, 200, 92, 236, seg(p, 0.15, 0.6), 46, 0.6);
    },
  }),
  sticker({
    id: 'badge-number-one',
    name: 'Number One Shield',
    category: 'badges',
    keywords: 'number one 1 first shield top best rank winner',
    colors: ['#5b5bf7', '#ffc531', '#ffffff'],
    draw: (ctx, _p, _env, c) => {
      ctx.translate(128, 128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = lgrad(ctx, -80, -100, 80, 100, lighten(c[1], 0.35), c[1], darken(c[1], 0.12));
      shield(ctx, 176, 208);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = vgrad(ctx, -90, 96, lighten(c[0], 0.16), c[0], darken(c[0], 0.22));
      shield(ctx, 148, 180);
      ctx.fill();
      text(ctx, '#1', 0, -12, { size: 84, maxW: 120, fill: c[2], weight: 900 });
      ctx.fillStyle = ctx.strokeStyle = c[1];
      ctx.lineWidth = 4;
      star(ctx, 0, 52, 5, 17, 7.5);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'badge-coupon',
    name: 'Coupon Ticket',
    category: 'badges',
    keywords: 'coupon ticket voucher discount code promo save',
    aspect: 2.2,
    colors: ['#ff8a00', '#ffffff'],
    draw: (ctx, _p, env, c) => {
      const x0 = 28;
      const x1 = env.w - 28;
      const y0 = 56;
      const y1 = 200;
      const sx = x1 - 132;
      const r = 20;
      const n = 15;
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = lgrad(ctx, x0, y0, x1, y1, lighten(c[0], 0.18), c[0], darken(c[0], 0.1));
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(sx - n, y0);
      ctx.arc(sx, y0, n, PI, 0, true);
      ctx.lineTo(x1 - r, y0);
      ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r);
      ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(sx + n, y1);
      ctx.arc(sx, y1, n, 0, PI, true);
      ctx.lineTo(x0 + r, y1);
      ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      ctx.save();
      ctx.setLineDash([1, 13]);
      ctx.strokeStyle = alpha(c[1], 0.85);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, y0 + 26);
      ctx.lineTo(sx, y1 - 22);
      ctx.stroke();
      ctx.restore();
      const mx = (x0 + sx) / 2;
      text(ctx, 'COUPON', mx, 112, { size: 68, maxW: sx - x0 - 70, fill: c[1], weight: 900, spacing: 0.03 });
      text(ctx, 'SPECIAL OFFER', mx, 164, { size: 22, maxW: sx - x0 - 70, fill: alpha(c[1], 0.9), weight: 700, spacing: 0.26 });
      text(ctx, '%', (sx + x1) / 2, 130, { size: 76, fill: c[1], weight: 900 });
    },
  }),
  sticker({
    id: 'badge-premium-crown',
    name: 'Premium Crown',
    category: 'badges',
    keywords: 'crown premium king queen vip pro royal best',
    period: 2.4,
    colors: ['#ffc531', '#ff9d00', '#ff3b5c'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 140);
      shadow(ctx, 14, 7, alpha(darken(c[1], 0.6), 0.38));
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -80, -70, 80, 70, lighten(c[0], 0.4), c[0], c[1]);
      ctx.lineWidth = 12;
      poly(ctx, [-76, 34, -88, -42, -40, 0, 0, -66, 40, 0, 88, -42, 76, 34]);
      ctx.fill();
      ctx.stroke();
      noShadow(ctx);
      for (const [x, y] of [
        [-88, -48],
        [0, -74],
        [88, -48],
      ]) {
        circle(ctx, x, y, 12);
        ctx.fill();
      }
      ctx.fillStyle = vgrad(ctx, 42, 74, c[1], darken(c[1], 0.14));
      rrect(ctx, -82, 42, 164, 30, 9);
      ctx.fill();
      for (let i = -1; i <= 1; i++) {
        ctx.fillStyle = i === 0 ? c[2] : lighten(c[0], 0.75);
        circle(ctx, i * 44, 57, i === 0 ? 9 : 7);
        ctx.fill();
      }
      twinkle(ctx, 70, -92, 26, fract(p + 0.3), '#ffffff');
      twinkle(ctx, -66, -84, 18, fract(p + 0.8), '#ffffff');
      twinkle(ctx, 22, 4, 16, fract(p * 2 + 0.1), '#ffffff');
    },
  }),
  sticker({
    id: 'badge-top-rated',
    name: 'Top Rated Laurel',
    category: 'badges',
    keywords: 'top rated laurel wreath award best quality winner',
    aspect: 1.2,
    colors: ['#ffc531', '#ff9d00', '#14161f'],
    draw: (ctx, _p, env, c) => {
      const cx = env.w / 2;
      ctx.translate(cx, 126);
      ctx.scale(0.9, 0.9);
      ctx.translate(-cx, -128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, 8, 248, lighten(c[2], 0.18), c[2]);
      circle(ctx, cx, 128, 118);
      ctx.fill();
      noShadow(ctx);
      const paint = vgrad(ctx, 30, 232, lighten(c[0], 0.25), c[0], c[1]);
      ctx.fillStyle = paint;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(cx, 126);
        ctx.scale(side, 1);
        for (let k = 0; k < 8; k++) {
          const a = 1.86 + (k / 7) * 2.25;
          const s = 1 - 0.36 * (k / 7);
          ctx.save();
          ctx.translate(Math.cos(a) * 100, Math.sin(a) * 100);
          ctx.rotate(a + PI / 2 + 0.62);
          ctx.beginPath();
          ctx.moveTo(-27 * s, 0);
          ctx.quadraticCurveTo(0, -15 * s, 27 * s, 0);
          ctx.quadraticCurveTo(0, 15 * s, -27 * s, 0);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
      ctx.strokeStyle = paint;
      ctx.lineWidth = 5;
      star(ctx, cx, 76, 5, 26, 11.5);
      ctx.fill();
      ctx.stroke();
      text(ctx, 'TOP', cx, 130, { size: 50, maxW: 120, fill: paint, weight: 900, spacing: 0.06 });
      text(ctx, 'RATED', cx, 172, { size: 30, maxW: 120, fill: paint, weight: 800, spacing: 0.14 });
    },
  }),
  sticker({
    id: 'badge-sold-out',
    name: 'Sold Out Label',
    category: 'badges',
    keywords: 'sold out gone unavailable stock label sign',
    aspect: 2.2,
    colors: ['#14161f', '#ffffff', '#ff3b5c'],
    draw: (ctx, _p, env, c) => {
      const bw = env.w - 84;
      ctx.translate(env.w / 2, 128);
      ctx.rotate(-0.09);
      shadow(ctx, 14, 8);
      ctx.fillStyle = vgrad(ctx, -62, 62, lighten(c[0], 0.18), c[0]);
      rrect(ctx, -bw / 2, -62, bw, 124, 16);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 4;
      rrect(ctx, -bw / 2 + 11, -51, bw - 22, 102, 8);
      ctx.stroke();
      text(ctx, 'SOLD OUT', 0, 2, { size: 76, maxW: bw - 70, fill: c[1], weight: 900, spacing: 0.05 });
    },
  }),
  sticker({
    id: 'badge-flash-sale',
    name: 'Flash Sale',
    category: 'badges',
    keywords: 'flash sale lightning deal quick offer bolt discount',
    period: 1.2,
    colors: ['#7c3aed', '#ffc531', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const k = Math.max(0, Math.sin(p * PI * 4)) * (p < 0.5 ? 1 : 0);
      ctx.translate(128, 128);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.42));
      ctx.fillStyle = lgrad(ctx, -80, -90, 80, 90, lighten(c[0], 0.25), c[0], darken(c[0], 0.2));
      circle(ctx, 0, 0, 102);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = alpha(c[1], 0.9);
      ctx.lineWidth = 4;
      circle(ctx, 0, 0, 88);
      ctx.stroke();
      ctx.fillStyle = rgrad(ctx, 0, -46, 0, 52, alpha(c[1], 0.25 + 0.4 * k), alpha(c[1], 0));
      circle(ctx, 0, -46, 52);
      ctx.fill();
      ctx.fillStyle = ctx.strokeStyle = mix(c[1], '#ffffff', 0.5 * k);
      ctx.lineWidth = 4;
      bolt(ctx, 0, -46, 34 * (1 + 0.12 * k));
      ctx.fill();
      ctx.stroke();
      text(ctx, 'FLASH', 0, 12, { size: 36, maxW: 140, fill: c[2], weight: 900, spacing: 0.08 });
      text(ctx, 'SALE', 0, 48, { size: 36, maxW: 104, fill: c[1], weight: 900, spacing: 0.08 });
    },
  }),
];

export default stickers;
