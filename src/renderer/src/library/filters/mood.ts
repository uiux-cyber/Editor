import type { FilterDef } from '../types';

/** Looks that set an emotional tone or a time of day. */
const filters: FilterDef[] = [
  {
    id: 'dreamy',
    name: 'Dreamy',
    category: 'mood',
    grade: { exposure: 0.12, contrast: -0.2, saturation: -0.05, vibrance: 0.1, tint: 0.12, highlights: 0.1, shadows: 0.2, gamma: 0.08, fade: 0.12, shadowTint: '#6a5ae0', shadowTintAmount: 0.35, highlightTint: '#ffc8ee', highlightTintAmount: 0.35 },
  },
  {
    id: 'romance',
    name: 'Romance',
    category: 'mood',
    grade: { exposure: 0.05, contrast: -0.08, saturation: 0.05, temperature: 0.12, tint: 0.18, gamma: 0.05, fade: 0.1, shadowTint: '#6a1a4a', shadowTintAmount: 0.28, highlightTint: '#ffb4b4', highlightTintAmount: 0.4, vignette: 0.2 },
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    category: 'mood',
    grade: { exposure: 0.08, contrast: 0.06, saturation: 0.15, temperature: 0.42, tint: 0.04, highlights: -0.05, shadows: 0.08, shadowTint: '#7a3a1a', shadowTintAmount: 0.22, highlightTint: '#ffb84a', highlightTintAmount: 0.45, vignette: 0.12 },
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    category: 'mood',
    grade: { contrast: 0.08, saturation: 0.15, temperature: 0.14, tint: 0.18, fade: 0.06, shadowTint: '#3a1a7a', shadowTintAmount: 0.42, highlightTint: '#ff9e5a', highlightTintAmount: 0.4, vignette: 0.15 },
  },
  {
    id: 'blue-hour',
    name: 'Blue Hour',
    category: 'mood',
    grade: { exposure: -0.08, contrast: 0.1, saturation: 0.12, temperature: -0.28, gamma: -0.03, shadowTint: '#10206e', shadowTintAmount: 0.32, highlightTint: '#ffb878', highlightTintAmount: 0.3, vignette: 0.18 },
  },
  {
    id: 'neon-night',
    name: 'Neon Night',
    category: 'mood',
    grade: { contrast: 0.25, saturation: 0.25, vibrance: 0.1, temperature: -0.15, tint: 0.15, shadows: -0.1, shadowTint: '#2a0a8a', shadowTintAmount: 0.4, highlightTint: '#ff5ad0', highlightTintAmount: 0.28, vignette: 0.2 },
  },
  {
    id: 'misty-morning',
    name: 'Misty Morning',
    category: 'mood',
    grade: { exposure: 0.1, contrast: -0.22, saturation: -0.2, temperature: -0.06, shadows: 0.15, fade: 0.2, shadowTint: '#5a7080', shadowTintAmount: 0.2, highlightTint: '#e6f0f4', highlightTintAmount: 0.15 },
  },
  {
    id: 'melancholy',
    name: 'Melancholy',
    category: 'mood',
    grade: { exposure: -0.05, contrast: -0.05, saturation: -0.3, vibrance: 0.1, temperature: -0.04, tint: -0.06, fade: 0.14, shadowTint: '#0e4a52', shadowTintAmount: 0.4, highlightTint: '#ecd8b8', highlightTintAmount: 0.25, vignette: 0.25 },
  },
  {
    id: 'gloomy',
    name: 'Gloomy',
    category: 'mood',
    grade: { exposure: -0.18, contrast: 0.05, saturation: -0.3, temperature: -0.1, tint: -0.04, fade: 0.1, shadowTint: '#1c2a36', shadowTintAmount: 0.25, highlightTint: '#c8d2d6', highlightTintAmount: 0.15, vignette: 0.3 },
  },
  {
    id: 'dread',
    name: 'Dread',
    category: 'mood',
    grade: { exposure: -0.2, contrast: 0.28, saturation: -0.32, temperature: -0.05, tint: -0.18, shadows: -0.1, shadowTint: '#0a2a18', shadowTintAmount: 0.3, highlightTint: '#d8e0b0', highlightTintAmount: 0.15, vignette: 0.45, grain: 0.2 },
  },
];

export default filters;
