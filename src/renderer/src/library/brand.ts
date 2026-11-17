/**
 * Brand kit: the user's brand name, logos, five core colours and two typefaces. Templates can be
 * rendered with the brand instead of a random palette / font pairing; the remaining palette roles
 * (secondary background, surface, muted text, text on primary) are derived here so every design
 * stays legible.
 *
 * Pure and deterministic — shared by the renderer, the template engine and the unit tests.
 */

import { contrast, luminance, mix, readableOn } from './templates/_lib/kit';
import { getBundledFont, nearestWeight } from './fonts';
import type { FontPair, FontRole, Palette } from './types';
import type { BundledFontFamily } from './fonts';

export const BRAND_PALETTE_ID = '__brand';
export const BRAND_FONTS_ID = '__brand';

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface BrandFont {
  /** A bundled family or a font installed on this PC. */
  family: string;
  weight: number;
  uppercase?: boolean;
  /** Em fraction. */
  letterSpacing?: number;
}

export interface BrandLogo {
  id: string;
  /** Display name (original file name). */
  name: string;
  /** Absolute path of the copy kept in userData/brand/logos. */
  path: string;
  /** Pixel size of the picture. */
  width: number;
  height: number;
  /** Average luminance (0..1) of the opaque pixels, used to pick a logo that reads on a background. */
  luma?: number;
}

export interface BrandKit {
  version: 1;
  name: string;
  colors: BrandColors;
  heading: BrandFont;
  body: BrandFont;
  logos: BrandLogo[];
  /** Logo used by default (else the one contrasting best with the background). */
  primaryLogo?: string;
  /** Bumped on every change (cache key for previews). */
  revision: number;
}

export const DEFAULT_BRAND: BrandKit = {
  version: 1,
  name: '',
  colors: { primary: '#7c5cff', secondary: '#22d3ee', accent: '#ffb020', background: '#0f1117', text: '#ffffff' },
  heading: { family: 'Montserrat', weight: 800 },
  body: { family: 'Inter', weight: 500 },
  logos: [],
  revision: 0,
};

