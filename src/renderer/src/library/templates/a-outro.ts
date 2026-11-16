import { kf, linear, makeGenerator, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip, TextClip } from '@/core/types';
import type { TemplateDef } from '../types';
import { accentOn, an, atLeft, atRight, copy, inkOn, label, life, lightPanel, mutedOn, slotFill, softShade, title, tone } from './_lib/a-kit';
import { alpha, chance, pick, safeArea, stack } from './_lib/kit';

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'outro-thanks-burst',
    name: 'Thanks Burst',
    category: 'outro',
    tags: ['outro', 'thanks', 'subscribe', 'like', 'end screen', 'confetti', 'youtube'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const head = title(env, 'Thanks for watching!', { name: 'Title', ...life(env, 0.3), size: env.portrait ? 150 : 150, maxWidth: safe.w, maxLines: env.portrait ? 3 : 2, textAnim: { in: { id: 'word-spring-in', duration: 1.0 } }, anim: an(undefined, 0, 'zoom-soft-out', 0.45) });
      const sub = copy(env, pick(env.rng, ['See you in the next video', 'New episodes every Friday', 'Don’t forget to subscribe']), { name: 'Subtitle', ...life(env, 0.9, 0.1), size: 44, color: c.textMuted, maxWidth: safe.w, maxLines: 2, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const rowH = 170;
      const row = { transform: { y: 0 } };
      stack(
        [
          { clip: head, height: head.metrics.height, gap: 30 },
          { clip: sub, height: sub.metrics.height, gap: 70 },
          { clip: row, height: rowH },
        ],
        { centerY: 0 },
      );
      const subW = Math.round(rowH * 0.8 * 3.4);
      const icon = Math.round(rowH * 0.92);
      const gap = 40;
      const total = icon * 2 + subW + gap * 2;
      const x0 = -total / 2;
      const ry = row.transform.y;
      const blockH = head.metrics.height + 30 + sub.metrics.height + 70 + rowH;
      return [
        makeGenerator('confetti', { name: 'Confetti', duration: d, params: { colorBg: c.bg, colorA: c.primary, colorB: c.secondary, colorC: c.accent, colorD: tone(c.text, c.bg, 0.3), density: 0.38, size: 0.85, speed: 0.6 } }),
        softShade({ duration: d, start: 0, x: 0, y: 0, w: Math.min(env.cw * 1.4, safe.w + 900), h: blockH + 620, color: c.bg, strength: 1, plateau: true }),
        head,
        sub,
        makeSticker('like-thumb', { name: 'Like', ...life(env, 1.3, 0.25), size: icon, x: Math.round(x0 + icon / 2), y: ry, colors: [c.secondary, inkOn(env, c.secondary)], anim: an('pop-up-in', 0.5, 'pop-out', 0.3) }),
        makeSticker('subscribe-button', { name: 'Subscribe', ...life(env, 1.5, 0.15), size: Math.round(rowH * 0.8), x: Math.round(x0 + icon + gap + subW / 2), y: ry, colors: [c.primary, inkOn(env, c.primary)], anim: an('pop-up-in', 0.5, 'pop-out', 0.3) }),
        makeSticker('bell-ring', { name: 'Bell', ...life(env, 1.7, 0.05), size: icon, x: Math.round(x0 + icon * 1.5 + gap * 2 + subW), y: ry, colors: [c.accent, c.secondary, lightPanel(env)], anim: an('pop-up-in', 0.5, 'pop-out', 0.3) }),
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'outro-watch-next',
    name: 'Watch Next End Card',
    category: 'outro',
    tags: ['outro', 'end screen', 'end card', 'next video', 'subscribe', 'youtube', 'channel'],
    duration: 10,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const stacked = env.aspect === '9:16';
      const below = env.aspect === '4:5';
      const k = env.square ? 0.82 : below ? 0.92 : 1;
      // Channel block: avatar + name + subscribe pill.
      const av = Math.round((stacked ? 150 : 128) * k);
      const chName = title(env, 'Studio Nine', { name: 'Channel', ...life(env, 1.2, 0.2), size: 44 * k, maxWidth: 420, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.5, 'fade-out', 0.4) });
      const subTxt = label(env, 'Subscribe', { name: 'Subscribe label', ...life(env, 1.45, 0.2), size: 26 * k, weight: 700, track: 0.12, color: inkOn(env, c.primary), anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const pillW = Math.round(subTxt.metrics.inkWidth + 64 * k);
      const pillH = Math.round(subTxt.metrics.height + 24 * k);
      const chW = av + 26 + Math.max(chName.metrics.inkWidth, pillW);

      const centred = stacked || below;
      const head = title(env, 'Watch next', { name: 'Title', ...life(env, 0.3, 0.2), size: (centred ? 120 : 104) * k, maxWidth: centred ? safe.w : Math.max(260, safe.w - chW - 60), maxLines: 1, style: { align: centred ? 'center' : 'left' }, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const kick = label(env, 'More from the channel', { name: 'Kicker', ...life(env, 0.5, 0.2), size: 26 * Math.max(k, 0.9), weight: 600, track: 0.22, color: accentOn(env, c.bg), maxWidth: centred ? safe.w : Math.max(260, safe.w - chW - 60), maxLines: 1, style: { align: centred ? 'center' : 'left' }, anim: an('fade-in', 0.6, 'fade-out', 0.4) });

      // Video slots.
      const radius = pick(env.rng, [24, 10, 36]);
      const gap = Math.round(48 * k);
      const sw = Math.round(stacked ? safe.w * 0.9 : (safe.w - gap) / 2);
      const sh = Math.round((sw * 9) / 16);
      const captions = ['My 2026 desk setup tour', 'Editing tips for beginners'].map((t, i) =>
        copy(env, t, { name: `Caption ${i + 1}`, ...life(env, 0.9 + i * 0.2, 0.2), size: 32 * Math.max(k, 0.9), weight: 600, maxWidth: sw, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.5, 'fade-out', 0.4) }),
      );
      const capH = Math.max(...captions.map((t) => t.metrics.height));
      const headH = kick.metrics.height + 14 + head.metrics.height;
      const clips: Clip[] = [makeGenerator('gradient-flow', { name: 'Gradient', duration: d, params: { colorA: c.bg, colorB: c.bg2, colorC: tone(c.primary, c.bg, 0.55), angle: 35, flow: 0.6, speed: 0.5 } })];
      const slotsAt: { x: number; y: number }[] = [];
      let chX: number;
      let chY: number;
      if (stacked) {
        const total = headH + 60 + (sh + 18 + capH) * 2 + 44 + 60 + av;
        let y = -total / 2;
        kick.transform.y = Math.round(y + kick.metrics.height / 2);
        y += kick.metrics.height + 14;
        head.transform.y = Math.round(y + head.metrics.height / 2);
        y += head.metrics.height + 60;
        for (let i = 0; i < 2; i++) {
          slotsAt.push({ x: 0, y: Math.round(y + sh / 2) });
          y += sh + 18;
          captions[i].transform.y = Math.round(y + capH / 2);
          atLeft(captions[i], -sw / 2);
          y += capH + (i === 0 ? 44 : 60);
        }
        chX = -chW / 2;
        chY = Math.round(y + av / 2);
      } else if (below) {
        const total = headH + 56 + sh + 18 + capH + 70 + av;
        let y = -total / 2;
        kick.transform.y = Math.round(y + kick.metrics.height / 2);
        y += kick.metrics.height + 14;
        head.transform.y = Math.round(y + head.metrics.height / 2);
        y += head.metrics.height + 56;
        const left = -safe.w / 2;
        for (let i = 0; i < 2; i++) {
          const x = Math.round(left + sw / 2 + i * (sw + gap));
          slotsAt.push({ x, y: Math.round(y + sh / 2) });
          captions[i].transform.y = Math.round(y + sh + 18 + capH / 2);
          atLeft(captions[i], x - sw / 2);
        }
        y += sh + 18 + capH + 70;
        chX = -chW / 2;
        chY = Math.round(y + av / 2);
      } else {
        const rowH = Math.max(headH, av);
        const total = rowH + 56 + sh + 18 + capH;
        const top = -total / 2;
        const left = -safe.w / 2;
        const rowY = top + rowH / 2;
        kick.transform.y = Math.round(rowY - headH / 2 + kick.metrics.height / 2);
        head.transform.y = Math.round(rowY + headH / 2 - head.metrics.height / 2);
        atLeft(kick, left);
        atLeft(head, left);
        chX = safe.w / 2 - chW;
        chY = Math.round(rowY);
        const sy = Math.round(top + rowH + 56 + sh / 2);
        for (let i = 0; i < 2; i++) {
          const x = Math.round(left + sw / 2 + i * (sw + gap));
          slotsAt.push({ x, y: sy });
          captions[i].transform.y = Math.round(sy + sh / 2 + 18 + capH / 2);
          atLeft(captions[i], x - sw / 2);
        }
      }
      slotsAt.forEach((p, i) => {
        clips.push(
          makeSlot({ name: `Next video ${i + 1}`, ...life(env, 0.6 + i * 0.2, 0.1), width: sw, height: sh, radius, x: p.x, y: p.y, fill: slotFill(env), shadow: { color: alpha('#000000', c.dark ? 0.5 : 0.2), blur: 30, x: 0, y: 12 }, anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.45) }),
          makeShape('pill', { name: `Play ${i + 1}`, ...life(env, 1.1 + i * 0.2, 0.15), width: Math.round(118 * k), height: Math.round(52 * k), x: Math.round(p.x + sw / 2 - 30 - 59 * k), y: Math.round(p.y + sh / 2 - 30 - 26 * k), fill: alpha('#000000', 0.55), anim: an('pop-in', 0.4, 'fade-out', 0.3) }),
          makeShape('triangle', { name: `Play icon ${i + 1}`, ...life(env, 1.2 + i * 0.2, 0.15), width: Math.round(22 * k), height: Math.round(22 * k), rotation: 90, x: Math.round(p.x + sw / 2 - 30 - 59 * k), y: Math.round(p.y + sh / 2 - 30 - 26 * k), fill: '#ffffff', anim: an('pop-in', 0.4, 'fade-out', 0.3) }),
        );
      });
      const avX = Math.round(chX + av / 2);
      const tx = chX + av + 26;
      const textH = chName.metrics.height + 12 + pillH;
      chName.transform.y = Math.round(chY - textH / 2 + chName.metrics.height / 2);
      atLeft(chName, tx);
      const pillY = Math.round(chY + textH / 2 - pillH / 2);
      subTxt.transform.y = pillY;
      subTxt.transform.x = Math.round(tx + pillW / 2);
      clips.push(
        ...captions,
        kick,
        head,
        makeShape('ellipse', { name: 'Avatar ring', ...life(env, 1.0, 0.1), width: av + 12, height: av + 12, x: avX, y: chY, fill: linear(45, c.primary, c.secondary), anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        makeSlot({ name: 'Channel avatar', ...life(env, 1.05, 0.1), width: av, height: av, radius: av / 2, x: avX, y: chY, fill: slotFill(env), anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        chName,
        makeShape('pill', { name: 'Subscribe pill', ...life(env, 1.35, 0.1), width: pillW, height: pillH, x: Math.round(tx + pillW / 2), y: pillY, fill: c.primary, anim: an('pop-in', 0.45, 'pop-out', 0.3, 'pulse', 1.6) }),
        subTxt,
      );
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'outro-follow-more',
    name: 'Follow For More',
    category: 'outro',
    tags: ['outro', 'follow', 'social', 'creator', 'reels', 'profile', 'cta'],
    duration: 6,
    poster: 0.75,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const A = env.portrait ? 340 : 270;
      const handle = title(env, '@studio.nine', { name: 'Handle', ...life(env, 0.6, 0.1), size: env.portrait ? 104 : 92, maxWidth: safe.w, maxLines: 1, textAnim: { in: { id: 'char-rise-in', duration: 0.8 } }, anim: an(undefined, 0, 'fade-out', 0.4) });
      const tagline = copy(env, 'Follow for more design tips', { name: 'Tagline', ...life(env, 0.9, 0.1), size: env.portrait ? 44 : 40, color: c.textMuted, maxWidth: safe.w, maxLines: 2, anim: an('soft-slide-up-in', 0.6, 'fade-out', 0.4) });
      const btnLabel = label(env, 'Follow', { name: 'Follow label', start: 1.25, duration: 1.25, size: 34, weight: 700, track: 0.06, caps: false, color: inkOn(env, c.primary), anim: an('fade-in', 0.3, 'fade-out', 0.15) });
      const doneFill = c.secondary;
      const doneLabel = label(env, 'Following', { name: 'Following label', ...life(env, 2.55, 0.1), size: 34, weight: 700, track: 0.06, caps: false, color: inkOn(env, doneFill), anim: an('pop-in', 0.4, 'fade-out', 0.35) });
      const icon = 28;
      const btnW = Math.round(Math.max(btnLabel.metrics.inkWidth, doneLabel.metrics.inkWidth) + icon + 18 + 90);
      const btnH = Math.round(btnLabel.metrics.height + 34);
      const avatarBox = { transform: { y: 0 } };
      const btnBox = { transform: { y: 0 } };
      stack(
        [
          { clip: avatarBox, height: A + 24, gap: 46 },
          { clip: handle, height: handle.metrics.height, gap: 18 },
          { clip: tagline, height: tagline.metrics.height, gap: 50 },
          { clip: btnBox, height: btnH },
        ],
        { centerY: 0 },
      );
      const ay = avatarBox.transform.y;
      const by = btnBox.transform.y;
      const textX = Math.round((icon + 18) / 2);
      btnLabel.transform.y = by;
      btnLabel.transform.x = textX;
      doneLabel.transform.y = by;
      doneLabel.transform.x = textX;
      const iconX = Math.round(textX - Math.max(btnLabel.metrics.inkWidth, doneLabel.metrics.inkWidth) / 2 - 18 - icon / 2);
      const cursorAt = { x: Math.round(btnW * 0.3), y: Math.round(by + 40) };
      const cur: Partial<Record<'x' | 'y', ReturnType<typeof kf>[]>> = {
        x: [kf(0, cursorAt.x + 320, 'easeOutCubic'), kf(0.75, cursorAt.x)],
        y: [kf(0, cursorAt.y + 260, 'easeOutCubic'), kf(0.75, cursorAt.y)],
      };
      return [
        makeGenerator('bokeh', { name: 'Bokeh', duration: d, params: { colorBg: c.bg, colorA: tone(c.primary, c.bg, 0.4), colorB: tone(c.secondary, c.bg, 0.5), colorC: tone(c.accent, c.bg, 0.55), density: 0.8, size: 1, speed: 0.5 } }),
        makeShape('ellipse', { name: 'Avatar ring', ...life(env, 0.15, 0.1), width: A + 24, height: A + 24, y: ay, fill: linear(45, c.primary, c.secondary, c.accent), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.4, 'breathe', 4) }),
        makeSlot({ name: 'Avatar', ...life(env, 0.2, 0.1), width: A, height: A, radius: A / 2, y: ay, fill: slotFill(env), anim: an('elastic-in', 0.9, 'zoom-soft-out', 0.4) }),
        chance(env.rng, 0.5)
          ? makeSticker('floating-hearts', { name: 'Hearts', ...life(env, 2.6, 0.1), size: Math.round(A * 0.9), x: Math.round(A / 2 + 60), y: Math.round(ay - A * 0.15), colors: [c.secondary, tone(c.secondary, '#ffffff', 0.4)], anim: an('fade-in', 0.4, 'fade-out', 0.4) })
          : makeSticker('sparkles-twinkle', { name: 'Sparkles', ...life(env, 2.6, 0.1), size: Math.round(A * 0.6), x: Math.round(A / 2 + 30), y: Math.round(ay - A / 2 + 20), colors: [lightPanel(env), c.accent], anim: an('pop-in', 0.4, 'fade-out', 0.4) }),
        handle,
        tagline,
        makeShape('pill', { name: 'Follow button', start: 1.1, duration: 1.4, width: btnW, height: btnH, y: by, fill: c.primary, anim: an('pop-in', 0.45, 'pop-out', 0.15) }),
        makeShape('cross', { name: 'Plus', start: 1.25, duration: 1.25, width: icon, height: icon, x: iconX, y: by, fill: inkOn(env, c.primary), anim: an('fade-in', 0.3, 'fade-out', 0.15) }),
        btnLabel,
        makeShape('pill', { name: 'Following button', ...life(env, 2.5, 0.05), width: btnW, height: btnH, y: by, fill: doneFill, anim: an('pop-in', 0.4, 'zoom-soft-out', 0.35) }),
        makeShape('ellipse', { name: 'Check dot', ...life(env, 2.6, 0.1), width: icon, height: icon, x: iconX, y: by, fill: inkOn(env, doneFill), anim: an('pop-in', 0.4, 'fade-out', 0.3) }),
        doneLabel,
        makeSticker('cursor-click', { name: 'Cursor', start: 1.5, duration: 1.6, size: 110, x: cursorAt.x, y: cursorAt.y, keyframes: cur, colors: [lightPanel(env), '#14161f', c.accent], anim: an('fade-in', 0.2, 'fade-out', 0.35) }),
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'outro-credits-roll',
    name: 'Credits Roll',
    category: 'outro',
    tags: ['outro', 'credits', 'film', 'roll', 'cast', 'crew', 'ending'],
    duration: 12,
    poster: 0.35,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const rows: [string, string][] = [
        ['Directed by', 'Jordan Lee'],
        ['Produced by', 'Maya Chen'],
        ['Written by', 'Sam Rivera'],
        ['Cinematography', 'Priya Raman'],
        ['Editor', 'Alex Morgan'],
        ['Original music', 'Theo Laurent'],
        ['Sound design', 'Nina Okafor'],
        ['Colour', 'Leo Martins'],
        ['Production design', 'Ines Duarte'],
        ['Special thanks', 'Our community'],
      ];
      const pitch = env.portrait ? 70 : 66;
      const roleSize = env.portrait ? 26 : 24;
      const nameSize = env.portrait ? 42 : 40;
      const rollEnd = d - 3.2;
      const head = title(env, pick(env.rng, ['The Long Road Home', 'Northern Lights', 'A Year in Colour']), { name: 'Film title', start: 0, duration: rollEnd, size: env.portrait ? 96 : 92, maxWidth: safe.w, maxLines: 2 });
      const roles = label(env, rows.map((r) => r[0]).join('\n'), { name: 'Roles', start: 0, duration: rollEnd, size: roleSize, weight: 600, track: 0.16, color: mutedOn(env, c.bg), style: { align: 'right', lineHeight: pitch / roleSize } });
      const names = title(env, rows.map((r) => r[1]).join('\n'), { name: 'Names', start: 0, duration: rollEnd, size: nameSize, style: { align: 'left', lineHeight: pitch / nameSize } });
      // Fit the two columns into the width.
      const colGap = 28;
      const need = roles.metrics.width + names.metrics.width + colGap * 2;
      const fit = Math.min(1, safe.w / need);
      for (const t of [roles, names]) {
        t.transform.scaleX = fit;
        t.transform.scaleY = fit;
      }
      atRight(roles, -colGap * fit);
      atLeft(names, colGap * fit);
      const listH = rows.length * pitch * fit;
      const rollH = head.metrics.height + 90 + listH;
      // Roll offsets relative to the roll's top edge.
      const offHead = head.metrics.height / 2;
      const offList = head.metrics.height + 90 + listH / 2;
      const startTop = env.ch / 2 + 40;
      const endTop = -env.ch / 2 - rollH - 40;
      const move = (clip: TextClip, off: number): void => {
        clip.keyframes = { y: [kf(0, Math.round(startTop + off), 'linear'), kf(rollEnd, Math.round(endTop + off), 'linear')] };
        clip.transform.y = Math.round(startTop + off);
      };
      move(head, offHead);
      move(roles, offList);
      move(names, offList);
      const fadeH = Math.round(env.ch * 0.16);
      const thanks = title(env, 'Thank you for watching', { name: 'Thanks', ...life(env, rollEnd + 0.2), size: env.portrait ? 110 : 104, maxWidth: safe.w, maxLines: 2, textAnim: { in: { id: 'char-fade-in', duration: 1.0 } }, anim: an(undefined, 0, 'fade-out', 0.6) });
      return [
        makeShape('rect', { name: 'Backdrop', duration: d, width: env.cw, height: env.ch, fill: c.bg }),
        softShade({ start: 0, duration: d, x: 0, y: 0, w: env.cw * 1.4, h: env.ch * 1.3, color: c.bg2, strength: 0.7 }),
        head,
        roles,
        names,
        makeShape('rect', { name: 'Fade top', duration: rollEnd, width: env.cw, height: fadeH, y: Math.round(-env.ch / 2 + fadeH / 2), fill: linear(90, c.bg, alpha(c.bg, 0)) }),
        makeShape('rect', { name: 'Fade bottom', duration: rollEnd, width: env.cw, height: fadeH, y: Math.round(env.ch / 2 - fadeH / 2), fill: linear(90, alpha(c.bg, 0), c.bg) }),
        thanks,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'outro-minimal-signoff',
    name: 'Minimal Sign-off',
    category: 'outro',
    tags: ['outro', 'minimal', 'contact', 'website', 'brand', 'signoff', 'business'],
    duration: 6,
    poster: 0.6,
    build: (env) => {
      const c = env.palette;
      const d = env.duration;
      const safe = safeArea(env);
      const logo = env.portrait ? 170 : 140;
      const head = title(env, 'See you next time', { name: 'Title', ...life(env, 0.6, 0.1), size: env.portrait ? 140 : 130, maxWidth: safe.w, maxLines: env.portrait ? 3 : 2, textAnim: { in: { id: 'word-blur-in', duration: 1.1 } }, anim: an(undefined, 0, 'blur-out', 0.5) });
      const accent = accentOn(env, c.bg);
      const contacts = ['studionine.co', '@studionine', 'hello@studionine.co'].map((t, i) =>
        label(env, t, { name: `Contact ${i + 1}`, ...life(env, 1.4 + i * 0.15, 0.15), size: 30, weight: 500, track: 0.06, caps: false, color: c.textMuted, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.35) }),
      );
      const dot = 10;
      const rowGap = 54;
      const inRow = !env.portrait && contacts.reduce((s, t) => s + t.metrics.inkWidth + dot + 18, 0) + rowGap * 2 < safe.w;
      const logoBox = { transform: { y: 0 } };
      const rule = makeShape('rect', { name: 'Rule', ...life(env, 1.1, 0.2), width: 140, height: 4, radius: 2, fill: accent, anim: an('wipe-center-in', 0.6, 'wipe-center-out', 0.4) });
      const contactBox = { transform: { y: 0 } };
      const contactH = inRow ? contacts[0].metrics.height : contacts.reduce((s, t) => s + t.metrics.height, 0) + 16 * (contacts.length - 1);
      const total = stack(
        [
          { clip: logoBox, height: logo, gap: 56 },
          { clip: head, height: head.metrics.height, gap: 46 },
          { clip: rule, height: 4, gap: 46 },
          { clip: contactBox, height: contactH },
        ],
        { centerY: 0 },
      );
      const dots: Clip[] = [];
      if (inRow) {
        const widths = contacts.map((t) => t.metrics.inkWidth + dot + 18);
        let x = -(widths.reduce((a, b) => a + b, 0) + rowGap * 2) / 2;
        contacts.forEach((t, i) => {
          t.transform.y = contactBox.transform.y;
          dots.push(makeShape('ellipse', { name: `Dot ${i + 1}`, ...life(env, 1.35 + i * 0.15, 0.15), width: dot, height: dot, x: Math.round(x + dot / 2), y: contactBox.transform.y, fill: accent, anim: an('pop-in', 0.3, 'pop-out', 0.3) }));
          atLeft(t, x + dot + 18);
          x += widths[i] + rowGap;
        });
      } else {
        let y = contactBox.transform.y - contactH / 2;
        for (const t of contacts) {
          t.transform.y = Math.round(y + t.metrics.height / 2);
          y += t.metrics.height + 16;
        }
      }
      return [
        makeGenerator('soft-waves', { name: 'Waves', duration: d, params: { colorA: tone(c.primary, c.bg, 0.74), colorB: tone(c.secondary, c.bg, 0.82), colorBg: c.bg, amplitude: 0.8, speed: 0.6 } }),
        softShade({ start: 0, duration: d, x: 0, y: 0, w: Math.min(env.cw * 1.2, safe.w + 600), h: total + 420, color: c.bg, strength: 0.85 }),
        chance(env.rng, 0.5)
          ? makeShape('ellipse', { name: 'Logo ring', ...life(env, 0.2, 0.1), width: logo + 16, height: logo + 16, y: logoBox.transform.y, fill: '#00000000', stroke: { color: accent, width: 3 }, anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.4) })
          : makeShape('ellipse', { name: 'Logo ring', ...life(env, 0.2, 0.1), width: logo + 14, height: logo + 14, y: logoBox.transform.y, fill: linear(45, c.primary, c.secondary), anim: an('zoom-soft-in', 0.6, 'zoom-soft-out', 0.4, 'breathe', 4) }),
        makeSlot({ name: 'Logo', ...life(env, 0.3, 0.1), width: logo, height: logo, radius: logo / 2, y: logoBox.transform.y, fill: slotFill(env), anim: an('pop-in', 0.6, 'pop-out', 0.4) }),
        head,
        rule,
        ...dots,
        ...contacts,
      ];
    },
  },
];

export default templates;
