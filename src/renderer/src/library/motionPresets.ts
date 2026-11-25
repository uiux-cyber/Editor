/**
 * Ready-made Motion clips (Library ▸ Motion). Each file in `library/motion/` default-exports
 * MotionPresetDef[]; they are written to a .kmotion file when added, so they behave exactly like
 * clips Claude writes: settings in the inspector, frame-exact preview and export.
 *
 * Clip code rules (see shared/motion.ts motionGuide): draw relative to k.width / k.height (the
 * project's frame), keep every frame a function of t, read settings from k.params.
 *
 * The library is endless: every design is shown again and again with another palette, font pair,
 * look (`looks`), sample words (`copy`) and random seed (see motionVariations.ts).
 */

import type { MotionParam, MotionValue } from '@shared/motion';

export type MotionCategory =
  | 'titles'
  | 'lower-thirds'
  | 'callouts'
  | 'social'
  | 'text'
  | 'data'
  | 'countdowns'
  | 'transitions'
  | 'backgrounds'
  | 'particles'
  | '3d'
  | 'overlays'
  | 'icons'
  | 'maps';

export const MOTION_CATEGORIES: MotionCategory[] = [
  'titles',
  'lower-thirds',
  'callouts',
  'social',
  'text',
  'data',
  'countdowns',
  'transitions',
  'backgrounds',
  'particles',
  '3d',
  'overlays',
  'icons',
  'maps',
];

export interface MotionPresetDef {
  id: string;
  name: string;
  category: MotionCategory;
  /** One line shown as the tile's tooltip. */
  about: string;
  /** Seconds in one loop. */
  duration: number;
  params: MotionParam[];
  code: string;
  /** Extra search words. */
  tags?: string[];
  /** Draws over the whole frame (backgrounds). Other clips are transparent layers, shown over a backdrop in the library. */
  fullFrame?: boolean;
  /** Fraction of the duration shown as the library thumbnail (default 0.55). */
  poster?: number;
  /**
   * Alternative looks for the endless library: each sets some settings (style, layout, direction…).
   * The clip's defaults are always the first look.
   */
  looks?: Array<Record<string, MotionValue>>;
  /**
   * Settings the library picks at random for each version: a select picks an option, a toggle flips,
   * a number picks a value in its range. Default: the select settings no look sets.
   */
  vary?: string[];
  /** Sample words the library cycles through (setting id → text); the defaults come first. */
  copy?: Array<Record<string, string>>;
}

const modules = import.meta.glob<MotionPresetDef[]>('./motion/*.ts', { eager: true, import: 'default' });

const rank = (c: MotionCategory): number => {
  const i = MOTION_CATEGORIES.indexOf(c);
  return i < 0 ? MOTION_CATEGORIES.length : i;
};

export const MOTION_PRESETS: MotionPresetDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k] ?? [])
  .sort((a, b) => rank(a.category) - rank(b.category));

const byId = new Map(MOTION_PRESETS.map((p) => [p.id, p]));
export const getMotionPreset = (id: string): MotionPresetDef | undefined => byId.get(id);
