/**
 * The app's endless Motion library: the ready-made designs, Kinora's palettes and font pairs, and
 * the brand kit (when "Use my brand" is on). See library/motionVariations.ts.
 */

import { FONT_PAIRS, PALETTES } from '@/library';
import { brandFontPair, brandPalette } from '@/library/brand';
import { MOTION_PRESETS } from '@/library/motionPresets';
import type { MotionLibrary, MotionQuery, MotionTheme } from '@/library/motionVariations';
import { templateBrand } from '@/library/templateEngine';
import { motionFontFamily } from '@shared/motion';
import { useTemplates } from '../templates/store';

let lib: MotionLibrary | null = null;

/** Presets, palettes and font pairs (content packs add palettes and fonts in place). */
export function motionLibrary(): MotionLibrary {
  lib ??= { presets: MOTION_PRESETS, palettes: PALETTES, fontPairs: FONT_PAIRS, fontFor: motionFontFamily };
  return lib;
}

/** The brand kit as a theme (also when "Use my brand" is off). */
export function brandTheme(): MotionTheme {
  const { brand } = useTemplates.getState();
  const installed = templateBrand();
  return { palette: installed?.palette ?? brandPalette(brand), fonts: installed?.fonts ?? brandFontPair(brand), name: brand.name };
}

/** The brand kit for the gallery, when "Use my brand" is on and a kit is set up. */
export function motionBrand(): MotionQuery['brand'] {
  const { useBrand, brandSet, brand } = useTemplates.getState();
  if (!useBrand || !brandSet) return null;
  return { theme: brandTheme(), revision: brand.revision };
}
