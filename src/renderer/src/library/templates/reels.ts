/**
 * Reels (Templates ▸ Reel): kinetic-typography reels and ads in the editorial style of current
 * social motion design — a short script revealed beat by beat by the `reel-kinetic` Motion clip
 * (bold sans, serif italics, a coloured accent word, paper / grid / glow grounds, editorial
 * details), with a picture placeholder on some beats: an object in a dotted ring, a cut-out
 * person, a phone or a framed photo. The picture geometry matches the Motion clip's picture area.
 *
 * The words are the clip's "Script" setting (inspector): one line per beat, *accent*, _italic_,
 * "/" for a line break.
 */

import { makeEffect, makeShape } from '@/core/factory';
import type { Clip, ShapeClip } from '@/core/types';
import { motionFontFamily } from '@shared/motion';
import { BRAND_FONTS_ID } from '../brand';
import type { TemplateDef, TemplateEnv, TemplateMusic } from '../types';
import { slotFill } from './_lib/a-kit';
import { contrast, luminance } from './_lib/kit';

type Value = string | number | boolean;

interface Picture {
  side: 'Start' | 'End';
  /** 1-based beats that show the picture. */
  beats: number[];
  kind: 'circle' | 'person' | 'phone' | 'photo';
  name?: string;
}

interface ReelOpts {
  id: string;
  name: string;
  tags: string[];
  music?: TemplateMusic;
  script: string;
  /** Seconds per beat (default 2.5). */
  beat?: number;
  values: Record<string, Value>;
  /** Colour overrides for the palette in use. */
  colors?: (env: TemplateEnv) => Record<string, string>;
  picture?: Picture;
}

const SANS_OK = new Set(['Inter', 'Montserrat', 'Poppins', 'Rubik', 'Syne', 'Space Grotesk', 'Raleway', 'Archivo Black', 'Anton', 'Oswald', 'Bebas Neue']);
const SERIFS = new Set(['Playfair Display', 'DM Serif Display']);

/** Faces for the clip: the pair's heading when it is a clean sans (always the brand's), and a serif with real italics. */
function faces(env: TemplateEnv): Record<string, string> {
  const h = env.fonts.heading.family;
  const b = env.fonts.body.family;
  const sans = env.fonts.id === BRAND_FONTS_ID || SANS_OK.has(h) ? (motionFontFamily(h) ?? 'Inter Variable') : 'Inter Variable';
  const serifFamily = SERIFS.has(h) ? h : SERIFS.has(b) ? b : 'Playfair Display';
  return { sans, serif: motionFontFamily(serifFamily) ?? 'Playfair Display Variable' };
}

/** An accent that reads on the ground (palette accent, else primary, else a strong red). */
function accentOn(env: TemplateEnv, ground: string): string {
  const c = env.palette;
  return [c.accent, c.primary, c.secondary].find((x) => contrast(x, ground) >= 3) ?? (luminance(ground) > 0.4 ? '#d81f26' : '#ff4d4d');
}

/** Where the clip keeps its picture area (same numbers as the `reel-kinetic` code). */
export function reelPictureArea(env: Pick<TemplateEnv, 'cw' | 'ch'>, side: 'Start' | 'End'): { x: number; y: number; r: number } {
  const { cw: W, ch: H } = env;
  const k = side === 'Start' ? -1 : 1;
  if (H > W * 1.15) return { x: 0, y: k * 0.2 * H, r: Math.min(0.3 * W, 0.17 * H) };
  if (W > H * 1.15) return { x: k * 0.23 * W, y: 0, r: 0.3 * H };
  return { x: k * 0.25 * W, y: 0, r: 0.2 * W };
}

