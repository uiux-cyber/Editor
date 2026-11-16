import type { FilterDef } from '../types';

/** Looks from the family album and the back of the drawer. */
const filters: FilterDef[] = [
  {
    id: 'seventies-warm',
    name: 'Seventies Warm',
    category: 'retro',
    grade: { contrast: 0.05, saturation: -0.1, temperature: 0.32, tint: 0.06, fade: 0.16, shadowTint: '#5a3010', shadowTintAmount: 0.28, highlightTint: '#ffcc70', highlightTintAmount: 0.38, grain: 0.16, vignette: 0.15 },
  },
  {
    id: 'eighties-magenta',
    name: 'Eighties Magenta',
    category: 'retro',
    grade: { contrast: 0.12, saturation: 0.18, temperature: -0.05, tint: 0.3, fade: 0.06, shadowTint: '#4a0e8e', shadowTintAmount: 0.38, highlightTint: '#ff8ad0', highlightTintAmount: 0.3, grain: 0.08 },
  },
  {
    id: 'camcorder-95',
    name: "Camcorder '95",
    category: 'retro',
    grade: { contrast: -0.1, saturation: 0.15, temperature: -0.12, tint: 0.08, highlights: 0.2, gamma: 0.06, fade: 0.18, shadowTint: '#1a2a7a', shadowTintAmount: 0.25, highlightTint: '#f0f6ff', highlightTintAmount: 0.15, sharpen: 0.35, grain: 0.12 },
  },
  {
    id: 'y2k-digital',
    name: 'Y2K Digital',
    category: 'retro',
    grade: { exposure: 0.12, contrast: 0.1, saturation: 0.08, temperature: -0.12, tint: -0.04, highlights: 0.2, shadowTint: '#20406a', shadowTintAmount: 0.1, sharpen: 0.4, grain: 0.05 },
  },
  {
    id: 'instant-photo',
    name: 'Instant Photo',
    category: 'retro',
    grade: { exposure: 0.06, contrast: -0.02, saturation: -0.1, temperature: 0.12, tint: -0.1, fade: 0.3, shadowTint: '#145a5a', shadowTintAmount: 0.4, highlightTint: '#fff0b0', highlightTintAmount: 0.4, grain: 0.1, vignette: 0.2 },
  },
  {
    id: 'disposable-camera',
    name: 'Disposable Camera',
    category: 'retro',
    grade: { exposure: 0.15, contrast: 0.22, saturation: 0.15, temperature: 0.04, tint: 0.1, highlights: 0.1, shadows: -0.08, shadowTint: '#2a1a4a', shadowTintAmount: 0.15, highlightTint: '#fffbe0', highlightTintAmount: 0.12, grain: 0.22, vignette: 0.35 },
  },
  {
    id: 'sixties-slide',
    name: 'Sixties Slide',
    category: 'retro',
    grade: { contrast: 0.2, saturation: 0.22, temperature: 0.18, tint: 0.12, hue: -5, fade: 0.1, shadowTint: '#3a1040', shadowTintAmount: 0.2, highlightTint: '#ffe0a0', highlightTintAmount: 0.22, grain: 0.1, vignette: 0.2 },
  },
  {
    id: 'home-movie',
    name: 'Home Movie',
    category: 'retro',
    grade: { contrast: -0.05, saturation: -0.12, temperature: 0.2, gamma: 0.05, fade: 0.18, shadowTint: '#5a2a2a', shadowTintAmount: 0.18, highlightTint: '#ffcf8f', highlightTintAmount: 0.25, grain: 0.35, vignette: 0.3 },
  },
  {
    id: 'toy-camera',
    name: 'Toy Camera',
    category: 'retro',
    grade: { contrast: 0.25, saturation: 0.25, tint: -0.05, shadowTint: '#0a2a6a', shadowTintAmount: 0.3, highlightTint: '#f0ff9a', highlightTintAmount: 0.22, vignette: 0.5, grain: 0.12 },
  },
  {
    id: 'faded-rose',
    name: 'Faded Rose',
    category: 'retro',
    grade: { contrast: -0.05, saturation: -0.15, temperature: 0.06, tint: 0.28, fade: 0.22, shadowTint: '#5a2a6a', shadowTintAmount: 0.3, highlightTint: '#ffc2d0', highlightTintAmount: 0.4, grain: 0.12 },
  },
];

export default filters;
