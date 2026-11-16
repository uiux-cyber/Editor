import type { FilterDef } from '../types';

/**
 * Black and white family. With `mono` at 1 the split-toning fields no longer matter (the tone
 * comes from `monoTint`), but `hue` still does: rotating the hue before the conversion changes
 * which colours end up light or dark, like a coloured filter in front of the lens.
 */
const filters: FilterDef[] = [
  {
    id: 'high-contrast',
    name: 'High Contrast',
    category: 'mono',
    grade: { exposure: 0.04, contrast: 0.35, highlights: 0.12, shadows: -0.25, mono: 1, monoTint: '#ffffff', sharpen: 0.25 },
  },
  {
    id: 'soft-grey',
    name: 'Soft Grey',
    category: 'mono',
    grade: { mono: 1, monoTint: '#ffffff', contrast: -0.15, shadows: 0.2, highlights: -0.1, gamma: 0.08, fade: 0.08 },
  },
  {
    id: 'matte-black',
    name: 'Matte Black',
    category: 'mono',
    grade: { contrast: 0.15, shadows: 0.05, fade: 0.32, mono: 1, monoTint: '#ffffff', grain: 0.1 },
  },
  {
    id: 'red-filter',
    name: 'Red Filter',
    category: 'mono',
    grade: { mono: 1, monoTint: '#ffffff', hue: 90, contrast: 0.2, shadows: -0.05, vignette: 0.1 },
  },
  {
    id: 'orthochrome',
    name: 'Orthochrome',
    category: 'mono',
    grade: { mono: 1, monoTint: '#f6f1e6', hue: -60, contrast: 0.15, fade: 0.05, grain: 0.15 },
  },
  {
    id: 'silver-screen',
    name: 'Silver Screen',
    category: 'mono',
    grade: { mono: 1, monoTint: '#eef0f4', contrast: 0.12, highlights: 0.2, gamma: 0.1, vignette: 0.25, grain: 0.08 },
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    category: 'mono',
    grade: { mono: 1, monoTint: '#f2efe6', brightness: 0.03, contrast: 0.3, fade: 0.12, grain: 0.4 },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    category: 'mono',
    grade: { mono: 1, monoTint: '#e8c39a', contrast: 0.05, fade: 0.1, vignette: 0.2, grain: 0.1 },
  },
  {
    id: 'selenium',
    name: 'Selenium',
    category: 'mono',
    grade: { mono: 1, monoTint: '#cfc6dd', contrast: 0.18, shadows: -0.05 },
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    category: 'mono',
    grade: { mono: 1, monoTint: '#6aa6e6', contrast: 0.2, shadows: -0.05, fade: 0.05 },
  },
  {
    id: 'platinum',
    name: 'Platinum',
    category: 'mono',
    grade: { contrast: -0.1, highlights: -0.12, shadows: 0.15, gamma: 0.1, mono: 1, monoTint: '#e8dcc4', sharpen: 0.1 },
  },
  {
    id: 'hint-of-colour',
    name: 'Hint of Colour',
    category: 'mono',
    grade: { mono: 0.7, monoTint: '#f4efe8', contrast: 0.1, vibrance: 0.2 },
  },
];

export default filters;