/** The placeholder of a picture, with its frame (a phone body, a photo border) on separate layers so it stays when media is dropped in. */
function pictureLayers(env: TemplateEnv, pic: Picture, start: number, duration: number): Clip[] {
  const { x, y, r } = reelPictureArea(env, pic.side);
  const common = { start, duration, x: Math.round(x), y: Math.round(y), fill: slotFill(env), anim: { in: { id: 'zoom-soft-in', duration: 0.6 }, out: { id: 'zoom-soft-out', duration: 0.3 } } };
  let slot: ShapeClip;
  const extra: { below?: ShapeClip; above?: ShapeClip[] } = {};
  if (pic.kind === 'circle') {
    const d = Math.round(r * 2 * 0.94);
    slot = makeShape('ellipse', { ...common, name: pic.name ?? 'Picture', width: d, height: d });
  } else if (pic.kind === 'person') {
    slot = makeShape('rect', { ...common, name: pic.name ?? 'Person', width: Math.round(r * 2.2), height: Math.round(r * 2.5), radius: Math.round(r * 0.1), effects: [makeEffect('drop-shadow', { amount: 0.45, dist: 20, angle: 70, softness: 34, color: '#000000' })] });
    slot.cutout = { enabled: true, feather: 0.2, choke: 0 };
  } else if (pic.kind === 'phone') {
    const h = Math.round(r * 2.5);
    const w = Math.round(h * 0.48);
    const bezel = Math.max(12, Math.round(w * 0.04));
    slot = makeShape('rect', { ...common, name: pic.name ?? 'Screen', width: w, height: h, radius: Math.round(w * 0.13) });
    const { fill: _f, ...placed } = common;
    void _f;
    extra.above = [
      makeShape('rect', { ...placed, name: 'Phone', width: w + bezel, height: h + bezel, radius: Math.round(w * 0.13 + bezel / 2), fill: '#00000000', stroke: { color: '#0b0b0e', width: bezel }, shadow: { color: '#00000088', blur: 50, x: 0, y: 24 } }),
      makeShape('rect', { ...placed, name: 'Camera', y: Math.round(y - h / 2 + bezel * 1.6), width: Math.round(w * 0.3), height: Math.round(bezel * 1.6), radius: Math.round(bezel), fill: '#0b0b0e' }),
    ];
  } else {
    const w = Math.round(r * 1.7);
    const h = Math.round(r * 2.1);
    const border = Math.round(r * 0.06);
    const { fill: _f, ...placed } = common;
    void _f;
    extra.below = makeShape('rect', { ...placed, name: 'Photo border', width: w + border * 2, height: h + border * 2, radius: Math.round(r * 0.06), rotation: -3, fill: '#ffffff', shadow: { color: '#00000066', blur: 40, x: 0, y: 18 } });
    slot = makeShape('rect', { ...common, name: pic.name ?? 'Photo', width: w, height: h, radius: Math.round(r * 0.04), rotation: -3 });
  }
  slot.shape.slot = true;
  return [...(extra.below ? [extra.below] : []), slot, ...(extra.above ?? [])];
}

function reel(o: ReelOpts): TemplateDef {
  const beats = o.script.split('\n').filter((l) => l.trim()).length;
  const beat = o.beat ?? 2.5;
  return {
    id: o.id,
    name: o.name,
    category: 'reel',
    tags: ['reel', 'kinetic typography', 'ad', ...o.tags],
    duration: Math.round(beats * beat * 10) / 10,
    poster: Math.min(0.9, 0.7 / beats),
    ...(o.music ? { music: o.music } : {}),
    build: (env) => {
      const d = env.duration;
      const len = d / beats;
      const values: Record<string, Value> = { ...faces(env), ...o.values, script: o.script };
      const colors = o.colors?.(env) ?? {};
      Object.assign(values, colors);
      const ground = (colors.bg ?? env.palette.bg) as string;
      if (!colors.accent) values.accent = accentOn(env, ground);
      if (o.picture) {
        values.picture = o.picture.side;
        values.pictureBeats = o.picture.beats.join(',');
        if (o.picture.kind !== 'circle') values.ring = false;
      } else values.picture = 'None';
      const layer = env.motion('reel-kinetic', { name: o.name, values, duration: d });
      const out: Clip[] = layer ? [layer] : [];
      // A placeholder for each run of consecutive picture beats.
      if (o.picture) {
        const sorted = [...o.picture.beats].sort((a, b) => a - b);
        let runStart = sorted[0];
        for (let i = 0; i < sorted.length; i++) {
          const b = sorted[i];
          if (i === sorted.length - 1 || sorted[i + 1] !== b + 1) {
            const start = (runStart - 1) * len + 0.08;
            const end = b * len - 0.12;
            out.push(...pictureLayers(env, o.picture, Math.round(start * 100) / 100, Math.round((end - start) * 100) / 100));
            runStart = sorted[i + 1];
          }
        }
      }
      return out;
    },
  };
}

