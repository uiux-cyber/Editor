import { Ease } from '@/core/easing';
import type { StickerDef } from '../types';
import {
  PI,
  TAU,
  alpha,
  bell,
  bell01,
  bevel,
  body,
  bump,
  button,
  check,
  circle,
  darken,
  fract,
  heart,
  hgrad,
  lgrad,
  lighten,
  noShadow,
  poly,
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

/** Thumbs-up glyph centred on the origin; `s` is the half size. */
function thumb(ctx: Ctx, s: number): void {
  ctx.beginPath();
  ctx.roundRect(-0.82 * s, -0.06 * s, 0.3 * s, 0.8 * s, 0.07 * s);
  ctx.moveTo(-0.36 * s, 0);
  ctx.lineTo(-0.04 * s, -0.62 * s);
  ctx.quadraticCurveTo(0.03 * s, -0.84 * s, 0.2 * s, -0.76 * s);
  ctx.quadraticCurveTo(0.38 * s, -0.66 * s, 0.31 * s, -0.36 * s);
  ctx.lineTo(0.24 * s, -0.1 * s);
  ctx.lineTo(0.64 * s, -0.1 * s);
  ctx.quadraticCurveTo(0.86 * s, -0.1 * s, 0.83 * s, 0.12 * s);
  ctx.lineTo(0.71 * s, 0.58 * s);
  ctx.quadraticCurveTo(0.67 * s, 0.74 * s, 0.5 * s, 0.74 * s);
  ctx.lineTo(-0.22 * s, 0.74 * s);
  ctx.quadraticCurveTo(-0.36 * s, 0.74 * s, -0.36 * s, 0.6 * s);
  ctx.closePath();
}

/** Scalloped seal outline used by the verified badge. */
const SEAL: number[] = [];
for (let i = 0; i < 144; i++) {
  const a = (i / 144) * TAU;
  const r = 97 * (1 + 0.07 * Math.cos(a * 12));
  SEAL.push(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
}

const stickers: StickerDef[] = [
  sticker({
    id: 'subscribe-button',
    name: 'Subscribe Button',
    category: 'social',
    keywords: 'subscribe button channel follow click cta bell',
    aspect: 3.4,
    period: 2.6,
    colors: ['#f5333f', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 110;
      const bh = 132;
      const press = bump(p, 0.5, 0.62);
      const u = seg(p, 0.62, 0.92);
      const s = 1 - 0.06 * press + Math.sin(u * TAU) * (1 - u) * 0.025;
      const rp = seg(p, 0.56, 0.96);
      ctx.translate(env.w / 2, 128);
      if (rp > 0 && rp < 1) {
        const g = 6 + 26 * Ease.easeOutCubic(rp);
        ctx.lineWidth = 6 * (1 - rp) + 1;
        ctx.strokeStyle = alpha(c[0], 0.7 * (1 - rp));
        rrect(ctx, -bw / 2 - g, -bh / 2 - g, bw + 2 * g, bh + 2 * g, 38 + g);
        ctx.stroke();
      }
      ctx.scale(s, s);
      button(ctx, -bw / 2, -bh / 2, bw, bh, 38, body(ctx, c[0], -bh / 2, bh / 2), alpha(darken(c[0], 0.55), 0.45));
      ctx.save();
      ctx.translate(-bw / 2 + 94, 2);
      ctx.rotate(Math.sin(u * TAU * 2) * (1 - u) * 0.4);
      ctx.fillStyle = c[1];
      bell(ctx, 40);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 31, 9, 0, PI);
      ctx.fill();
      ctx.restore();
      text(ctx, 'SUBSCRIBE', 56, 2, { size: 76, maxW: bw - 230, fill: c[1], spacing: 0.03 });
    },
  }),
  sticker({
    id: 'bell-ring',
    name: 'Ringing Bell',
    category: 'social',
    keywords: 'bell notification ring alert reminder subscribe ding',
    period: 1.8,
    colors: ['#ffc531', '#ff9d00', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const e = bump(p, 0.02, 0.8);
      const a = Math.sin(p * TAU * 4.5) * 0.3 * e;
      ctx.translate(128, 134);
      ctx.lineWidth = 9;
      for (let i = 0; i < 2; i++) {
        const r = 84 + i * 22;
        ctx.strokeStyle = alpha(c[1], e * (0.55 + 0.45 * Math.sin(p * TAU * 4.5 - i * 1.2)));
        ctx.beginPath();
        ctx.arc(0, -8, r, PI + 0.2, PI + 0.78);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -8, r, -0.78, -0.2);
        ctx.stroke();
      }
      ctx.translate(0, -78);
      ctx.rotate(a);
      ctx.translate(0, 78);
      ctx.fillStyle = darken(c[1], 0.12);
      ctx.beginPath();
      ctx.arc(-a * 46, 60, 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = lgrad(ctx, -50, -70, 56, 60, lighten(c[0], 0.4), c[0], c[1]);
      bell(ctx, 88);
      ctx.fill();
      ctx.fillStyle = alpha(c[2], 0.45);
      ctx.beginPath();
      ctx.ellipse(-24, -26, 9, 26, 0.32, 0, TAU);
      ctx.fill();
    },
  }),
  sticker({
    id: 'like-thumb',
    name: 'Like Thumbs Up',
    category: 'social',
    keywords: 'like thumbs up thumb approve good yes react',
    period: 1.6,
    colors: ['#2f80ff', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const u = seg(p, 0.08, 0.5);
      const k = Math.sin(u * PI);
      ctx.translate(128, 130);
      const b = seg(p, 0.2, 0.62);
      if (b > 0 && b < 1) {
        ctx.lineWidth = 8;
        ctx.strokeStyle = alpha(c[0], 1 - b);
        for (let i = 0; i < 7; i++) {
          const a = -PI / 2 + (i - 3) * 0.5;
          const r0 = 100 + 10 * Ease.easeOutCubic(b);
          const r1 = r0 + 12 * (1 - b) + 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.stroke();
        }
      }
      ctx.scale(1 + 0.08 * k, 1 + 0.08 * k);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -90, 90);
      circle(ctx, 0, 0, 90);
      ctx.fill();
      noShadow(ctx);
      ctx.rotate(-0.26 * Math.sin(u * TAU));
      ctx.scale(1 + 0.12 * k, 1 + 0.12 * k);
      ctx.fillStyle = c[1];
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 5;
      thumb(ctx, 56);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'follow-pill',
    name: 'Follow Button',
    category: 'social',
    keywords: 'follow button plus add profile subscribe cta',
    aspect: 2.9,
    period: 2.6,
    colors: ['#5b5bf7', '#b14cff', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 64;
      const bh = 124;
      ctx.translate(env.w / 2, 128);
      button(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, hgrad(ctx, -bw / 2, bw / 2, c[0], c[1]), alpha(darken(c[0], 0.5), 0.45));
      ctx.save();
      rrect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
      ctx.clip();
      sweep(ctx, -bw / 2, bw / 2, -bh / 2, bh / 2, seg(p, 0.5, 0.95), 80, 0.4);
      ctx.restore();
      const px = -bw / 2 + 64;
      ctx.fillStyle = c[2];
      circle(ctx, px, 0, 40);
      ctx.fill();
      ctx.save();
      ctx.translate(px, 0);
      ctx.rotate((Ease.easeInOutBack(seg(p, 0.1, 0.45)) * PI) / 2);
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(19, 0);
      ctx.moveTo(0, -19);
      ctx.lineTo(0, 19);
      ctx.stroke();
      ctx.restore();
      text(ctx, 'FOLLOW', 48, 2, { size: 74, maxW: bw - 190, fill: c[2], spacing: 0.04 });
    },
  }),
  sticker({
    id: 'share-arrow',
    name: 'Share Arrow',
    category: 'social',
    keywords: 'share forward send arrow repost button',
    period: 1.8,
    colors: ['#22c55e', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const k = bump(p, 0.1, 0.5);
      ctx.translate(128, 130);
      ctx.scale(1 + 0.03 * k, 1 + 0.03 * k);
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -94, 94);
      circle(ctx, 0, 0, 94);
      ctx.fill();
      noShadow(ctx);
      ctx.translate(-4 + 14 * k, 4 - 4 * k);
      ctx.strokeStyle = c[1];
      ctx.fillStyle = c[1];
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(-44, 42);
      ctx.quadraticCurveTo(-44, -12, 8, -12);
      ctx.stroke();
      ctx.lineWidth = 8;
      poly(ctx, [4, -50, 54, -12, 4, 26]);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'comment-typing',
    name: 'Typing Bubble',
    category: 'social',
    keywords: 'comment chat typing message bubble dots reply texting',
    aspect: 1.3,
    period: 1.4,
    colors: ['#2f80ff', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const W = env.w;
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.38));
      ctx.fillStyle = body(ctx, c[0], 40, 226);
      ctx.beginPath();
      ctx.roundRect(26, 40, W - 52, 148, 50);
      ctx.moveTo(64, 170);
      ctx.lineTo(124, 180);
      ctx.lineTo(50, 228);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      bevel(ctx, 26, 40, W - 52, 148, 50, 0.4);
      for (let i = 0; i < 3; i++) {
        const k = Math.max(0, wave(p, -i * 0.15));
        ctx.fillStyle = alpha(c[1], 0.65 + 0.35 * k);
        circle(ctx, W / 2 + (i - 1) * 54, 114 - 18 * k, 15);
        ctx.fill();
      }
    },
  }),
  sticker({
    id: 'live-pill',
    name: 'Live Badge',
    category: 'social',
    keywords: 'live stream streaming on air broadcast now recording',
    aspect: 2.3,
    period: 1.3,
    colors: ['#ff2d55', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 60;
      const bh = 126;
      ctx.translate(env.w / 2, 128);
      button(ctx, -bw / 2, -bh / 2, bw, bh, 36, body(ctx, c[0], -bh / 2, bh / 2), alpha(darken(c[0], 0.55), 0.45));
      const dx = -bw / 2 + 84;
      ctx.strokeStyle = alpha(c[1], 0.8 * (1 - p));
      ctx.lineWidth = 6;
      circle(ctx, dx, 0, 15 + 28 * Ease.easeOutCubic(p));
      ctx.stroke();
      ctx.fillStyle = c[1];
      circle(ctx, dx, 0, 19 + 3 * bell01(p));
      ctx.fill();
      text(ctx, 'LIVE', 54, 2, { size: 84, maxW: bw - 200, fill: c[1], spacing: 0.06 });
    },
  }),
  sticker({
    id: 'play-button',
    name: 'Play Button',
    category: 'social',
    keywords: 'play button video watch start media player',
    period: 2,
    colors: ['#ff3b5c', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      for (let i = 0; i < 2; i++) {
        const u = fract(p + i / 2);
        ctx.strokeStyle = alpha(c[0], 0.6 * (1 - u));
        ctx.lineWidth = 2 + 7 * (1 - u);
        circle(ctx, 0, 0, 68 + 44 * u);
        ctx.stroke();
      }
      const s = 1 + 0.03 * wave(p * 2);
      ctx.scale(s, s);
      shadow(ctx, 12, 6, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = body(ctx, c[0], -78, 78);
      circle(ctx, 0, 0, 78);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = c[1];
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 12;
      poly(ctx, [-18, -30, 34, 0, -18, 30]);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'notification-badge',
    name: 'Notification Badge',
    category: 'social',
    keywords: 'notification badge count alert unread bell new message',
    period: 2.2,
    colors: ['#1b1d29', '#ff2d55', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const u = seg(p, 0.08, 0.62);
      ctx.translate(122, 136);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -78, 78, lighten(c[0], 0.16), c[0]);
      rrect(ctx, -78, -78, 156, 156, 40);
      ctx.fill();
      noShadow(ctx);
      bevel(ctx, -78, -78, 156, 156, 40, 0.28);
      ctx.save();
      ctx.translate(0, -44);
      ctx.rotate(Math.sin(u * TAU * 3) * (1 - u) * 0.3);
      ctx.translate(0, 44);
      ctx.fillStyle = c[2];
      bell(ctx, 50);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 38, 10, 0, PI);
      ctx.fill();
      ctx.restore();
      const s = 1 + 0.24 * bump(p, 0.06, 0.32);
      ctx.translate(66, -66);
      ctx.scale(s, s);
      ctx.fillStyle = c[2];
      circle(ctx, 0, 0, 39);
      ctx.fill();
      ctx.fillStyle = body(ctx, c[1], -32, 32);
      circle(ctx, 0, 0, 32);
      ctx.fill();
      text(ctx, '3', 0, 1, { size: 42, fill: c[2], weight: 800 });
    },
  }),
  sticker({
    id: 'verified-badge',
    name: 'Verified Check',
    category: 'social',
    keywords: 'verified check tick badge official approved trusted',
    colors: ['#2f9bff', '#ffffff'],
    draw: (ctx, _p, _env, c) => {
      shadow(ctx, 14, 7, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = lgrad(ctx, 60, 30, 190, 226, lighten(c[0], 0.28), c[0], darken(c[0], 0.18));
      poly(ctx, SEAL);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 22;
      check(ctx, 128, 130, 46);
      ctx.stroke();
    },
  }),
  sticker({
    id: 'swipe-up',
    name: 'Swipe Up',
    category: 'social',
    keywords: 'swipe up story link chevron arrow more cta',
    period: 1.3,
    colors: ['#ff4f9a', '#ff8a00', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const lift = -7 * bell01(p);
      ctx.strokeStyle = vgrad(ctx, 30, 150, c[0], c[1]);
      ctx.lineWidth = 17;
      for (let i = 0; i < 3; i++) {
        const k = bell01(p + 0.5 + (i - 1) * 0.17);
        ctx.globalAlpha = 0.3 + 0.7 * k * k;
        const y = 62 + i * 36 + lift;
        ctx.beginPath();
        ctx.moveTo(128 - 46, y + 13);
        ctx.lineTo(128, y - 15);
        ctx.lineTo(128 + 46, y + 13);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      shadow(ctx, 10, 5, alpha(darken(c[0], 0.6), 0.35));
      ctx.fillStyle = hgrad(ctx, 30, 226, c[0], c[1]);
      rrect(ctx, 30, 178, 196, 54, 27);
      ctx.fill();
      noShadow(ctx);
      text(ctx, 'SWIPE UP', 128, 206, { size: 29, maxW: 160, fill: c[2], spacing: 0.08 });
    },
  }),
  sticker({
    id: 'link-in-bio',
    name: 'Link In Bio',
    category: 'social',
    keywords: 'link bio url website profile tag cta',
    aspect: 3.3,
    colors: ['#14161f', '#ffffff', '#22d3ee'],
    draw: (ctx, _p, env, c) => {
      const bw = env.w - 60;
      const bh = 120;
      ctx.translate(env.w / 2, 128);
      button(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, vgrad(ctx, -bh / 2, bh / 2, lighten(c[0], 0.16), c[0]));
      const ix = -bw / 2 + 62;
      ctx.fillStyle = lgrad(ctx, ix - 40, -40, ix + 40, 40, lighten(c[2], 0.3), c[2]);
      circle(ctx, ix, 0, 42);
      ctx.fill();
      ctx.save();
      ctx.translate(ix, 0);
      ctx.rotate(-PI / 4);
      ctx.strokeStyle = c[0];
      ctx.lineWidth = 8.5;
      rrect(ctx, -31, -11, 36, 22, 11);
      ctx.stroke();
      rrect(ctx, -5, -11, 36, 22, 11);
      ctx.stroke();
      ctx.restore();
      text(ctx, 'LINK IN BIO', 50, 2, { size: 62, maxW: bw - 190, fill: c[1], spacing: 0.05 });
    },
  }),
  sticker({
    id: 'cursor-click',
    name: 'Cursor Click',
    category: 'social',
    keywords: 'cursor click pointer mouse tap press select',
    period: 1.5,
    colors: ['#ffffff', '#14161f', '#ffc531'],
    draw: (ctx, p, _env, c) => {
      const tx = 96;
      const ty = 84;
      const u = seg(p, 0.3, 0.86);
      if (u > 0 && u < 1) {
        const e = Ease.easeOutCubic(u);
        ctx.strokeStyle = alpha(c[2], 1 - u);
        ctx.lineWidth = 3 + 6 * (1 - u);
        circle(ctx, tx, ty, 14 + 52 * e);
        ctx.stroke();
        ctx.strokeStyle = alpha(c[2], 0.6 * (1 - u));
        ctx.lineWidth = 4;
        circle(ctx, tx, ty, 6 + 34 * e);
        ctx.stroke();
      }
      const s = 1 - 0.12 * bump(p, 0.2, 0.44);
      ctx.translate(tx, ty);
      ctx.scale(1.36 * s, 1.36 * s);
      shadow(ctx, 10, 6);
      ctx.lineWidth = 9;
      ctx.strokeStyle = c[1];
      poly(ctx, [0, 0, 0, 92, 24, 71, 40, 108, 57, 101, 41, 64, 71, 64]);
      ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = c[0];
      ctx.fill();
    },
  }),
  sticker({
    id: 'star-rating',
    name: 'Five Star Rating',
    category: 'social',
    keywords: 'stars rating review five 5 feedback score best',
    aspect: 4.2,
    period: 3.2,
    colors: ['#ffc531', '#ff9d00', '#8b90a5'],
    draw: (ctx, p, env, c) => {
      const fade = p < 0.34 ? 1 : 1 - seg(p, 0.34, 0.44);
      for (let i = 0; i < 5; i++) {
        const t0 = 0.5 + i * 0.07;
        const f = p < 0.46 ? fade : seg(p, t0, t0 + 0.06);
        const s = 1 + 0.22 * bump(p, t0, t0 + 0.16);
        ctx.save();
        ctx.translate(env.w / 2 + (i - 2) * 196, 132);
        ctx.scale(s, s);
        ctx.lineWidth = 14;
        star(ctx, 0, 0, 5, 84, 37);
        ctx.fillStyle = ctx.strokeStyle = alpha(c[2], 0.5);
        if (f < 1) {
          ctx.globalAlpha = 1 - f;
          ctx.fill();
          ctx.stroke();
        }
        if (f > 0) {
          ctx.globalAlpha = f;
          ctx.fillStyle = ctx.strokeStyle = vgrad(ctx, -84, 84, lighten(c[0], 0.25), c[0], c[1]);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    },
  }),
  sticker({
    id: 'new-post',
    name: 'New Post',
    category: 'social',
    keywords: 'new post update upload announcement feed sparkle',
    aspect: 2.7,
    period: 2.2,
    colors: ['#ff4f9a', '#ffb020', '#ffffff'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 84;
      const bh = 116;
      ctx.translate(env.w / 2, 132);
      button(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, hgrad(ctx, -bw / 2, bw / 2, c[0], c[1]), alpha(darken(c[0], 0.5), 0.4));
      text(ctx, 'NEW POST', 0, 2, { size: 70, maxW: bw - 90, fill: c[2], spacing: 0.04 });
      twinkle(ctx, bw / 2 - 16, -bh / 2 - 6, 38, fract(p + 0.25), c[2]);
      twinkle(ctx, -bw / 2 + 10, bh / 2 - 2, 26, fract(p + 0.7), c[2]);
      twinkle(ctx, -bw / 2 + 58, -bh / 2 - 14, 18, fract(p * 2), c[2]);
    },
  }),
  sticker({
    id: 'hashtag-trending',
    name: 'Trending Tag',
    category: 'social',
    keywords: 'trending hashtag viral popular fyp tag up',
    aspect: 3.5,
    colors: ['#14161f', '#ff5c3a', '#ffffff'],
    draw: (ctx, _p, env, c) => {
      const bw = env.w - 60;
      const bh = 120;
      ctx.translate(env.w / 2, 128);
      button(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, vgrad(ctx, -bh / 2, bh / 2, lighten(c[0], 0.16), c[0]));
      const ix = -bw / 2 + 62;
      ctx.fillStyle = lgrad(ctx, ix - 40, -40, ix + 40, 40, lighten(c[1], 0.3), c[1]);
      circle(ctx, ix, 0, 42);
      ctx.fill();
      ctx.strokeStyle = c[2];
      ctx.lineWidth = 8;
      poly(ctx, [ix - 24, 15, ix - 7, -2, ix + 4, 9, ix + 22, -11], false);
      ctx.stroke();
      poly(ctx, [ix + 8, -15, ix + 24, -15, ix + 24, 1], false);
      ctx.stroke();
      text(ctx, '#TRENDING', 50, 2, { size: 62, maxW: bw - 190, fill: c[2], spacing: 0.04 });
    },
  }),
  sticker({
    id: 'bookmark-save',
    name: 'Save Bookmark',
    category: 'social',
    keywords: 'save bookmark favorite keep later collection star',
    period: 1.8,
    colors: ['#ffb020', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      const u = seg(p, 0.08, 0.5);
      const k = Math.sin(u * PI);
      ctx.translate(128, 128 - 10 * k);
      ctx.rotate(Math.sin(u * TAU) * 0.1);
      ctx.scale(1 + 0.08 * k, 1 + 0.08 * k);
      shadow(ctx, 14, 8, alpha(darken(c[0], 0.6), 0.4));
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -60, -90, 60, 90, lighten(c[0], 0.3), c[0], darken(c[0], 0.14));
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(-58, -70);
      ctx.quadraticCurveTo(-58, -88, -40, -88);
      ctx.lineTo(40, -88);
      ctx.quadraticCurveTo(58, -88, 58, -70);
      ctx.lineTo(58, 90);
      ctx.lineTo(0, 48);
      ctx.lineTo(-58, 90);
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle = c[1];
      ctx.lineWidth = 6;
      star(ctx, 0, -24, 5, 30, 13);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'like-counter',
    name: 'Like Counter',
    category: 'social',
    keywords: 'likes heart count love notification popular 99',
    aspect: 1.9,
    period: 1.2,
    colors: ['#ff2d55', '#ffffff', '#14161f'],
    draw: (ctx, p, env, c) => {
      const bw = env.w - 60;
      const bh = 124;
      ctx.translate(env.w / 2, 128);
      button(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, vgrad(ctx, -bh / 2, bh / 2, c[1], darken(c[1], 0.08)));
      const beat = Math.max(0, Math.sin(p * PI * 4)) * (p < 0.5 ? 1 : 0);
      ctx.fillStyle = vgrad(ctx, -40, 44, lighten(c[0], 0.25), c[0]);
      heart(ctx, -bw / 2 + 84, 4, 40 * (1 + 0.16 * beat));
      ctx.fill();
      text(ctx, '99+', 58, 2, { size: 78, maxW: bw - 200, fill: c[2], weight: 800 });
    },
  }),
  sticker({
    id: 'paper-plane-send',
    name: 'Send Paper Plane',
    category: 'social',
    keywords: 'send message dm paper plane direct share mail',
    period: 2.4,
    colors: ['#7c5cff', '#b9a6ff'],
    draw: (ctx, p, _env, c) => {
      ctx.save();
      ctx.lineWidth = 9;
      ctx.setLineDash([4, 22]);
      ctx.lineDashOffset = -p * 26;
      ctx.strokeStyle = lgrad(ctx, 106, 150, 22, 226, alpha(c[1], 0.95), alpha(c[1], 0));
      ctx.beginPath();
      ctx.moveTo(108, 152);
      ctx.quadraticCurveTo(84, 204, 20, 226);
      ctx.stroke();
      ctx.restore();
      ctx.translate(140 + 5 * wave(p, 0.25), 114 + 7 * wave(p));
      ctx.rotate(0.05 * wave(p, 0.2));
      const s = 92;
      ctx.lineWidth = 5;
      ctx.fillStyle = ctx.strokeStyle = darken(c[0], 0.28);
      poly(ctx, [-0.26 * s, 0.22 * s, -0.2 * s, 0.82 * s, 0.1 * s, 0.4 * s]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, -80, -40, 60, 40, lighten(c[1], 0.45), c[1]);
      poly(ctx, [-0.94 * s, -0.06 * s, 0.92 * s, -0.82 * s, -0.26 * s, 0.22 * s]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle = lgrad(ctx, 0, -60, 30, 70, lighten(c[0], 0.2), c[0]);
      poly(ctx, [0.92 * s, -0.82 * s, 0.2 * s, 0.86 * s, -0.26 * s, 0.22 * s]);
      ctx.fill();
      ctx.stroke();
    },
  }),
  sticker({
    id: 'sound-on',
    name: 'Sound On',
    category: 'social',
    keywords: 'sound on volume speaker audio unmute music listen',
    period: 1.5,
    colors: ['#14161f', '#ffffff'],
    draw: (ctx, p, _env, c) => {
      ctx.translate(128, 128);
      shadow(ctx, 14, 7);
      ctx.fillStyle = vgrad(ctx, -94, 94, lighten(c[0], 0.2), c[0]);
      circle(ctx, 0, 0, 94);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = ctx.strokeStyle = c[1];
      ctx.lineWidth = 9;
      poly(ctx, [-58, -15, -38, -15, -12, -38, -12, 38, -38, 15, -58, 15]);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 10;
      for (let i = 0; i < 3; i++) {
        const k = bell01(p - i * 0.2);
        ctx.strokeStyle = alpha(c[1], 0.25 + 0.75 * k * k);
        ctx.beginPath();
        ctx.arc(-8, 0, 24 + i * 21, -0.72, 0.72);
        ctx.stroke();
      }
    },
  }),
];

export default stickers;
