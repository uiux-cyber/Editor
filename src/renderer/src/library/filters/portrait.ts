import type { FilterDef } from '../types';

/** Skin-friendly looks: gentle contrast, protected highlights and warm or clean tones. */
const filters: FilterDef[] = [
  {
    id: 'soft-skin',
    name: 'Soft Skin',
    category: 'portrait',
    grade: { exposure: 0.06, contrast: -0.14, saturation: -0.05, vibrance: 0.12, temperature: 0.08, tint: 0.06, highlights: -0.15, shadows: 0.22, gamma: 0.06 },
  },
  {
    id: 'peach-glow',
    name: 'Peach Glow',
    category: 'portrait',
    grade: { exposure: 0.06, contrast: -0.03, saturation: 0.05, vibrance: 0.1, temperature: 0.22, tint: 0.1, shadows: 0.08, gamma: 0.06, fade: 0.06, highlightTint: '#ffc8a0', highlightTintAmount: 0.4 },
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    category: 'portrait',
    grade: { exposure: 0.1, saturation: -0.3, vibrance: 0.08, temperature: -0.18, tint: 0.04, highlights: 0.05, shadows: 0.15, gamma: 0.08, highlightTint: '#eaf0ff', highlightTintAmount: 0.2 },
  },
  {
    id: 'bronze',
    name: 'Bronze',
    category: 'portrait',
    grade: { contrast: 0.2, saturation: 0.05, vibrance: 0.05, temperature: 0.22, shadows: -0.05, gamma: -0.05, shadowTint: '#5a2a10', shadowTintAmount: 0.25, highlightTint: '#ffc078', highlightTintAmount: 0.32 },
  },
  {
    id: 'rosy',
    name: 'Rosy',
    category: 'portrait',
    grade: { exposure: 0.05, contrast: 0.02, vibrance: 0.18, temperature: 0.04, tint: 0.32, highlights: -0.05, shadows: 0.08, gamma: 0.05, shadowTint: '#6a2a4a', shadowTintAmount: 0.15, highlightTint: '#ffb8cc', highlightTintAmount: 0.4 },
  },
  {
    id: 'studio-clean',
    name: 'Studio Clean',
    category: 'portrait',
    grade: { exposure: 0.08, contrast: 0.16, vibrance: 0.18, temperature: -0.05, highlights: -0.1, shadows: 0.1, sharpen: 0.3 },
  },
  {
    id: 'editorial-matte',
    name: 'Editorial Matte',
    category: 'portrait',
    grade: { contrast: 0.06, saturation: -0.3, temperature: -0.12, shadows: 0.05, fade: 0.28, shadowTint: '#283a66', shadowTintAmount: 0.32, highlightTint: '#fff4e6', highlightTintAmount: 0.1, sharpen: 0.15, vignette: 0.1 },
  },
  {
    id: 'backlit-haze',
    name: 'Backlit Haze',
    category: 'portrait',
    grade: { exposure: 0.18, contrast: -0.18, saturation: -0.05, temperature: 0.28, highlights: 0.1, shadows: 0.18, gamma: 0.05, fade: 0.18, highlightTint: '#ffd88a', highlightTintAmount: 0.4 },
  },
  {
    id: 'candlelight',
    name: 'Candlelight',
    category: 'portrait',
    grade: { exposure: -0.1, contrast: 0.1, saturation: -0.05, temperature: 0.32, tint: 0.05, gamma: -0.05, shadowTint: '#3a1a08', shadowTintAmount: 0.2, highlightTint: '#ffb45e', highlightTintAmount: 0.3, vignette: 0.35 },
  },
];

export default filters;
