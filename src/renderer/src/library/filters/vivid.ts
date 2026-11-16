import type { FilterDef } from '../types';

/** Bold, colourful looks for travel, food and everyday footage. */
const filters: FilterDef[] = [
  {
    id: 'colour-pop',
    name: 'Colour Pop',
    category: 'vivid',
    grade: { contrast: 0.18, saturation: 0.32, vibrance: 0.2, sharpen: 0.15 },
  },
  {
    id: 'tropical',
    name: 'Tropical',
    category: 'vivid',
    grade: { contrast: 0.12, saturation: 0.2, vibrance: 0.2, temperature: 0.1, tint: -0.12, hue: 4, highlights: 0.05, shadowTint: '#007a8a', shadowTintAmount: 0.3, highlightTint: '#ffe890', highlightTintAmount: 0.28 },
  },
  {
    id: 'postcard',
    name: 'Postcard',
    category: 'vivid',
    grade: { exposure: 0.08, contrast: 0.12, saturation: 0.28, vibrance: 0.1, hue: 5, highlights: -0.05, fade: 0.08, shadowTint: '#0a4a9a', shadowTintAmount: 0.3, highlightTint: '#fff2c0', highlightTintAmount: 0.2, sharpen: 0.2, vignette: 0.12 },
  },
  {
    id: 'crisp-hdr',
    name: 'Crisp HDR',
    category: 'vivid',
    grade: { contrast: 0.2, saturation: 0.05, vibrance: 0.3, shadows: 0.35, highlights: -0.3, gamma: 0.03, sharpen: 0.4 },
  },
  {
    id: 'candy',
    name: 'Candy',
    category: 'vivid',
    grade: { exposure: 0.1, contrast: -0.05, saturation: 0.18, vibrance: 0.25, tint: 0.1, shadows: 0.15, gamma: 0.06, shadowTint: '#3050c0', shadowTintAmount: 0.12, highlightTint: '#ffd0f0', highlightTintAmount: 0.18 },
  },
  {
    id: 'appetite',
    name: 'Appetite',
    category: 'vivid',
    grade: { exposure: 0.06, contrast: 0.18, saturation: 0.25, vibrance: 0.1, temperature: 0.26, tint: 0.1, highlights: 0.05, gamma: 0.08, shadowTint: '#5a1a10', shadowTintAmount: 0.22, highlightTint: '#ffdc9a', highlightTintAmount: 0.2, sharpen: 0.25 },
  },
  {
    id: 'electric',
    name: 'Electric',
    category: 'vivid',
    grade: { contrast: 0.22, saturation: 0.28, vibrance: 0.1, temperature: -0.16, tint: 0.06, shadowTint: '#3a0a9a', shadowTintAmount: 0.35, highlightTint: '#80f4ff', highlightTintAmount: 0.28, sharpen: 0.15 },
  },
  {
    id: 'endless-summer',
    name: 'Endless Summer',
    category: 'vivid',
    grade: { exposure: 0.12, contrast: 0.08, saturation: 0.18, vibrance: 0.12, temperature: 0.2, tint: -0.06, highlights: -0.08, shadows: 0.1, shadowTint: '#0a6a8a', shadowTintAmount: 0.28, highlightTint: '#fff0a0', highlightTintAmount: 0.3 },
  },
  {
    id: 'festival',
    name: 'Festival',
    category: 'vivid',
    grade: { contrast: 0.15, saturation: 0.3, vibrance: 0.1, tint: 0.12, hue: 10, shadowTint: '#4a0a6a', shadowTintAmount: 0.22, highlightTint: '#ffc860', highlightTintAmount: 0.22, vignette: 0.15 },
  },
];

export default filters;
