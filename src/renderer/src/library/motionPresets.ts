/**
 * Ready-made Motion clips (Library ▸ Motion). Each file in `library/motion/` default-exports
 * MotionPresetDef[]; they are written to a .kmotion file when added, so they behave exactly like
 * clips Claude writes: settings in the inspector, frame-exact preview and export.
 *
 * Clip code rules (see shared/motion.ts motionGuide): draw relative to k.width / k.height (the
 * project's frame), keep every frame a function of t, read settings from k.params.
 */

import type { MotionParam } from '@shared/motion';

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
}

export type MotionCategory = 'titles' | 'lower-thirds' | 'social' | 'data' | '3d' | 'effects';
export const MOTION_CATEGORIES: MotionCategory[] = ['titles', 'lower-thirds', 'social', 'data', '3d', 'effects'];

const modules = import.meta.glob<MotionPresetDef[]>('./motion/*.ts', { eager: true, import: 'default' });

export const MOTION_PRESETS: MotionPresetDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k] ?? [])
  .sort((a, b) => MOTION_CATEGORIES.indexOf(a.category) - MOTION_CATEGORIES.indexOf(b.category));

export const getMotionPreset = (id: string): MotionPresetDef | undefined => MOTION_PRESETS.find((p) => p.id === id);
