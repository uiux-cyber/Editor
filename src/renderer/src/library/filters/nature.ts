import type { FilterDef } from '../types';

/** Looks tuned for landscapes, seasons and the outdoors. */
const filters: FilterDef[] = [
  {
    id: 'deep-forest',
    name: 'Deep Forest',
    category: 'nature',
    grade: { contrast: 0.12, saturation: 0.15, vibrance: 0.15, temperature: 0.08, tint: -0.1, shadows: -0.06, gamma: -0.03, shadowTint: '#0e3a22', shadowTintAmount: 0.25, highlightTint: '#f0e8a0', highlightTintAmount: 0.22, vignette: 0.2 },
  },
  {
    id: 'rainforest',
    name: 'Rainforest',
    category: 'nature',
    grade: { exposure: -0.06, contrast: 0.18, saturation: 0.12, temperature: -0.06, tint: -0.1, fade: 0.05, shadowTint: '#063a3a', shadowTintAmount: 0.32, highlightTint: '#c8f0b0', highlightTintAmount: 0.15, vignette: 0.22 },
  },
  {
    id: 'spring-meadow',
    name: 'Spring Meadow',
    category: 'nature',
    grade: { exposure: 0.08, contrast: 0.05, saturation: 0.16, vibrance: 0.2, temperature: -0.02, tint: -0.2, shadows: 0.1, gamma: 0.05, shadowTint: '#1a5a3a', shadowTintAmount: 0.15, highlightTint: '#eaffb8', highlightTintAmount: 0.3 },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    category: 'nature',
    grade: { contrast: 0.12, saturation: 0.15, vibrance: 0.1, temperature: -0.14, tint: -0.12, highlights: 0.05, shadowTint: '#04404a', shadowTintAmount: 0.35, highlightTint: '#a8f4e8', highlightTintAmount: 0.25 },
  },
  {
    id: 'alpine',
    name: 'Alpine',
    category: 'nature',
    grade: { exposure: 0.08, contrast: 0.22, saturation: -0.05, vibrance: 0.15, temperature: -0.14, highlights: -0.05, shadows: -0.04, shadowTint: '#1a3a6a', shadowTintAmount: 0.18, highlightTint: '#eef6ff', highlightTintAmount: 0.15, sharpen: 0.35 },
  },
  {
    id: 'snow',
    name: 'Snow',
    category: 'nature',
    grade: { exposure: 0.2, contrast: 0.1, saturation: -0.12, temperature: -0.14, highlights: 0.08, shadows: 0.12, gamma: 0.06, shadowTint: '#3a5a90', shadowTintAmount: 0.2, highlightTint: '#eaf4ff', highlightTintAmount: 0.2, sharpen: 0.15 },
  },
  {
    id: 'desert',
    name: 'Desert',
    category: 'nature',
    grade: { exposure: 0.1, contrast: 0.22, saturation: -0.12, temperature: 0.2, tint: 0.05, highlights: 0.12, fade: 0.06, shadowTint: '#7a3a2a', shadowTintAmount: 0.3, highlightTint: '#fff0c8', highlightTintAmount: 0.25, sharpen: 0.1 },
  },
  {
    id: 'savanna',
    name: 'Savanna',
    category: 'nature',
    grade: { contrast: 0.14, saturation: -0.1, vibrance: 0.12, temperature: 0.2, tint: -0.14, hue: -8, fade: 0.06, shadowTint: '#3a4418', shadowTintAmount: 0.3, highlightTint: '#f0e070', highlightTintAmount: 0.38 },
  },
  {
    id: 'autumn',
    name: 'Autumn',
    category: 'nature',
    grade: { contrast: 0.12, saturation: 0.2, vibrance: 0.1, temperature: 0.2, tint: 0.12, hue: -14, shadowTint: '#5a1e0a', shadowTintAmount: 0.3, highlightTint: '#ffc060', highlightTintAmount: 0.3, vignette: 0.15 },
  },
  {
    id: 'northern-lights',
    name: 'Northern Lights',
    category: 'nature',
    grade: { exposure: -0.05, contrast: 0.15, saturation: 0.2, temperature: -0.12, tint: -0.16, shadowTint: '#2a0a6a', shadowTintAmount: 0.35, highlightTint: '#80ffb0', highlightTintAmount: 0.38, vignette: 0.2 },
  },
];

export default filters;
