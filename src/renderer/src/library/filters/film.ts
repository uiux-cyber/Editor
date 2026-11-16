import type { FilterDef } from '../types';

/** Photochemical looks, described by what they do rather than by any real stock. */
const filters: FilterDef[] = [
  {
    id: 'warm-negative',
    name: 'Warm Negative',
    category: 'film',
    grade: { contrast: 0.06, saturation: 0.08, temperature: 0.24, shadows: 0.05, gamma: 0.03, fade: 0.08, shadowTint: '#205a44', shadowTintAmount: 0.35, highlightTint: '#ffd090', highlightTintAmount: 0.35, grain: 0.14 },
  },
  {
    id: 'cool-negative',
    name: 'Cool Negative',
    category: 'film',
    grade: { contrast: 0.05, saturation: -0.05, temperature: -0.14, tint: -0.2, shadows: 0.12, fade: 0.12, shadowTint: '#0e5a5a', shadowTintAmount: 0.32, highlightTint: '#d0f4e0', highlightTintAmount: 0.25, grain: 0.12 },
  },
  {
    id: 'pastel-negative',
    name: 'Pastel Negative',
    category: 'film',
    grade: { exposure: 0.22, contrast: -0.12, saturation: -0.1, vibrance: 0.15, temperature: 0.05, tint: 0.03, highlights: -0.15, shadows: 0.2, fade: 0.15, shadowTint: '#3a8a7a', shadowTintAmount: 0.32, highlightTint: '#ffd8c0', highlightTintAmount: 0.25, grain: 0.1 },
  },
  {
    id: 'chrome-slide',
    name: 'Chrome Slide',
    category: 'film',
    grade: { contrast: 0.3, saturation: 0.2, vibrance: 0.1, temperature: -0.1, shadows: -0.15, shadowTint: '#0a2060', shadowTintAmount: 0.28, sharpen: 0.2, grain: 0.06 },
  },
  {
    id: 'velvet-slide',
    name: 'Velvet Slide',
    category: 'film',
    grade: { contrast: 0.2, saturation: 0.3, vibrance: -0.05, tint: 0.1, shadows: -0.12, gamma: -0.05, shadowTint: '#3a1050', shadowTintAmount: 0.18, highlightTint: '#fff0d0', highlightTintAmount: 0.1 },
  },
  {
    id: 'tungsten-stock',
    name: 'Tungsten Stock',
    category: 'film',
    grade: { contrast: 0.12, saturation: 0.1, temperature: -0.24, tint: 0.1, gamma: 0.04, shadowTint: '#2a2a80', shadowTintAmount: 0.28, highlightTint: '#ffdca8', highlightTintAmount: 0.2, grain: 0.12 },
  },
  {
    id: 'pushed-two-stops',
    name: 'Pushed Two Stops',
    category: 'film',
    grade: { exposure: 0.1, contrast: 0.32, saturation: 0.08, tint: 0.04, shadows: -0.15, highlights: 0.1, shadowTint: '#3a1e3a', shadowTintAmount: 0.12, grain: 0.32, vignette: 0.12 },
  },
  {
    id: 'expired-roll',
    name: 'Expired Roll',
    category: 'film',
    grade: { exposure: 0.06, contrast: -0.05, saturation: -0.25, temperature: -0.04, tint: 0.08, hue: 12, fade: 0.25, shadowTint: '#2a6a2a', shadowTintAmount: 0.45, highlightTint: '#ffb0d0', highlightTintAmount: 0.35, grain: 0.25 },
  },
];

export default filters;
