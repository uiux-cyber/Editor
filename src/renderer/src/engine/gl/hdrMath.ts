/**
 * HDR transfer functions and tone-mapping operators, in TypeScript (for tests and probes) and
 * GLSL (for the `hdr` layer extension). Both implementations follow the same formulas so unit
 * tests on the TS side describe what the shader does.
 *
 * Conventions: luminance in nits (cd/m²); SDR reference white = 203 nits (ITU-R BT.2408), which
 * maps to 1.0 in display-linear SDR before the operator compresses highlights.
 */

export type ToneMapOperator = 'aces' | 'hable' | 'reinhard' | 'bt2390' | 'clip';

export const TONE_MAP_OPERATORS: { id: ToneMapOperator; label: string; hint: string }[] = [
  { id: 'bt2390', label: 'BT.2390 (broadcast)', hint: 'ITU-R BT.2390 EETF: keeps mid-tones, rolls highlights off smoothly' },
  { id: 'aces', label: 'ACES filmic', hint: 'Filmic contrast with a soft shoulder' },
  { id: 'hable', label: 'Hable (Uncharted 2)', hint: 'Gentle filmic curve, preserves shadow detail' },
  { id: 'reinhard', label: 'Reinhard', hint: 'Simple, neutral highlight compression' },
  { id: 'clip', label: 'Clip', hint: 'No compression: everything above SDR white clips' },
];

export const OPERATOR_INDEX: Record<ToneMapOperator, number> = { clip: 0, reinhard: 1, hable: 2, aces: 3, bt2390: 4 };

export const SDR_WHITE_NITS = 203;
const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/** PQ (SMPTE ST 2084) signal 0..1 → nits. */
export function pqDecode(e: number): number {
  const p = Math.pow(Math.max(e, 0), 1 / PQ_M2);
  return 10000 * Math.pow(Math.max(p - PQ_C1, 0) / (PQ_C2 - PQ_C3 * p), 1 / PQ_M1);
}

/** Nits → PQ signal 0..1. */
export function pqEncode(nits: number): number {
  const y = Math.pow(Math.max(nits, 0) / 10000, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * y) / (1 + PQ_C3 * y), PQ_M2);
}

const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);

/** HLG inverse OETF: signal 0..1 → scene-linear 0..1 (×1000 nits nominal peak, OOTF γ=1.2 applied separately). */
export function hlgDecode(e: number): number {
  return e <= 0.5 ? (e * e) / 3 : (Math.exp((e - HLG_C) / HLG_A) + HLG_B) / 12;
}

