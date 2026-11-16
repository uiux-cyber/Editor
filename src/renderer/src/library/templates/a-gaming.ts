import { kf, linear, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { TemplateDef } from '../types';
import { accentOn, an, atLeft, atRight, copy, darkPanel, inkOn, label, life, lightPanel, mutedOn, overlayBox, slotFill, title, vivid, vivids } from './_lib/a-kit';
import { alpha, chance, pick, safeArea } from './_lib/kit';

/* Gaming / streaming overlays: webcam frame, scoreboard and follower alert. No backgrounds. */

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'gaming-stream-overlay',
    name: 'Stream Cam Overlay',
    category: 'gaming',
    tags: ['gaming', 'stream', 'webcam', 'live', 'follower goal', 'overlay'],
    duration: 8,
    poster: 0.55,
    build: (env) => {
      const c = env.palette;
      const safe = safeArea(env);
      const box = overlayBox(env);
      const k = box.k;
      const camW = Math.round(env.portrait ? 560 : env.square ? 440 : 470);
      const camH = Math.round((camW * 9) / 16);
      const border = Math.round(8 * k);
      const handleFill = darkPanel(env);
      const handle = title(env, 'pixelqueen', { name: 'Handle', ...life(env, 0.8, 0.45), size: 38 * k, color: inkOn(env, handleFill), maxWidth: camW - 200 * k, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.45, 'fade-out', 0.3) });
      const live = label(env, 'Live', { name: 'Live', ...life(env, 0.95, 0.45), size: 22 * k, weight: 800, track: 0.14, color: inkOn(env, vivid(env)), anim: an('pop-in', 0.4, 'fade-out', 0.3) });
      const tagH = Math.round(handle.metrics.height + 22 * k);
      const liveW = Math.round(live.metrics.inkWidth + 30 * k);
      const liveH = Math.round(live.metrics.height + 10 * k);
      const tagW = Math.round(26 * k + handle.metrics.inkWidth + 24 * k + liveW + 20 * k);
      const tagY = Math.round(box.bottom - tagH / 2);
      const camY = Math.round(box.bottom - tagH - 14 * k - camH / 2);
      const camRight = !env.portrait && chance(env.rng, 0.5);
      const camLeft = camRight ? box.right - camW : box.left;
      const camX = Math.round(camLeft + camW / 2);
      handle.transform.y = tagY;
      atLeft(handle, camLeft + 26 * k);
      const liveX = Math.round(camLeft + tagW - 20 * k - liveW / 2);
      live.transform.y = tagY;
      live.transform.x = liveX;

      // Follower goal, top-left.
      const top = -env.ch / 2 + safe.my;
      const goalW = Math.round(Math.min(env.portrait ? safe.w : 560, safe.w));
      const goalLabel = label(env, 'Follower goal', { name: 'Goal label', ...life(env, 0.5, 0.45), size: 24 * k, weight: 700, track: 0.12, color: '#ffffff', style: { align: 'left', shadow: { color: '#00000080', blur: 10, x: 0, y: 2 } }, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const goalCount = label(env, '842 / 1,000', { name: 'Goal count', ...life(env, 0.6, 0.45), size: 24 * k, weight: 700, track: 0.04, color: '#ffffff', style: { align: 'right', shadow: { color: '#00000080', blur: 10, x: 0, y: 2 } }, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const barH = Math.round(18 * k);
      const labelY = Math.round(top + goalLabel.metrics.height / 2);
      const barY = Math.round(top + goalLabel.metrics.height + 14 * k + barH / 2);
      goalLabel.transform.y = labelY;
      goalCount.transform.y = labelY;
      atLeft(goalLabel, box.left);
      atRight(goalCount, box.left + goalW);
      const fillStart = 0.6;
      const fillEnd = 0.842;
      const fillT0 = 0.9;
      const fillDur = env.duration - fillT0 - 0.1;
      const fx = (s: number): number => Math.round(box.left + (goalW * s) / 2);

      return [
        makeShape('rect', { name: 'Cam border', ...life(env, 0.15, 0.05), width: camW + border * 2, height: camH + border * 2, radius: 22, x: camX, y: camY, fill: linear(45, vivids(env)[0], vivids(env)[1]), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.4) }),
        makeSlot({ name: 'Webcam', ...life(env, 0.25, 0.05), width: camW, height: camH, radius: 16, x: camX, y: camY, fill: slotFill(env), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.4) }),
        makeShape('rect', { name: 'Name tag', ...life(env, 0.55, 0.1), width: tagW, height: tagH, radius: Math.round(tagH / 2), x: camLeft + tagW / 2, y: tagY, fill: handleFill, shadow: { color: '#00000066', blur: 18, x: 0, y: 6 }, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.4) }),
        handle,
        makeShape('pill', { name: 'Live pill', ...life(env, 0.9, 0.45), width: liveW, height: liveH, x: liveX, y: tagY, fill: vivid(env), anim: an('pop-in', 0.4, 'pop-out', 0.3, 'fade-pulse', 1.6) }),
        live,
        goalLabel,
        goalCount,
        makeShape('pill', { name: 'Goal track', ...life(env, 0.4, 0.1), width: goalW, height: barH, x: box.left + goalW / 2, y: barY, fill: alpha('#000000', 0.45), stroke: { color: alpha('#ffffff', 0.35), width: 2 }, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.4) }),
        makeShape('pill', {
          name: 'Goal fill',
          start: fillT0,
          duration: fillDur,
          width: goalW,
          height: barH - 6,
          x: fx(fillStart),
          y: barY,
          fill: linear(0, vivids(env)[0], vivids(env)[1]),
          keyframes: { scaleX: [kf(0, fillStart), kf(0.8, fillStart, 'easeOutCubic'), kf(2.0, fillEnd)], x: [kf(0, fx(fillStart)), kf(0.8, fx(fillStart), 'easeOutCubic'), kf(2.0, fx(fillEnd))] },
          anim: an('fade-in', 0.4, 'fade-out', 0.35),
        }),
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'gaming-scoreboard',
    name: 'Match Scoreboard',
    category: 'gaming',
    tags: ['gaming', 'esports', 'score', 'match', 'scoreboard', 'tournament', 'overlay'],
    duration: 8,
    poster: 0.7,
    build: (env) => {
      const c = env.palette;
      const safe = safeArea(env);
      const k = env.portrait ? 1.15 : env.square ? 1.1 : 1.2;
      const sig = vivids(env);
      const teamA = sig[0];
      const teamB = pick(env.rng, [sig[1], sig[2]]);
      const center = lightPanel(env);
      const plate = darkPanel(env);
      const ink = inkOn(env, plate);
      const pad = Math.round(26 * k);
      const stripe = Math.round(12 * k);
      const scoreW = Math.round(84 * k);
      const timer = title(env, '12:45', { name: 'Timer', ...life(env, 0.35, 0.45), size: 46 * k, color: inkOn(env, center), maxWidth: 220 * k, maxLines: 1, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const timerW = Math.round(timer.metrics.inkWidth + pad * 2);
      const nameMax = Math.max(110, (Math.min(safe.w, 1400) - timerW - scoreW * 2) / 2 - pad * 2 - stripe);
      const nameA = label(env, 'Wolves', { name: 'Team A', ...life(env, 0.75, 0.45), size: 34 * k, weight: 800, track: 0.1, color: ink, maxWidth: nameMax, maxLines: 1, anim: an('fade-in', 0.35, 'fade-out', 0.3) });
      const nameB = label(env, 'Ravens', { name: 'Team B', ...life(env, 0.75, 0.45), size: 34 * k, weight: 800, track: 0.1, color: ink, maxWidth: nameMax, maxLines: 1, anim: an('fade-in', 0.35, 'fade-out', 0.3) });
      const nameW = Math.round(Math.max(nameA.metrics.inkWidth, nameB.metrics.inkWidth) + pad * 2);
      const h = Math.round(Math.max(timer.metrics.height, nameA.metrics.height) + 34 * k);
      const half = timerW / 2 + scoreW + nameW + stripe;
      const top = -env.ch / 2 + safe.my;
      const y = Math.round(top + h / 2 + 6);
      const xScoreA = Math.round(-timerW / 2 - scoreW / 2);
      const xScoreB = Math.round(timerW / 2 + scoreW / 2);
      const xNameA = Math.round(-timerW / 2 - scoreW - nameW / 2);
      const xNameB = Math.round(timerW / 2 + scoreW + nameW / 2);
      for (const t of [timer, nameA, nameB]) t.transform.y = y;
      nameA.transform.x = xNameA;
      nameB.transform.x = xNameB;
      const goalAt = Math.min(3.6, env.duration * 0.45);
      const scoreStyle = { size: 54 * k, color: ink, maxWidth: scoreW - 8, maxLines: 1 };
      const a1 = title(env, '2', { name: 'Score A', start: 0.6, duration: goalAt - 0.6, ...scoreStyle, x: xScoreA, y, anim: an('fade-in', 0.4, 'pop-out', 0.25) });
      const a2 = title(env, '3', { name: 'Score A (goal)', ...life(env, goalAt, 0.45), ...scoreStyle, x: xScoreA, y, anim: an('elastic-in', 0.8, 'fade-out', 0.3) });
      const b = title(env, '1', { name: 'Score B', ...life(env, 0.6, 0.45), ...scoreStyle, x: xScoreB, y, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const tabFill = sig[0];
      const round = label(env, 'Round 3', { name: 'Round', ...life(env, 0.9, 0.45), size: 20 * k, weight: 800, track: 0.18, color: inkOn(env, tabFill), anim: an('soft-slide-down-in', 0.4, 'fade-out', 0.3) });
      const roundH = Math.round(round.metrics.height + 12 * k);
      const roundW = Math.round(Math.max(round.metrics.inkWidth + 36 * k, timerW));
      round.transform.y = Math.round(y + h / 2 + 4 + roundH / 2);
      const divider = (x: number, n: string): ReturnType<typeof makeShape> =>
        makeShape('rect', { name: n, ...life(env, 0.7, 0.45), width: 2, height: Math.round(h * 0.5), x: Math.round(x), y, fill: alpha(ink, 0.25), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      return [
        makeShape('rect', { name: 'Plate', ...life(env, 0.3, 0.05), width: Math.round(half * 2), height: h, radius: Math.round(12 * k), y, fill: alpha(plate, 0.94), stroke: { color: alpha(ink, 0.16), width: 2 }, shadow: { color: '#00000066', blur: 24, x: 0, y: 8 }, anim: an('wipe-center-in', 0.55, 'wipe-center-out', 0.45) }),
        makeShape('rect', { name: 'Team A colour', ...life(env, 0.6, 0.15), width: stripe, height: h, x: Math.round(-half + stripe / 2), y, fill: teamA, anim: an('wipe-down-in', 0.4, 'fade-out', 0.3) }),
        makeShape('rect', { name: 'Team B colour', ...life(env, 0.6, 0.15), width: stripe, height: h, x: Math.round(half - stripe / 2), y, fill: teamB, anim: an('wipe-down-in', 0.4, 'fade-out', 0.3) }),
        divider(-timerW / 2 - scoreW, 'Divider A'),
        divider(timerW / 2 + scoreW, 'Divider B'),
        makeShape('rect', { name: 'Goal flash', start: goalAt - 0.05, duration: 1.2, width: scoreW, height: h - 8, x: xScoreA, y, fill: teamA, opacity: 0.9, anim: an('fade-in', 0.15, 'fade-out', 0.9) }),
        makeShape('rect', { name: 'Round tab', ...life(env, 0.8, 0.1), width: roundW, height: roundH + 8, radius: 6, y: round.transform.y - 4, fill: tabFill, anim: an('wipe-down-in', 0.4, 'wipe-up-out', 0.3) }),
        makeShape('rect', { name: 'Timer box', ...life(env, 0.15, 0), width: timerW, height: h + 12, radius: 8, y, fill: center, shadow: { color: '#00000066', blur: 24, x: 0, y: 8 }, anim: an('pop-in', 0.45, 'pop-out', 0.35) }),
        timer,
        nameA,
        nameB,
        a1,
        a2,
        b,
        round,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'gaming-follower-alert',
    name: 'New Follower Alert',
    category: 'gaming',
    tags: ['gaming', 'stream', 'alert', 'follower', 'notification', 'overlay'],
    duration: 5,
    poster: 0.45,
    build: (env) => {
      const c = env.palette;
      const safe = safeArea(env);
      const card = darkPanel(env);
      const ink = inkOn(env, card);
      const s = env.portrait ? 1.25 : 1;
      const icon = Math.round(130 * s);
      const pad = Math.round(34 * s);
      const maxText = Math.min(safe.w - icon - pad * 3, 760);
      const kicker = label(env, 'New follower', { name: 'Kicker', ...life(env, 0.6, 0.55), size: 26 * s, weight: 800, track: 0.2, color: accentOn(env, card, 4.5), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.4, 'fade-out', 0.25) });
      const user = title(env, '@nightowl_92', { name: 'Username', ...life(env, 0.7, 0.55), size: 66 * s, color: ink, maxWidth: maxText, maxLines: 1, style: { align: 'left' }, textAnim: { in: { id: 'char-pop-in', duration: 0.7 } }, anim: an(undefined, 0, 'fade-out', 0.25) });
      const thanks = copy(env, 'Thanks for the follow!', { name: 'Thanks', ...life(env, 1.0, 0.55), size: 28 * s, color: mutedOn(env, card), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.4, 'fade-out', 0.25) });
      const textH = kicker.metrics.height + 8 + user.metrics.height + 6 + thanks.metrics.height;
      const textW = Math.max(kicker.metrics.inkWidth, user.metrics.inkWidth, thanks.metrics.inkWidth);
      const cw = Math.round(pad + icon + pad + textW + pad + 10);
      const ch = Math.round(Math.max(icon, textH) + pad * 2);
      const top = -env.ch / 2 + safe.my;
      const cy = Math.round(env.portrait ? top + ch / 2 + 120 : Math.max(top + ch / 2, -env.ch * 0.24));
      const left = -cw / 2;
      const tx = left + pad + icon + pad;
      let y = cy - textH / 2;
      kicker.transform.y = Math.round(y + kicker.metrics.height / 2);
      y += kicker.metrics.height + 8;
      user.transform.y = Math.round(y + user.metrics.height / 2);
      y += user.metrics.height + 6;
      thanks.transform.y = Math.round(y + thanks.metrics.height / 2);
      for (const t of [kicker, user, thanks]) atLeft(t, tx);
      const ix = Math.round(left + pad + icon / 2);
      return [
        makeSticker('confetti-burst', { name: 'Confetti', start: 0.35, duration: Math.min(2.2, env.duration - 0.4), size: Math.round(ch * 2.4), x: ix, y: cy, colors: [c.primary, c.secondary, c.accent, lightPanel(env)], anim: an('fade-in', 0.2, 'fade-out', 0.6) }),
        makeShape('rect', { name: 'Glow border', ...life(env, 0.1, 0.05), width: cw + 8, height: ch + 8, radius: 32, y: cy, fill: linear(0, vivids(env)[0], vivids(env)[1]), anim: an('drop-in', 0.8, 'fly-up-out', 0.5) }),
        makeShape('rect', { name: 'Card', ...life(env, 0.1, 0.05), width: cw, height: ch, radius: 28, y: cy, fill: card, anim: an('drop-in', 0.8, 'fly-up-out', 0.5) }),
        makeShape('ellipse', { name: 'Icon disc', ...life(env, 0.4, 0.55), width: icon, height: icon, x: ix, y: cy, fill: alpha(c.primary, 0.22), anim: an('pop-in', 0.45, 'pop-out', 0.25) }),
        chance(env.rng, 0.5)
          ? makeSticker('bell-ring', { name: 'Bell', ...life(env, 0.5, 0.55), size: Math.round(icon * 0.78), x: ix, y: cy, colors: [c.secondary, c.primary, lightPanel(env)], anim: an('elastic-in', 0.8, 'pop-out', 0.25) })
          : makeSticker('neon-heart', { name: 'Heart', ...life(env, 0.5, 0.55), size: Math.round(icon * 0.8), x: ix, y: cy, colors: [c.primary, lightPanel(env)], anim: an('elastic-in', 0.8, 'pop-out', 0.25) }),
        kicker,
        user,
        thanks,
      ];
    },
  },
];

export default templates;
