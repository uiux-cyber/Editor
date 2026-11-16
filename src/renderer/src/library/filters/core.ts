import type { FilterDef } from '../types';

/** Core filters. Further packs live next to this file. */
const filters: FilterDef[] = [
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    category: 'cinematic',
    grade: { contrast: 0.18, saturation: 0.1, temperature: 0.08, shadowTint: '#0e4a5c', shadowTintAmount: 0.3, highlightTint: '#ffb070', highlightTintAmount: 0.22, vignette: 0.15 },
  },
  {
    id: 'noir',
    name: 'Noir',
    category: 'mono',
    grade: { mono: 1, monoTint: '#ffffff', contrast: 0.35, shadows: -0.15, grain: 0.18, vignette: 0.3 },
  },
  {
    id: 'faded-film',
    name: 'Faded Film',
    category: 'film',
    grade: { fade: 0.28, contrast: -0.08, saturation: -0.18, temperature: 0.1, grain: 0.22, highlightTint: '#fff2d6', highlightTintAmount: 0.15 },
  },
];

export default filters;
