import type { FilterDef } from '../types';

/** Big-screen looks: strong split-toning, shaped contrast and a little vignette. */
const filters: FilterDef[] = [
  {
    id: 'warm-blockbuster',
    name: 'Warm Blockbuster',
    category: 'cinematic',
    grade: { exposure: 0.05, contrast: 0.24, saturation: 0.14, temperature: 0.3, tint: 0.03, highlights: 0.05, shadows: -0.1, shadowTint: '#0e3a5a', shadowTintAmount: 0.28, highlightTint: '#ffbe70', highlightTintAmount: 0.38, vignette: 0.22 },
  },
  {
    id: 'cold-thriller',
    name: 'Cold Thriller',
    category: 'cinematic',
    grade: { contrast: 0.26, saturation: -0.2, temperature: -0.32, tint: -0.05, shadows: -0.12, shadowTint: '#082a5a', shadowTintAmount: 0.38, highlightTint: '#cfe4ee', highlightTintAmount: 0.12, grain: 0.08, vignette: 0.3 },
  },
  {
    id: 'silver-bleach',
    name: 'Silver Bleach',
    category: 'cinematic',
    grade: { contrast: 0.35, saturation: -0.35, highlights: 0.15, shadows: -0.1, sharpen: 0.15, grain: 0.15, vignette: 0.15 },
  },
  {
    id: 'moody-blue',
    name: 'Moody Blue',
    category: 'cinematic',
    grade: { exposure: -0.12, contrast: 0.15, saturation: -0.25, temperature: -0.15, fade: 0.12, shadowTint: '#16306e', shadowTintAmount: 0.35, highlightTint: '#a8c4e8', highlightTintAmount: 0.15, vignette: 0.28 },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    category: 'cinematic',
    grade: { exposure: -0.06, contrast: 0.24, saturation: -0.2, tint: -0.38, gamma: -0.04, shadowTint: '#063a2a', shadowTintAmount: 0.38, highlightTint: '#c8f0b8', highlightTintAmount: 0.2, vignette: 0.25 },
  },
  {
    id: 'day-for-night',
    name: 'Day for Night',
    category: 'cinematic',
    grade: { exposure: -0.4, contrast: 0.1, saturation: -0.3, temperature: -0.3, gamma: -0.15, shadowTint: '#0a1a4a', shadowTintAmount: 0.3, vignette: 0.35 },
  },
  {
    id: 'dusty-western',
    name: 'Dusty Western',
    category: 'cinematic',
    grade: { contrast: 0.18, saturation: -0.1, temperature: 0.25, tint: 0.05, fade: 0.1, shadowTint: '#5a3a1e', shadowTintAmount: 0.2, highlightTint: '#f3c98b', highlightTintAmount: 0.3, grain: 0.12, vignette: 0.25 },
  },
  {
    id: 'steel',
    name: 'Steel',
    category: 'cinematic',
    grade: { exposure: 0.05, contrast: 0.3, saturation: -0.35, temperature: -0.1, highlights: -0.1, shadows: 0.05, shadowTint: '#101820', shadowTintAmount: 0.1, highlightTint: '#b8d4ec', highlightTintAmount: 0.3, sharpen: 0.25, vignette: 0.2 },
  },
  {
    id: 'cryo',
    name: 'Cryo',
    category: 'cinematic',
    grade: { contrast: 0.2, saturation: -0.15, temperature: -0.16, tint: -0.2, gamma: 0.05, shadowTint: '#081040', shadowTintAmount: 0.35, highlightTint: '#70f0e0', highlightTintAmount: 0.4 },
  },
];

export default filters;
