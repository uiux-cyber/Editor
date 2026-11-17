/**
 * Built-in looks shipped as procedurally generated 3D LUTs, so the LUT feature is useful before
 * the user imports anything. Each look is a pure function of a display-referred RGB colour,
 * baked into a 33³ table (the same format an imported .cube file produces).
 */

import type { CubeLut } from '@shared/cube';
import { cbcrToRgbOffset, hueToScopeAngle, luma709, type Vec3 } from './wheels';

export const BUILTIN_PREFIX = 'builtin:';
export const BUILTIN_LUT_SIZE = 33;

export interface BuiltinLutDef {
  id: string;
  name: string;
  description: string;
  look: (c: Vec3) => Vec3;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const add3 = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Pure chroma push towards an HSV hue, `strength` in Cb/Cr units. */
function push(hue: number, strength: number): Vec3 {
  const a = (hueToScopeAngle(hue) * Math.PI) / 180;
  return cbcrToRgbOffset(strength * Math.cos(a), strength * Math.sin(a));
}

function saturate(c: Vec3, k: number): Vec3 {
  const l = luma709(c[0], c[1], c[2]);
  return [mix(l, c[0], k), mix(l, c[1], k), mix(l, c[2], k)];
}

/** Gentle film-like S-curve: `k` = 0 identity, 1 = strong. */
function sCurve(x: number, k: number): number {
  const s = x * x * (3 - 2 * x);
  return mix(x, s, k);
}

/** Black lift / highlight roll-off. */
function range(x: number, black: number, white: number): number {
  return black + (white - black) * x;
}

function hueOf(c: Vec3): number {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  if (d < 1e-6) return 0;
  let h: number;
  if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  return (h * 60 + 360) % 360;
}

const satOf = (c: Vec3): number => {
  const mx = Math.max(c[0], c[1], c[2]);
  return mx > 1e-6 ? (mx - Math.min(c[0], c[1], c[2])) / mx : 0;
};

/** Weight (0..1) of how close a hue is to `center` within `width` degrees. */
function hueWeight(h: number, center: number, width: number): number {
  let d = Math.abs(h - center) % 360;
  if (d > 180) d = 360 - d;
  return 1 - smooth(0, width, d);
}

export const BUILTIN_LUTS: BuiltinLutDef[] = [
  {
    id: `${BUILTIN_PREFIX}teal-orange`,
    name: 'Teal & Orange',
    description: 'Blockbuster contrast: teal shadows, warm skin and highlights.',
    look: (c) => {
      let o: Vec3 = [sCurve(c[0], 0.35), sCurve(c[1], 0.35), sCurve(c[2], 0.35)];
      const l = luma709(o[0], o[1], o[2]);
      const shadows = 1 - smooth(0.05, 0.6, l);
      const highs = smooth(0.3, 0.95, l);
      o = add3(o, push(188, 0.075), shadows);
      o = add3(o, push(28, 0.06), highs);
      // Warm hues (skin) get a little richer, greens are pulled towards teal.
      const h = hueOf(c);
      const s = satOf(c);
      o = saturate(o, 1 + 0.18 * hueWeight(h, 25, 40) * s);
      o = add3(o, push(175, 0.05 * hueWeight(h, 110, 50) * s));
      return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
    },
  },
  {
    id: `${BUILTIN_PREFIX}warm-film`,
    name: 'Warm Film',
    description: 'Soft print-film contrast, creamy highlights and lifted blacks.',
    look: (c) => {
      let o: Vec3 = [sCurve(c[0], 0.3), sCurve(c[1], 0.3), sCurve(c[2], 0.3)];
      o = saturate(o, 0.86);
      const l = luma709(o[0], o[1], o[2]);
      o = add3(o, push(38, 0.035), smooth(0.25, 1, l));
      o = add3(o, push(200, 0.02), 1 - smooth(0, 0.45, l));
      // Greens drift towards olive.
      const h = hueOf(c);
      o = add3(o, push(60, 0.035 * hueWeight(h, 120, 45) * satOf(c)));
      return [clamp01(range(o[0], 0.035, 0.97)), clamp01(range(o[1], 0.03, 0.955)), clamp01(range(o[2], 0.04, 0.93))];
    },
  },
  {
    id: `${BUILTIN_PREFIX}bleach-bypass`,
    name: 'Bleach Bypass',
    description: 'Silver-retention look: muted colour, punchy contrast.',
    look: (c) => {
      const l = luma709(c[0], c[1], c[2]);
      const overlay = (b: number, s: number): number => (b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s));
      let o: Vec3 = [overlay(c[0], l), overlay(c[1], l), overlay(c[2], l)];
      o = mix3(c, o, 0.75);
      o = saturate(o, 0.48);
      o = add3(o, push(205, 0.012));
      return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
    },
  },
  {
    id: `${BUILTIN_PREFIX}nordic-cool`,
    name: 'Nordic Cool',
    description: 'Clean, cool and restrained, with a gentle matte.',
    look: (c) => {
      let o: Vec3 = [sCurve(c[0], 0.18), sCurve(c[1], 0.18), sCurve(c[2], 0.18)];
      o = saturate(o, 0.78);
      const l = luma709(o[0], o[1], o[2]);
      o = add3(o, push(215, 0.04), 1 - smooth(0, 0.7, l));
      o = add3(o, push(190, 0.015), smooth(0.4, 1, l));
      return [clamp01(range(o[0], 0.045, 0.985)), clamp01(range(o[1], 0.05, 0.99)), clamp01(range(o[2], 0.06, 1))];
    },
  },
  {
    id: `${BUILTIN_PREFIX}golden-hour`,
    name: 'Golden Hour',
    description: 'Late-afternoon warmth with glowing highlights.',
    look: (c) => {
      const l0 = luma709(c[0], c[1], c[2]);
      // Lift the mids a touch for a soft glow.
      let o: Vec3 = c.map((v) => Math.pow(clamp01(v), 0.9)) as Vec3;
      o = add3(o, push(40, 0.07), smooth(0.2, 0.95, l0));
      o = add3(o, push(330, 0.02), 1 - smooth(0, 0.4, l0));
      const h = hueOf(c);
      o = saturate(o, 1.06 + 0.15 * hueWeight(h, 35, 50) * satOf(c));
      return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
    },
  },
  {
    id: `${BUILTIN_PREFIX}noir`,
    name: 'Noir',
    description: 'Deep black-and-white with a red-filter response and a silver tone.',
    look: (c) => {
      const bw = clamp01(0.5 * c[0] + 0.42 * c[1] + 0.08 * c[2]);
      const v = sCurve(sCurve(bw, 0.6), 0.25);
      let o: Vec3 = [v, v, v];
      o = add3(o, push(210, 0.012), smooth(0.4, 1, v));
      return [clamp01(range(o[0], 0.01, 0.985)), clamp01(range(o[1], 0.01, 0.985)), clamp01(range(o[2], 0.012, 0.99))];
    },
  },
];

export const isBuiltinLut = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);

export function getBuiltinLutDef(id: string): BuiltinLutDef | undefined {
  return BUILTIN_LUTS.find((l) => l.id === id);
}

/** Bake a built-in look into a 3D table. */
export function generateBuiltinLut(id: string, size = BUILTIN_LUT_SIZE): CubeLut | null {
  const def = getBuiltinLutDef(id);
  if (!def) return null;
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const o = def.look([r / (size - 1), g / (size - 1), b / (size - 1)]);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
    }
  }
  return { title: def.name, kind: '3d', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
