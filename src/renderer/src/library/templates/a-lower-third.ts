import { linear, makeShape, makeSlot, makeSticker } from '@/core/factory';
import type { Clip } from '@/core/types';
import type { TemplateDef, TemplateEnv } from '../types';
import { accentOn, an, atLeft, copy, footageShadow, inkOn, label, life, lightPanel, mutedOn, overlayBox, slotFill, softShade, title, vivid, vividOn, vivids } from './_lib/a-kit';
import { alpha, chance, pick } from './_lib/kit';

/*
 * Lower-thirds are overlays: no background, anchored bottom-left of the safe area (raised on
 * vertical video). Timing convention: panels leave during the last ~0.55 s, the text on them
 * has already left by then so nothing floats over bare footage.
 */

const TAGS = ['lower third', 'name', 'title', 'overlay', 'caption'];
const panelShadow = (dark: boolean): { color: string; blur: number; x: number; y: number } => ({ color: alpha('#000000', dark ? 0.45 : 0.24), blur: 26, x: 0, y: 10 });
/** Panel timing: in at `s`, out during the last 0.55 s. */
const panelLife = (env: TemplateEnv, s: number): { start: number; duration: number } => life(env, s, 0.1);
/** Text timing: in at `s`, gone before the panels start leaving. */
const textLife = (env: TemplateEnv, s: number): { start: number; duration: number } => life(env, s, 0.55);