const templates: TemplateDef[] = [
  reel({
    id: 'reel-ideas',
    name: 'Ideas Into Reach',
    tags: ['marketing', 'content', 'audience', 'agency', 'paper', 'editorial'],
    music: { soundId: 'music-lofi-chill' },
    script: "You've got the / *ideas* and _content_\nYour content's / *working hard*\nbut it's _invisible_ / without an *audience*\nLet's make it / *impossible to miss*",
    values: { style: 'Paper', decor: 'Editorial', motion: 'Mixed', accentStyle: 'Bold colour', flip: true, glow: true, label: 'Content studio' },
    colors: (env) => ({ bg: env.palette.dark ? '#f2eee7' : env.palette.bg, ink: env.palette.dark ? '#141414' : env.palette.text }),
    picture: { side: 'End', beats: [1], kind: 'circle', name: 'Object' },
  }),
  reel({
    id: 'reel-decisions',
    name: 'Smart Decisions',
    tags: ['education', 'psychology', 'tips', 'grid', 'serif', 'stars'],
    music: { soundId: 'music-ambient-drone' },
    script: 'Your brain / _makes over_ / *35,000* decisions\n_Smart decisions_ / aren’t *luck*\nThey’re / *systems*',
    beat: 2.8,
    values: { style: 'Grid', decor: 'Arcs & stars', motion: 'Mixed', accentStyle: 'Serif italic', flip: false, glow: false, label: 'The habits issue' },
    colors: (env) => ({ bg: env.palette.dark ? '#eeeeee' : env.palette.bg, ink: env.palette.dark ? '#151515' : env.palette.text }),
    picture: { side: 'End', beats: [1], kind: 'circle', name: 'Object' },
  }),
  reel({
    id: 'reel-growth',
    name: 'Growth Habit',
    tags: ['brand', 'growth', 'startup', 'glow', 'echo', 'saas'],
    music: { soundId: 'music-future-bass' },
    script: 'Everything starts / with a *spark*\n*Growth*\nis a _habit_ / not an accident\nStart yours / *today*',
    values: { style: 'Glow', decor: 'Ribbon', motion: 'Echo', accentStyle: 'Bold colour', flip: false, glow: true, label: 'Growth studio' },
    colors: (env) => ({ bg: env.palette.dark ? env.palette.bg : '#0f2a1f', ink: env.palette.dark ? env.palette.text : '#f1f7ea', accent: env.palette.dark ? accentOn(env, env.palette.bg) : '#d8f34a' }),
    picture: { side: 'Start', beats: [3], kind: 'photo' },
  }),
  reel({
    id: 'reel-seen',
    name: 'Seen, Not Scrolled',
    tags: ['agency', 'marketing', 'social media', 'dark', 'typing', 'phone'],
    music: { soundId: 'music-deep-house' },
    script: "You're not / _losing_ customers\nbecause of / your *product*\nit's because / no one *sees it*\nLet's / *change that*",
    values: { style: 'Paper', decor: 'Arcs & stars', motion: 'Type', accentStyle: 'Bold colour', flip: false, glow: true, label: 'Social agency' },
    colors: () => ({ bg: '#0e0e10', ink: '#f3f3f3', accent: '#ff3b3b', accent2: '#8a1c1c' }),
    picture: { side: 'End', beats: [2, 3], kind: 'phone' },
  }),
  reel({
    id: 'reel-attention',
    name: 'Attention Is Expensive',
    tags: ['creator', 'tips', 'hook', 'highlight', 'editorial'],
    music: { soundId: 'music-corporate-inspire' },
    script: 'Attention / is _expensive_\nYou have / *3 seconds*\nHook. Story. / *Payoff.*\nMake every / _second_ *count*',
    beat: 2.3,
    values: { style: 'Paper', decor: 'Editorial', motion: 'Mixed', accentStyle: 'Highlight', flip: false, glow: false, label: 'Creator notes' },
  }),
  reel({
    id: 'reel-launch',
    name: 'Meet the New',
    tags: ['launch', 'product', 'founder', 'announcement', 'ribbon'],
    music: { soundId: 'music-upbeat-pop' },
    script: 'Meet the / *new* _standard_\nBuilt by / _people_ like *you*\nfor people / who *ship*\nAvailable / *today*',
    values: { style: 'Paper', decor: 'Ribbon', motion: 'Mixed', accentStyle: 'Bold colour', flip: true, glow: false, label: 'Launch week' },
    picture: { side: 'Start', beats: [2, 3], kind: 'person', name: 'Person' },
  }),
  reel({
    id: 'reel-tips',
    name: 'Three Quick Tips',
    tags: ['tips', 'list', 'education', 'how to', 'grow'],
    music: { soundId: 'music-hiphop-beat' },
    script: '3 tips / to *grow* faster\n*01* / Post _consistently_\n*02* / Hook in the / *first second*\n*03* / Reply to _every_ comment',
    beat: 2.2,
    values: { style: 'Grid', decor: 'Editorial', motion: 'Punch', accentStyle: 'Bold colour', flip: true, glow: false, label: 'Growth notes' },
  }),
  reel({
    id: 'reel-moment',
    name: 'Make the Moment',
    tags: ['quote', 'motivation', 'glow', 'night', 'cinematic'],
    music: { soundId: 'music-cinematic-pad' },
    script: 'Don’t wait / for the _perfect_ moment\nTake the moment / and make it *perfect*',
    beat: 3.2,
    values: { style: 'Glow', decor: 'Orbits', motion: 'Blur', accentStyle: 'Bold colour', flip: false, glow: true, label: 'Daily words' },
    colors: (env): Record<string, string> => (env.palette.dark ? {} : { bg: '#0b0c12', ink: '#f4f4f7' }),
  }),
];

export default templates;