/** sRGB OETF (linear 0..1 → encoded 0..1). */
export function srgbEncode(v: number): number {
  const x = Math.min(Math.max(v, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function hable(x: number): number {
  const A = 0.15,
    B = 0.5,
    C = 0.1,
    D = 0.2,
    E = 0.02,
    F = 0.3;
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}

/**
 * Tone-map one channel of display-linear light, relative to SDR white (1.0 = 203 nits).
 * `peak` is the source peak in the same units (e.g. 1000 nits → 4.93). Output is 0..1 linear.
 */
export function toneMap(op: ToneMapOperator, x: number, peak: number): number {
  const v = Math.max(x, 0);
  switch (op) {
    case 'clip':
      return Math.min(v, 1);
    case 'reinhard': {
      // Extended Reinhard: maps `peak` exactly to 1.
      const w2 = peak * peak;
      return Math.min(1, (v * (1 + v / w2)) / (1 + v));
    }
    case 'hable': {
      const W = Math.max(peak, 1.0001);
      return Math.min(1, hable(v * 2) / hable(W * 2));
    }
    case 'aces': {
      // Narkowicz fit, normalised so SDR white stays close to white.
      const a = 2.51,
        b = 0.03,
        c = 2.43,
        d = 0.59,
        e = 0.14;
      const s = v * 0.8;
      return Math.min(1, Math.max(0, (s * (a * s + b)) / (s * (c * s + d) + e)));
    }
    case 'bt2390': {
      // EETF on PQ-encoded values: source range [0, peak] → target [0, 1] (both relative to SDR white).
      const srcMax = pqEncode(peak * SDR_WHITE_NITS);
      const dstMax = pqEncode(SDR_WHITE_NITS);
      const e1 = pqEncode(v * SDR_WHITE_NITS) / srcMax;
      const maxLum = dstMax / srcMax;
      const ks = 1.5 * maxLum - 0.5;
      let e2 = e1;
      if (e1 > ks && ks < 1) {
        const t = (e1 - ks) / (1 - ks);
        const t2 = t * t;
        const t3 = t2 * t;
        e2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum;
      }
      return Math.min(1, pqDecode(Math.min(e2, 1) * srcMax) / SDR_WHITE_NITS);
    }
  }
}

/** GLSL equivalents. Every identifier is prefixed `ext_hdr_` (layer extension convention). */
export const HDR_GLSL = /* glsl */ `
const float ext_hdr_M1 = ${PQ_M1.toFixed(10)};
const float ext_hdr_M2 = ${PQ_M2.toFixed(10)};
const float ext_hdr_C1 = ${PQ_C1.toFixed(10)};
const float ext_hdr_C2 = ${PQ_C2.toFixed(10)};
const float ext_hdr_C3 = ${PQ_C3.toFixed(10)};
const float ext_hdr_WHITE = ${SDR_WHITE_NITS.toFixed(1)};

vec3 ext_hdr_pqDecode(vec3 e) {
  vec3 p = pow(max(e, 0.0), vec3(1.0 / ext_hdr_M2));
  return 10000.0 * pow(max(p - ext_hdr_C1, 0.0) / (ext_hdr_C2 - ext_hdr_C3 * p), vec3(1.0 / ext_hdr_M1));
}
float ext_hdr_pqEncode1(float nits) {
  float y = pow(max(nits, 0.0) / 10000.0, ext_hdr_M1);
  return pow((ext_hdr_C1 + ext_hdr_C2 * y) / (1.0 + ext_hdr_C3 * y), ext_hdr_M2);
}
float ext_hdr_pqDecode1(float e) {
  float p = pow(max(e, 0.0), 1.0 / ext_hdr_M2);
  return 10000.0 * pow(max(p - ext_hdr_C1, 0.0) / (ext_hdr_C2 - ext_hdr_C3 * p), 1.0 / ext_hdr_M1);
}
vec3 ext_hdr_hlgDecode(vec3 e) {
  const float a = ${HLG_A.toFixed(8)};
  const float b = ${HLG_B.toFixed(8)};
  const float c = ${HLG_C.toFixed(8)};
  vec3 lo = e * e / 3.0;
  vec3 hi = (exp((e - c) / a) + b) / 12.0;
  return mix(lo, hi, step(vec3(0.5), e));
}
float ext_hdr_hable(float x) {
  return (x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06) - 0.02 / 0.3;
}
float ext_hdr_map1(int op, float x, float peak) {
  float v = max(x, 0.0);
  if (op == 1) { float w2 = peak * peak; return min(1.0, v * (1.0 + v / w2) / (1.0 + v)); }
  if (op == 2) { float W = max(peak, 1.0001); return min(1.0, ext_hdr_hable(v * 2.0) / ext_hdr_hable(W * 2.0)); }
  if (op == 3) { float s = v * 0.8; return clamp(s * (2.51 * s + 0.03) / (s * (2.43 * s + 0.59) + 0.14), 0.0, 1.0); }
  if (op == 4) {
    float srcMax = ext_hdr_pqEncode1(peak * ext_hdr_WHITE);
    float dstMax = ext_hdr_pqEncode1(ext_hdr_WHITE);
    float e1 = ext_hdr_pqEncode1(v * ext_hdr_WHITE) / srcMax;
    float maxLum = dstMax / srcMax;
    float ks = 1.5 * maxLum - 0.5;
    float e2 = e1;
    if (e1 > ks && ks < 1.0) {
      float t = (e1 - ks) / (1.0 - ks);
      float t2 = t * t;
      float t3 = t2 * t;
      e2 = (2.0 * t3 - 3.0 * t2 + 1.0) * ks + (t3 - 2.0 * t2 + t) * (1.0 - ks) + (-2.0 * t3 + 3.0 * t2) * maxLum;
    }
    return min(1.0, ext_hdr_pqDecode1(min(e2, 1.0) * srcMax) / ext_hdr_WHITE);
  }
  return min(v, 1.0);
}
// BT.2020 → BT.709 primaries (linear light).
const mat3 ext_hdr_2020to709 = mat3(
  1.6604910, -0.1245505, -0.0181508,
  -0.5876411, 1.1328999, -0.1005789,
  -0.0728499, -0.0083494, 1.1187297);
vec3 ext_hdr_srgbEncode(vec3 v) {
  v = clamp(v, 0.0, 1.0);
  return mix(12.92 * v, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), v));
}
`;
