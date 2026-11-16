/**
 * Colour grading shared by the Adjust panel and the filter presets.
 *
 * `gradeColor` is the single source of truth for how each `Grade` field (see core/types.ts)
 * changes a pixel. It works on straight-alpha, display-referred RGB in 0..1.
 *
 * Order of operations:
 *   exposure → temperature/tint → brightness → contrast → highlights/shadows → gamma → hue →
 *   saturation → vibrance → split toning → mono toning → fade
 * The spatial terms (sharpen, vignette, grain) are applied by the layer shader around this.
 */

import { NEUTRAL_GRADE } from '@/core/factory';
import type { FilterRef, Grade } from '@/core/types';
import { getFilter } from '@/library';
import { hexToRgba, type Program } from './shaderlib';

export const GRADE_GLSL = `
struct Grade {
  float exposure;
  float brightness;
  float contrast;
  float saturation;
  float vibrance;
  float temperature;
  float tint;
  float hue;
  float highlights;
  float shadows;
  float fade;
  float gamma;
  float shadowTintAmount;
  float highlightTintAmount;
  float mono;
  vec3 shadowTint;
  vec3 highlightTint;
  vec3 monoTint;
};

// Hue and saturation of a tint colour, independent of how bright it was picked.
vec3 gradeChroma(vec3 tint) {
  vec3 t = tint / max(max(tint.r, max(tint.g, tint.b)), 0.001);
  return t - vec3(luma(t));
}

vec3 gradeColor(vec3 c, Grade g) {
  // Exposure in stops.
  c *= exp2(g.exposure);

  // White balance: warm ↔ cool on the red/blue axis, green ↔ magenta on the tint axis.
  c.r *= 1.0 + 0.22 * g.temperature;
  c.b *= 1.0 - 0.22 * g.temperature;
  c.g *= 1.0 - 0.18 * g.tint;
  c.rb *= 1.0 + 0.06 * g.tint;

  // Brightness is a plain offset (±0.5 at the extremes).
  c += g.brightness * 0.5;

  // Contrast pivots on mid grey: -1 → flat grey, +1 → doubled slope.
  c = (c - 0.5) * (1.0 + g.contrast) + 0.5;

  // Highlights / shadows: lift or lower the two ends of the tonal range.
  float l = clamp(luma(c), 0.0, 1.0);
  float shadowW = 1.0 - smoothstep(0.0, 0.55, l);
  float highW = smoothstep(0.45, 1.0, l);
  c += g.shadows * 0.30 * shadowW;
  c += g.highlights * 0.30 * highW;

  c = max(c, vec3(0.0));

  // Midtone gamma: positive values brighten the mids, endpoints stay fixed.
  c = pow(c, vec3(exp2(-g.gamma)));

  // Hue rotation (radians) around the luminance axis.
  if (abs(g.hue) > 0.0001) {
    float cs = cos(g.hue);
    float sn = sin(g.hue);
    vec3 k = vec3(0.57735);
    c = c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
  }

  // Saturation: -1 → greyscale, +1 → doubled.
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + g.saturation);

  // Vibrance boosts muted colours more than already-saturated ones.
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + g.vibrance * (1.0 - clamp(mx - mn, 0.0, 1.0)));

  // Split toning: push a hue into the shadows and another into the highlights.
  l = clamp(luma(c), 0.0, 1.0);
  c += gradeChroma(g.shadowTint) * g.shadowTintAmount * (1.0 - smoothstep(0.0, 0.6, l)) * 0.6;
  c += gradeChroma(g.highlightTint) * g.highlightTintAmount * smoothstep(0.4, 1.0, l) * 0.6;

  // Monochrome toning: luminance multiplied by the (luminance-normalised) tone colour.
  if (g.mono > 0.0) {
    float ml = luma(c);
    vec3 tone = g.monoTint / max(luma(g.monoTint), 0.001);
    c = mix(c, clamp(ml * tone, 0.0, 1.0), g.mono);
  }

  // Fade lifts the blacks towards grey for a matte look (white stays white).
  c = mix(c, c * 0.72 + 0.20, g.fade);

  return clamp(c, 0.0, 1.0);
}
`;

const SCALARS = [
  'exposure',
  'brightness',
  'contrast',
  'saturation',
  'vibrance',
  'temperature',
  'tint',
  'hue',
  'highlights',
  'shadows',
  'fade',
  'gamma',
  'shadowTintAmount',
  'highlightTintAmount',
  'mono',
] as const;

/** Resolve a filter reference into a full grade, scaled by its intensity. */
export function resolveFilterGrade(filter: FilterRef | undefined): Grade | null {
  if (!filter || filter.intensity <= 0) return null;
  const def = getFilter(filter.id);
  if (!def) return null;
  const k = Math.min(1, Math.max(0, filter.intensity));
  const g: Grade = { ...NEUTRAL_GRADE, ...def.grade };
  for (const key of [...SCALARS, 'vignette', 'grain', 'sharpen'] as const) g[key] *= k;
  return g;
}

export function isNeutralGrade(g: Partial<Grade> | null | undefined): boolean {
  if (!g) return true;
  for (const key of [...SCALARS, 'vignette', 'grain', 'sharpen'] as const) {
    if (key === 'shadowTintAmount' || key === 'highlightTintAmount') continue;
    if (g[key]) return false;
  }
  return !g.shadowTintAmount && !g.highlightTintAmount;
}

/** Upload a grade into a `uniform Grade <name>;` struct. */
export function setGradeUniforms(gl: WebGL2RenderingContext, prog: Program, name: string, grade: Partial<Grade> | null): void {
  const g = grade ? { ...NEUTRAL_GRADE, ...grade } : NEUTRAL_GRADE;
  for (const key of SCALARS) {
    const loc = prog.loc(`${name}.${key}`);
    if (loc) gl.uniform1f(loc, key === 'hue' ? (g.hue * Math.PI) / 180 : g[key]);
  }
  for (const key of ['shadowTint', 'highlightTint', 'monoTint'] as const) {
    const loc = prog.loc(`${name}.${key}`);
    if (loc) {
      const [r, gg, b] = hexToRgba(g[key]);
      gl.uniform3f(loc, r, gg, b);
    }
  }
}