const templates: TemplateDef[] = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-classic-bar',
    name: 'Classic Name Bar',
    category: 'lower-third',
    tags: [...TAGS, 'classic', 'interview', 'corporate'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const sig = vivids(env);
      const panel = pick(env.rng, [lightPanel(env), lightPanel(env), sig[0]]);
      const strip = panel === sig[0] ? sig[1] : vividOn(env, panel);
      const padX = Math.round(34 * k);
      const barW = Math.round(12 * k);
      const maxText = box.maxW - padX * 2 - barW;
      const name = title(env, 'Jordan Lee', { name: 'Name', ...textLife(env, 0.55), size: 62 * k, color: inkOn(env, panel), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const role = label(env, 'Product Designer', { name: 'Role', ...textLife(env, 0.8), size: 26 * k, weight: 600, track: 0.16, color: inkOn(env, strip), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.4, 'fade-out', 0.3) });
      const nameH = Math.round(name.metrics.height + 34 * k);
      const roleH = Math.round(role.metrics.height + 20 * k);
      const panelW = Math.round(Math.max(name.metrics.inkWidth, role.metrics.inkWidth) + padX * 2);
      const roleW = Math.round(role.metrics.inkWidth + padX * 2);
      const top = box.bottom - nameH - roleH;
      const pl = box.left + barW;
      name.transform.y = Math.round(top + nameH / 2);
      role.transform.y = Math.round(top + nameH + roleH / 2);
      atLeft(name, pl + padX);
      atLeft(role, pl + padX);
      return [
        makeShape('rect', { name: 'Name panel', ...panelLife(env, 0.3), width: panelW, height: nameH, x: pl + panelW / 2, y: name.transform.y, fill: panel, shadow: panelShadow(c.dark), anim: an('wipe-right-in', 0.55, 'wipe-left-out', 0.45) }),
        makeShape('rect', { name: 'Role strip', ...life(env, 0.55, 0.2), width: roleW, height: roleH, x: pl + roleW / 2, y: role.transform.y, fill: strip, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.35) }),
        makeShape('rect', { name: 'Accent bar', ...life(env, 0.15, 0.02), width: barW, height: nameH + roleH, x: box.left + barW / 2, y: Math.round(top + (nameH + roleH) / 2), fill: panel === sig[0] ? sig[2] : strip === sig[0] ? sig[1] : sig[0], anim: an('wipe-down-in', 0.4, 'wipe-up-out', 0.35) }),
        name,
        role,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-clean-line',
    name: 'Clean Line',
    category: 'lower-third',
    tags: [...TAGS, 'minimal', 'documentary', 'clean'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const gapX = Math.round(30 * k);
      const maxText = box.maxW - gapX - 8;
      const tagFill = pick(env.rng, vivids(env).slice(0, 2));
      const name = title(env, 'Dr. Amara Okafor', {
        name: 'Name',
        ...life(env, 0.45, 0.25),
        size: 64 * k,
        color: '#ffffff',
        maxWidth: maxText,
        maxLines: 1,
        style: { align: 'left', shadow: footageShadow },
        anim: an('mask-right-in', 0.6, 'mask-left-out', 0.45),
      });
      const role = label(env, 'Marine Biologist', {
        name: 'Role',
        ...life(env, 0.75, 0.2),
        size: 25 * k,
        weight: 700,
        track: 0.16,
        color: inkOn(env, tagFill),
        maxWidth: maxText - 30,
        maxLines: 1,
        style: { align: 'left', background: { color: tagFill, opacity: 1, padX: 14, padY: 6, radius: 4 } },
        anim: an('soft-slide-right-in', 0.45, 'fade-out', 0.3),
      });
      const gap = Math.round(22 * k);
      const roleBoxH = role.metrics.height + 12;
      const total = name.metrics.height + gap + roleBoxH;
      const top = box.bottom - total;
      name.transform.y = Math.round(top + name.metrics.height / 2);
      role.transform.y = Math.round(top + name.metrics.height + gap + roleBoxH / 2);
      const tx = box.left + 8 + gapX;
      atLeft(name, tx);
      atLeft(role, tx + 14);
      const textW = Math.max(name.metrics.inkWidth, role.metrics.inkWidth + 28);
      return [
        softShade({ ...life(env, 0.2, 0.1), x: Math.round(tx + textW / 2 - 30), y: Math.round(top + total / 2), w: textW * 1.7 + 260, h: total * 2.6 + 80, color: '#000000', strength: 0.4, anim: an('fade-in', 0.6, 'fade-out', 0.5) }),
        makeShape('rect', { name: 'Line', ...life(env, 0.2, 0.05), width: Math.round(8 * k), height: Math.round(total + 8), radius: 4, x: box.left + 4, y: Math.round(top + total / 2), fill: vivid(env), anim: an('wipe-up-in', 0.5, 'wipe-down-out', 0.4) }),
        name,
        role,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-avatar-pill',
    name: 'Avatar Pill',
    category: 'lower-third',
    tags: [...TAGS, 'social', 'creator', 'profile', 'avatar', 'verified'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const fill = lightPanel(env);
      const ink = inkOn(env, fill);
      const withBadge = chance(env.rng, 0.7);
      const badge = withBadge ? Math.round(40 * k) : 0;
      const name = title(env, 'Maya Chen', { name: 'Name', ...textLife(env, 0.6), size: 50 * k, color: ink, maxWidth: box.maxW * 0.6, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const role = copy(env, 'Founder, Studio Nine', { name: 'Role', ...textLife(env, 0.75), size: 28 * k, color: mutedOn(env, fill), maxWidth: box.maxW * 0.6, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const gap = Math.round(4 * k);
      const textH = name.metrics.height + gap + role.metrics.height;
      const av = Math.round(textH + 22 * k);
      const pad = Math.round(10 * k);
      const pillH = av + pad * 2;
      const textW = Math.max(name.metrics.inkWidth + badge + 14, role.metrics.inkWidth);
      const pillW = Math.round(pad + av + 26 * k + textW + 48 * k);
      const cy = Math.round(box.bottom - pillH / 2);
      const tx = box.left + pad + av + 26 * k;
      name.transform.y = Math.round(cy - textH / 2 + name.metrics.height / 2);
      role.transform.y = Math.round(cy + textH / 2 - role.metrics.height / 2);
      atLeft(name, tx);
      atLeft(role, tx);
      const ringFill = chance(env.rng, 0.5) ? linear(45, c.primary, c.secondary) : accentOn(env, fill, 2);
      const badgeColor = accentOn(env, fill, 2);
      const clips: Clip[] = [
        makeShape('pill', { name: 'Pill', ...panelLife(env, 0.3), width: pillW, height: pillH, x: box.left + pillW / 2, y: cy, fill, shadow: panelShadow(c.dark), anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.45) }),
        makeShape('ellipse', { name: 'Avatar ring', ...life(env, 0.2, 0.05), width: av + 8, height: av + 8, x: box.left + pad + av / 2, y: cy, fill: ringFill, anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        makeSlot({ name: 'Avatar', ...life(env, 0.25, 0.05), width: av - 6, height: av - 6, radius: (av - 6) / 2, x: box.left + pad + av / 2, y: cy, fill: slotFill(env), anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        name,
      ];
      if (withBadge) {
        clips.push(makeSticker('verified-badge', { name: 'Verified', ...textLife(env, 0.9), size: badge, x: Math.round(tx + name.metrics.inkWidth + 12 + badge / 2), y: name.transform.y, colors: [badgeColor, inkOn(env, badgeColor)], anim: an('pop-in', 0.45, 'pop-out', 0.3) }));
      }
      clips.push(role);
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-two-tier',
    name: 'Two-Tier Blocks',
    category: 'lower-third',
    tags: [...TAGS, 'bold', 'blocks', 'sports', 'event'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const swap = chance(env.rng, 0.35);
      const top1 = swap ? lightPanel(env) : vivid(env);
      const top2 = swap ? vivid(env) : lightPanel(env);
      const padX = Math.round(30 * k);
      const offset = Math.round(40 * k);
      const name = title(env, 'Sam Rivera', { name: 'Name', ...textLife(env, 0.45), size: 72 * k, color: inkOn(env, top1), maxWidth: box.maxW - padX * 2, maxLines: 1, style: { align: 'left' }, anim: an('mask-up-in', 0.5, 'mask-down-out', 0.35) });
      const role = label(env, 'Head Coach  ·  City Tigers', { name: 'Role', ...textLife(env, 0.7), size: 27 * k, weight: 600, track: 0.12, color: inkOn(env, top2), maxWidth: box.maxW - padX * 2 - offset, maxLines: 1, style: { align: 'left' }, anim: an('mask-up-in', 0.45, 'mask-down-out', 0.35) });
      const h1 = Math.round(name.metrics.height + 28 * k);
      const h2 = Math.round(role.metrics.height + 26 * k);
      const w1 = Math.round(name.metrics.inkWidth + padX * 2);
      const w2 = Math.round(role.metrics.inkWidth + padX * 2);
      const y2 = Math.round(box.bottom - h2 / 2);
      const y1 = Math.round(box.bottom - h2 - h1 / 2 + 4);
      name.transform.y = y1;
      role.transform.y = y2;
      atLeft(name, box.left + padX);
      atLeft(role, box.left + offset + padX);
      const sq = Math.round(24 * k);
      return [
        makeShape('rect', { name: 'Role block', ...panelLife(env, 0.45), width: w2, height: h2, x: box.left + offset + w2 / 2, y: y2, fill: top2, shadow: panelShadow(c.dark), anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.4) }),
        makeShape('rect', { name: 'Name block', ...panelLife(env, 0.2), width: w1, height: h1, x: box.left + w1 / 2, y: y1, fill: top1, anim: an('wipe-right-in', 0.5, 'wipe-left-out', 0.45) }),
        makeShape('rect', { name: 'Corner', ...textLife(env, 0.65), width: sq, height: sq, x: box.left + w1 - sq / 2, y: y1 - h1 / 2 - sq / 2 + 2, fill: vivids(env)[1], anim: an('pop-in', 0.4, 'pop-out', 0.3) }),
        name,
        role,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-speaker-card',
    name: 'Speaker Card',
    category: 'lower-third',
    tags: [...TAGS, 'speaker', 'conference', 'keynote', 'card', 'business'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const panel = lightPanel(env);
      const ink = inkOn(env, panel);
      const pad = Math.round(30 * k);
      const ini = Math.round(92 * k);
      const maxText = box.maxW - pad * 3 - ini;
      const event = label(env, 'Keynote  ·  Design Summit 2026', { name: 'Event', ...textLife(env, 0.75), size: 22 * k, weight: 700, track: 0.16, color: accentOn(env, panel, 4.5), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('fade-in', 0.5, 'fade-out', 0.3) });
      const name = title(env, 'Priya Raman', { name: 'Name', ...textLife(env, 0.6), size: 54 * k, color: ink, maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.3) });
      const role = copy(env, 'Chief Technology Officer', { name: 'Role', ...textLife(env, 0.85), size: 28 * k, color: mutedOn(env, panel), maxWidth: maxText, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.3) });
      const g1 = Math.round(10 * k);
      const g2 = Math.round(6 * k);
      const textH = event.metrics.height + g1 + name.metrics.height + g2 + role.metrics.height;
      const cardH = Math.round(Math.max(textH, ini) + pad * 2);
      const textW = Math.max(event.metrics.inkWidth, name.metrics.inkWidth, role.metrics.inkWidth);
      const cardW = Math.round(pad + ini + pad + textW + pad + 10);
      const cy = Math.round(box.bottom - cardH / 2);
      const tx = box.left + pad + ini + pad;
      let y = cy - textH / 2;
      event.transform.y = Math.round(y + event.metrics.height / 2);
      y += event.metrics.height + g1;
      name.transform.y = Math.round(y + name.metrics.height / 2);
      y += name.metrics.height + g2;
      role.transform.y = Math.round(y + role.metrics.height / 2);
      for (const t of [event, name, role]) atLeft(t, tx);
      const mono = accentOn(env, panel, 2);
      const usePhoto = chance(env.rng, 0.5);
      const initials = title(env, 'PR', { name: 'Initials', ...textLife(env, 0.5), size: 40 * k, color: inkOn(env, mono), maxWidth: ini - 16, maxLines: 1, x: box.left + pad + ini / 2, y: cy, anim: an('pop-in', 0.45, 'pop-out', 0.3) });
      return [
        makeShape('rect', { name: 'Card', ...panelLife(env, 0.2), width: cardW, height: cardH, radius: 22, x: box.left + cardW / 2, y: cy, fill: panel, shadow: panelShadow(c.dark), anim: an('soft-slide-up-in', 0.55, 'soft-slide-down-out', 0.45) }),
        makeShape('rect', { name: 'Top edge', ...life(env, 0.5, 0.45), width: cardW - 44, height: 6, radius: 3, x: box.left + cardW / 2, y: cy - cardH / 2 + 3, fill: mono === c.primary ? linear(0, c.primary, c.secondary) : mono, anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.3) }),
        ...(usePhoto
          ? [makeSlot({ name: 'Headshot', ...life(env, 0.4, 0.45), width: ini, height: ini, radius: ini / 2, x: box.left + pad + ini / 2, y: cy, fill: slotFill(env), anim: an('pop-in', 0.5, 'pop-out', 0.3) })]
          : [makeShape('ellipse', { name: 'Monogram', ...life(env, 0.4, 0.45), width: ini, height: ini, x: box.left + pad + ini / 2, y: cy, fill: mono, anim: an('pop-in', 0.5, 'pop-out', 0.3) }), initials]),
        event,
        name,
        role,
      ];
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-location-pin',
    name: 'Location Pin',
    category: 'lower-third',
    tags: ['lower third', 'location', 'travel', 'place', 'map', 'pin', 'vlog'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const pinW = Math.round(54 * k);
      const gapX = Math.round(26 * k);
      const maxText = box.maxW - pinW - gapX - 60;
      const boxed = chance(env.rng, 0.5);
      const fill = lightPanel(env);
      const textInk = boxed ? inkOn(env, fill) : '#ffffff';
      const place = title(env, 'Lisbon, Portugal', {
        name: 'Place',
        ...textLife(env, 0.6),
        size: 60 * k,
        color: textInk,
        maxWidth: maxText,
        maxLines: 1,
        style: { align: 'left', ...(boxed ? {} : { shadow: footageShadow }) },
        anim: an('mask-right-in', 0.55, 'fade-out', 0.3),
      });
      const when = label(env, 'Day 3  ·  Golden hour', {
        name: 'Detail',
        ...textLife(env, 0.85),
        size: 24 * k,
        weight: 600,
        track: 0.2,
        color: boxed ? mutedOn(env, fill) : '#ffffffe6',
        maxWidth: maxText,
        maxLines: 1,
        style: { align: 'left', ...(boxed ? {} : { shadow: footageShadow }) },
        anim: an('fade-in', 0.5, 'fade-out', 0.3),
      });
      const gap = Math.round(14 * k);
      const pad = boxed ? Math.round(26 * k) : 0;
      const textH = place.metrics.height + gap + 4 + gap + when.metrics.height;
      const cy = Math.round(box.bottom - pad - textH / 2);
      const x0 = box.left + pad;
      const tx = x0 + pinW + gapX;
      place.transform.y = Math.round(cy - textH / 2 + place.metrics.height / 2);
      when.transform.y = Math.round(cy + textH / 2 - when.metrics.height / 2);
      atLeft(place, tx);
      atLeft(when, tx);
      const textW = Math.max(place.metrics.inkWidth, when.metrics.inkWidth);
      const pinY = place.transform.y;
      const pinColor = boxed ? vividOn(env, fill) : accentOn(env, '#202020');
      const ruleW = Math.round(Math.min(textW, 260 * k));
      const clips: Clip[] = [];
      if (boxed) {
        const bw = Math.round(pad * 2 + pinW + gapX + textW + 10);
        clips.push(makeShape('rect', { name: 'Panel', ...panelLife(env, 0.2), width: bw, height: Math.round(textH + pad * 2), radius: 18, x: box.left + bw / 2, y: cy, fill, shadow: panelShadow(c.dark), anim: an('wipe-right-in', 0.55, 'wipe-left-out', 0.45) }));
      } else {
        clips.push(softShade({ ...life(env, 0.2, 0.1), x: Math.round(tx + textW / 2 - 40), y: cy, w: textW * 1.7 + 300, h: textH * 2.6 + 80, color: '#000000', strength: 0.38, anim: an('fade-in', 0.6, 'fade-out', 0.5) }));
      }
      clips.push(
        makeShape('triangle', { name: 'Pin tip', ...textLife(env, 0.35), width: Math.round(pinW * 0.62), height: Math.round(pinW * 0.62), rotation: 180, x: x0 + pinW / 2, y: Math.round(pinY + pinW * 0.36), fill: pinColor, anim: an('drop-in', 0.7, 'pop-out', 0.3) }),
        makeShape('ellipse', { name: 'Pin head', ...textLife(env, 0.35), width: pinW, height: pinW, x: x0 + pinW / 2, y: Math.round(pinY - pinW * 0.08), fill: pinColor, anim: an('drop-in', 0.7, 'pop-out', 0.3) }),
        makeShape('ellipse', { name: 'Pin dot', ...textLife(env, 0.45), width: Math.round(pinW * 0.36), height: Math.round(pinW * 0.36), x: x0 + pinW / 2, y: Math.round(pinY - pinW * 0.08), fill: inkOn(env, pinColor), anim: an('drop-in', 0.7, 'pop-out', 0.3) }),
        place,
        makeShape('rect', { name: 'Rule', ...textLife(env, 0.75), width: ruleW, height: 4, radius: 2, x: Math.round(tx + ruleW / 2), y: Math.round(place.transform.y + place.metrics.height / 2 + gap + 2), fill: boxed ? accentOn(env, fill) : pinColor, anim: an('wipe-right-in', 0.6, 'wipe-left-out', 0.3) }),
        when,
      );
      return clips;
    },
  },

  // -------------------------------------------------------------------------------------------
  {
    id: 'lower-third-social-handle',
    name: 'Social Handle',
    category: 'lower-third',
    tags: ['lower third', 'social', 'handle', 'follow', 'creator', 'username'],
    duration: 6,
    poster: 0.5,
    build: (env) => {
      const c = env.palette;
      const box = overlayBox(env);
      const k = box.k;
      const icon = Math.round(84 * k);
      const fill = vivid(env);
      const handle = title(env, '@jordan.creates', { name: 'Handle', ...textLife(env, 0.55), size: 52 * k, color: inkOn(env, fill), maxWidth: box.maxW - icon - 170, maxLines: 1, style: { align: 'left' }, anim: an('soft-slide-right-in', 0.5, 'fade-out', 0.3) });
      const note = label(env, 'New videos every Friday', { name: 'Note', ...life(env, 0.95, 0.25), size: 24 * k, weight: 600, track: 0.14, color: '#ffffff', maxWidth: box.maxW, maxLines: 1, style: { align: 'left', shadow: footageShadow }, anim: an('soft-slide-up-in', 0.5, 'fade-out', 0.3) });
      const padX = Math.round(30 * k);
      const pillH = Math.round(Math.max(icon, handle.metrics.height + 26 * k));
      const pillW = Math.round(icon / 2 + padX + handle.metrics.inkWidth + padX + 6);
      const gap = Math.round(18 * k);
      const cy = Math.round(box.bottom - note.metrics.height - gap - pillH / 2);
      const ix = box.left + icon / 2;
      handle.transform.y = cy;
      atLeft(handle, ix + icon / 2 + padX - 4);
      note.transform.y = Math.round(box.bottom - note.metrics.height / 2);
      atLeft(note, box.left + 6);
      const plus = Math.round(icon * 0.38);
      const iconFill = lightPanel(env);
      return [
        makeShape('pill', { name: 'Handle pill', ...panelLife(env, 0.35), width: pillW, height: pillH, x: ix + pillW / 2, y: cy, fill, shadow: panelShadow(c.dark), anim: an('wipe-right-in', 0.55, 'wipe-left-out', 0.45) }),
        makeShape('ellipse', { name: 'Icon', ...life(env, 0.15, 0.02), width: icon, height: icon, x: ix, y: cy, fill: iconFill, stroke: { color: fill, width: 5 }, anim: an('pop-in', 0.5, 'pop-out', 0.35) }),
        chance(env.rng, 0.5)
          ? makeShape('cross', { name: 'Plus', ...life(env, 0.3, 0.05), width: plus, height: plus, x: ix, y: cy, fill: accentOn(env, iconFill), anim: an('spin-in', 0.6, 'pop-out', 0.3) })
          : makeShape('heart', { name: 'Heart', ...life(env, 0.3, 0.05), width: Math.round(plus * 1.15), height: Math.round(plus * 1.05), x: ix, y: cy + 2, fill: accentOn(env, iconFill), anim: an('pop-in', 0.5, 'pop-out', 0.3, 'heartbeat', 1.2) }),
        handle,
        makeSticker('like-thumb', { name: 'Like', ...textLife(env, 1.2), size: Math.round(70 * k), x: Math.round(ix + pillW + 30 * k), y: cy - Math.round(30 * k), colors: [c.secondary, inkOn(env, c.secondary)], anim: an('pop-up-in', 0.5, 'pop-out', 0.3) }),
        note,
      ];
    },
  },
];

export default templates;