const HEX = /^#([0-9a-f]{6})$/i;
const HEX_ANY = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Normalise `#rgb` / `#rrggbb` / `#rrggbbaa` to `#rrggbb` (alpha dropped); null when invalid. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX_ANY.test(value.trim())) return null;
  let h = value.trim().slice(1).toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.slice(0, 6)}`;
}

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

function sanitizeFont(raw: unknown, fallback: BrandFont): BrandFont {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const family = str(r.family, 120).trim() || fallback.family;
  const font: BrandFont = { family, weight: Math.round(clampNum(r.weight, 100, 900, fallback.weight) / 100) * 100 };
  if (r.uppercase === true) font.uppercase = true;
  if (typeof r.letterSpacing === 'number' && Number.isFinite(r.letterSpacing)) font.letterSpacing = clampNum(r.letterSpacing, -0.1, 0.5, 0);
  return font;
}

/** Turn anything read from disk into a valid brand kit (unknown fields are dropped). */
export function sanitizeBrandKit(raw: unknown): BrandKit {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const colorsRaw = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>;
  const colors = { ...DEFAULT_BRAND.colors };
  for (const k of Object.keys(colors) as (keyof BrandColors)[]) colors[k] = normalizeHex(colorsRaw[k]) ?? colors[k];
  const logos: BrandLogo[] = [];
  if (Array.isArray(r.logos)) {
    for (const l of r.logos.slice(0, 12)) {
      if (!l || typeof l !== 'object') continue;
      const o = l as Record<string, unknown>;
      const path = str(o.path, 1024);
      const id = str(o.id, 64);
      if (!path || !id) continue;
      logos.push({
        id,
        name: str(o.name, 200, 'Logo'),
        path,
        width: Math.round(clampNum(o.width, 1, 16384, 512)),
        height: Math.round(clampNum(o.height, 1, 16384, 512)),
        ...(typeof o.luma === 'number' && Number.isFinite(o.luma) ? { luma: clampNum(o.luma, 0, 1, 0.5) } : {}),
      });
    }
  }
  const primaryLogo = typeof r.primaryLogo === 'string' && logos.some((l) => l.id === r.primaryLogo) ? r.primaryLogo : undefined;
  return {
    version: 1,
    name: str(r.name, 120),
    colors,
    heading: sanitizeFont(r.heading, DEFAULT_BRAND.heading),
    body: sanitizeFont(r.body, DEFAULT_BRAND.body),
    logos,
    ...(primaryLogo ? { primaryLogo } : {}),
    revision: Math.round(clampNum(r.revision, 0, Number.MAX_SAFE_INTEGER, 0)),
  };
}

// ---------------------------------------------------------------------------------------------
// Palette derivation
// ---------------------------------------------------------------------------------------------

/** Push `color` toward `target` until it reaches `min` contrast on `bg` (or `target` itself). */
function untilContrast(color: string, target: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(color, target, Math.min(1, t));
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/**
 * Full template palette from the five brand colours. Derived roles:
 * - `bg2`: the background nudged toward the primary (gradients, secondary panels),
 * - `surface`: a card tone one step lighter (dark brands) or darker (light brands),
 * - `textMuted`: the text colour softened toward the background, kept at ≥ 4.5:1,
 * - `onPrimary`: whichever of text / background / white / near-black reads best on the primary.
 */
export function brandPalette(kit: Pick<BrandKit, 'colors'>, id = BRAND_PALETTE_ID, name = 'My brand'): Palette {
  const { primary, secondary, accent, background: bg } = kit.colors;
  // The main text colour must read on the background whatever the user typed.
  const text = contrast(kit.colors.text, bg) >= 4.5 ? kit.colors.text : untilContrast(kit.colors.text, readableOn(bg), bg, 4.5);
  const dark = luminance(bg) < 0.4;
  const bg2 = mix(bg, primary, dark ? 0.16 : 0.1);
  const surface = dark ? mix(bg, '#ffffff', 0.08) : mix(bg, '#000000', 0.045);
  const textMuted = untilContrast(mix(text, bg, 0.38), text, bg, 4.5);
  const onCandidates = [text, bg, '#ffffff', '#111318'];
  const onPrimary = onCandidates.reduce((best, c) => (contrast(c, primary) > contrast(best, primary) + 0.05 ? c : best), onCandidates[0]);
  return { id, name, dark, bg, bg2, surface, primary, secondary, accent, text, textMuted, onPrimary };
}

/** Font pair for the template engine. Families not bundled with the app are passed through as-is. */
export function brandFontPair(kit: Pick<BrandKit, 'heading' | 'body'>, id = BRAND_FONTS_ID): FontPair {
  const role = (f: BrandFont): FontRole => {
    const bundled = getBundledFont(f.family);
    return {
      // Installed fonts are not in the bundled union; the text engine renders any family name.
      family: f.family as BundledFontFamily,
      weight: bundled ? nearestWeight(f.family, f.weight) : f.weight,
      ...(f.uppercase ? { uppercase: true } : {}),
      ...(f.letterSpacing ? { letterSpacing: f.letterSpacing } : {}),
    };
  };
  return { id, name: 'My brand', heading: role(kit.heading), body: role(kit.body) };
}

// ---------------------------------------------------------------------------------------------
// Contrast checks (shown live in the Brand Kit window)
// ---------------------------------------------------------------------------------------------

export type ContrastLevel = 'AAA' | 'AA' | 'AA large' | 'fail';

export interface ContrastCheck {
  id: string;
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  level: ContrastLevel;
  /** Minimum ratio this pairing needs to be considered fine. */
  required: number;
  ok: boolean;
}

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'fail';
}

/** The pairings templates actually use, with WCAG ratios. */
export function brandContrastChecks(kit: Pick<BrandKit, 'colors'>): ContrastCheck[] {
  const p = brandPalette(kit);
  const c = kit.colors;
  const rows: [string, string, string, string, number][] = [
    ['text', 'Text on background', c.text, c.background, 4.5],
    ['muted', 'Muted text on background', p.textMuted, c.background, 4.5],
    ['onPrimary', 'Text on primary', p.onPrimary, c.primary, 4.5],
    ['primary', 'Primary on background', c.primary, c.background, 3],
    ['secondary', 'Secondary on background', c.secondary, c.background, 3],
    ['accent', 'Accent on background', c.accent, c.background, 3],
  ];
  return rows.map(([id, label, fg, bg, required]) => {
    const ratio = Math.round(contrast(fg, bg) * 100) / 100;
    return { id, label, fg, bg, ratio, level: contrastLevel(ratio), required, ok: ratio >= required };
  });
}

/** True for a valid `#rrggbb` colour. */
export const isHex6 = (v: string): boolean => HEX.test(v);

/**
 * The logo to show on a background: the user's primary logo when it reads (≥ 1.6:1 against the
 * background by average luminance), else the logo contrasting best.
 */
export function pickLogo(kit: Pick<BrandKit, 'logos' | 'primaryLogo'>, background: string): BrandLogo | null {
  if (kit.logos.length === 0) return null;
  const bgL = luminance(background);
  const score = (l: BrandLogo): number => {
    const ll = l.luma ?? 0.5;
    return (Math.max(ll, bgL) + 0.05) / (Math.min(ll, bgL) + 0.05);
  };
  const primary = kit.logos.find((l) => l.id === kit.primaryLogo);
  if (primary && score(primary) >= 1.6) return primary;
  return [...kit.logos].sort((a, b) => score(b) - score(a))[0];
}
