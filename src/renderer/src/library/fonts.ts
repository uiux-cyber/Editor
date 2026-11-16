/**
 * Fonts bundled with the app (all SIL Open Font License, shipped via @fontsource).
 * Project files store the friendly `family`; `cssFamily()` maps it to the registered CSS name.
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'script' | 'mono';

export interface FontDef {
  family: string;
  css: string;
  category: FontCategory;
  /** Available weights. Variable fonts list the selectable stops inside their range. */
  weights: number[];
}

export const BUNDLED_FONTS: FontDef[] = [
  { family: 'Inter', css: 'Inter Variable', category: 'sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { family: 'Montserrat', css: 'Montserrat Variable', category: 'sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { family: 'Poppins', css: 'Poppins', category: 'sans', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Raleway', css: 'Raleway Variable', category: 'sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { family: 'Rubik', css: 'Rubik Variable', category: 'sans', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Space Grotesk', css: 'Space Grotesk Variable', category: 'sans', weights: [300, 400, 500, 600, 700] },
  { family: 'Syne', css: 'Syne Variable', category: 'sans', weights: [400, 500, 600, 700, 800] },
  { family: 'Oswald', css: 'Oswald Variable', category: 'display', weights: [200, 300, 400, 500, 600, 700] },
  { family: 'Bebas Neue', css: 'Bebas Neue', category: 'display', weights: [400] },
  { family: 'Anton', css: 'Anton', category: 'display', weights: [400] },
  { family: 'Archivo Black', css: 'Archivo Black', category: 'display', weights: [400] },
  { family: 'Righteous', css: 'Righteous', category: 'display', weights: [400] },
  { family: 'Bangers', css: 'Bangers', category: 'display', weights: [400] },
  { family: 'Shrikhand', css: 'Shrikhand', category: 'display', weights: [400] },
  { family: 'Press Start 2P', css: 'Press Start 2P', category: 'display', weights: [400] },
  { family: 'Playfair Display', css: 'Playfair Display Variable', category: 'serif', weights: [400, 500, 600, 700, 800, 900] },
  { family: 'DM Serif Display', css: 'DM Serif Display', category: 'serif', weights: [400] },
  { family: 'Abril Fatface', css: 'Abril Fatface', category: 'serif', weights: [400] },
  { family: 'Lobster', css: 'Lobster', category: 'script', weights: [400] },
  { family: 'Pacifico', css: 'Pacifico', category: 'script', weights: [400] },
  { family: 'Dancing Script', css: 'Dancing Script Variable', category: 'script', weights: [400, 500, 600, 700] },
  { family: 'Caveat', css: 'Caveat Variable', category: 'script', weights: [400, 500, 600, 700] },
  { family: 'Permanent Marker', css: 'Permanent Marker', category: 'script', weights: [400] },
  { family: 'JetBrains Mono', css: 'JetBrains Mono Variable', category: 'mono', weights: [100, 200, 300, 400, 500, 600, 700, 800] },
];

/** The exact set of family names content packs (text presets, templates) are allowed to use. */
export type BundledFontFamily =
  | 'Inter'
  | 'Montserrat'
  | 'Poppins'
  | 'Raleway'
  | 'Rubik'
  | 'Space Grotesk'
  | 'Syne'
  | 'Oswald'
  | 'Bebas Neue'
  | 'Anton'
  | 'Archivo Black'
  | 'Righteous'
  | 'Bangers'
  | 'Shrikhand'
  | 'Press Start 2P'
  | 'Playfair Display'
  | 'DM Serif Display'
  | 'Abril Fatface'
  | 'Lobster'
  | 'Pacifico'
  | 'Dancing Script'
  | 'Caveat'
  | 'Permanent Marker'
  | 'JetBrains Mono';

const byFamily = new Map(BUNDLED_FONTS.map((f) => [f.family, f]));

export function getBundledFont(family: string): FontDef | undefined {
  return byFamily.get(family);
}

/** CSS font-family value (with fallbacks) for a stored family name. */
export function cssFamily(family: string): string {
  const def = byFamily.get(family);
  const name = def ? def.css : family;
  return `"${name.replace(/"/g, '')}", "Segoe UI", "Segoe UI Emoji", sans-serif`;
}

/** Closest weight a family actually provides. */
export function nearestWeight(family: string, weight: number): number {
  const def = byFamily.get(family);
  if (!def) return weight;
  let best = def.weights[0];
  for (const w of def.weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return best;
}
