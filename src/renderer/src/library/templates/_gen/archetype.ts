import type { Palette, TemplateCategory } from '../../types';
import type { Copy } from './copy';
import type { Ctx } from './parts';

/**
 * A family of generated layouts: one composition idea (a film title card, a Swiss poster…)
 * whose structure varies with the seed — where the type sits, what the picture does, which
 * devices decorate it, how it moves.
 */
export interface Archetype {
  id: string;
  /** Display name (the design name adds its content). */
  name: string;
  categories: TemplateCategory[];
  tags: string[];
  /** Font pairs that suit the idea (ids), best first. */
  fonts?: string[];
  /** Palettes that suit the idea. */
  palettes?: (p: Palette) => boolean;
  duration?: number;
  /** 0..1: the hero frame. */
  poster?: number;
  build: (x: Ctx, k: Copy, category: TemplateCategory) => void;
}

function chroma(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0;
  const v = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return Math.max(...v) - Math.min(...v);
}

export const darkPalette = (p: Palette): boolean => p.dark;
export const lightPalette = (p: Palette): boolean => !p.dark;
/** A palette with at least one strongly coloured signal. */
export const vividPalette = (p: Palette): boolean => Math.max(chroma(p.primary), chroma(p.accent), chroma(p.secondary)) > 0.55;
