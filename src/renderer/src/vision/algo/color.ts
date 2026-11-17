/**
 * Colour matching.
 *
 * The look of a clip is summarised in CIELAB (perceptual): mean / standard deviation of L, a, b,
 * the mean chroma, and shadow / midtone / highlight percentiles of L. Matching searches the
 * clip's Adjust parameters (exposure, contrast, highlights, shadows, midtones, temperature, tint,
 * saturation) so that the *rendered* source — passed through an exact port of the GPU grade
 * (`engine/gl/grade.ts`) — has the reference's statistics. Because the result is ordinary
 * Adjust values it stays editable, and preview / export render exactly what was optimised.
 *
 * Pure and dependency-free so it runs in the vision worker and in unit tests.
 */

import type { Grade } from '@/core/types';

export type GradeInput = Partial<Grade>;

// ---------------------------------------------------------------------------------------------
// Grade (port of GRADE_GLSL)
// ---------------------------------------------------------------------------------------------

const NEUTRAL: Grade = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
  fade: 0,
  gamma: 0,
  shadowTintAmount: 0,
  shadowTint: '#000000',
  highlightTintAmount: 0,
  highlightTint: '#ffffff',
  mono: 0,
  monoTint: '#ffffff',
  vignette: 0,
  grain: 0,
  sharpen: 0,
};

function hexRgb(hex: string | undefined): [number, number, number] {
  const h = (hex ?? '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Pre-resolved grade for fast per-pixel evaluation. */
export interface CompiledGrade {
  g: Grade;
  shadowChroma: [number, number, number];
  highlightChroma: [number, number, number];
  monoTone: [number, number, number];
  hueRad: number;
}

function chroma(tint: [number, number, number]): [number, number, number] {
  const m = Math.max(tint[0], tint[1], tint[2], 0.001);
  const t: [number, number, number] = [tint[0] / m, tint[1] / m, tint[2] / m];
  const l = luma(t[0], t[1], t[2]);
  return [t[0] - l, t[1] - l, t[2] - l];
}

export function compileGrade(input: GradeInput | null | undefined): CompiledGrade | null {
  if (!input) return null;
  const g: Grade = { ...NEUTRAL, ...input };
  const mono = hexRgb(g.monoTint);
  const ml = Math.max(luma(mono[0], mono[1], mono[2]), 0.001);
  return {
    g,
    shadowChroma: chroma(hexRgb(g.shadowTint)),
    highlightChroma: chroma(hexRgb(g.highlightTint)),
    monoTone: [mono[0] / ml, mono[1] / ml, mono[2] / ml],
    hueRad: (g.hue * Math.PI) / 180,
  };
}

/** Grade one straight-alpha display-referred colour (0..1), in place on `c`. */
export function gradeColor(c: Float32Array | number[], cg: CompiledGrade): void {
  const g = cg.g;
  let r = c[0];
  let gg = c[1];
  let b = c[2];
  const e = Math.pow(2, g.exposure);
  r *= e;
  gg *= e;
  b *= e;
  r *= 1 + 0.22 * g.temperature;
  b *= 1 - 0.22 * g.temperature;
  gg *= 1 - 0.18 * g.tint;
  r *= 1 + 0.06 * g.tint;
  b *= 1 + 0.06 * g.tint;
  const br = g.brightness * 0.5;
  r += br;
  gg += br;
  b += br;
  const k = 1 + g.contrast;
  r = (r - 0.5) * k + 0.5;
  gg = (gg - 0.5) * k + 0.5;
  b = (b - 0.5) * k + 0.5;
  let l = clamp01(luma(r, gg, b));
  const sw = 1 - smoothstep(0, 0.55, l);
  const hw = smoothstep(0.45, 1, l);
  const lift = g.shadows * 0.3 * sw + g.highlights * 0.3 * hw;
  r = Math.max(0, r + lift);
  gg = Math.max(0, gg + lift);
  b = Math.max(0, b + lift);
  if (g.gamma) {
    const p = Math.pow(2, -g.gamma);
    r = Math.pow(r, p);
    gg = Math.pow(gg, p);
    b = Math.pow(b, p);
  }
  if (Math.abs(cg.hueRad) > 0.0001) {
    const cs = Math.cos(cg.hueRad);
    const sn = Math.sin(cg.hueRad);
    const kk = 0.57735;
    const dot = kk * (r + gg + b);
    // c*cos + cross(k, c)*sin + k*dot(k,c)*(1-cos)
    const cx = kk * (b - gg);
    const cy = kk * (r - b);
    const cz = kk * (gg - r);
    const nr = r * cs + cx * sn + kk * dot * (1 - cs);
    const ng = gg * cs + cy * sn + kk * dot * (1 - cs);
    const nb = b * cs + cz * sn + kk * dot * (1 - cs);
    r = nr;
    gg = ng;
    b = nb;
  }
  l = luma(r, gg, b);
  const s = 1 + g.saturation;
  r = l + (r - l) * s;
  gg = l + (gg - l) * s;
  b = l + (b - l) * s;
  if (g.vibrance) {
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    const v = 1 + g.vibrance * (1 - clamp01(mx - mn));
    r = l + (r - l) * v;
    gg = l + (gg - l) * v;
    b = l + (b - l) * v;
  }
  if (g.shadowTintAmount || g.highlightTintAmount) {
    l = clamp01(luma(r, gg, b));
    const ws = g.shadowTintAmount * (1 - smoothstep(0, 0.6, l)) * 0.6;
    const wh = g.highlightTintAmount * smoothstep(0.4, 1, l) * 0.6;
    r += cg.shadowChroma[0] * ws + cg.highlightChroma[0] * wh;
    gg += cg.shadowChroma[1] * ws + cg.highlightChroma[1] * wh;
    b += cg.shadowChroma[2] * ws + cg.highlightChroma[2] * wh;
  }
  if (g.mono > 0) {
    const ml = luma(r, gg, b);
    r += (clamp01(ml * cg.monoTone[0]) - r) * g.mono;
    gg += (clamp01(ml * cg.monoTone[1]) - gg) * g.mono;
    b += (clamp01(ml * cg.monoTone[2]) - b) * g.mono;
  }
  if (g.fade) {
    r += (r * 0.72 + 0.2 - r) * g.fade;
    gg += (gg * 0.72 + 0.2 - gg) * g.fade;
    b += (b * 0.72 + 0.2 - b) * g.fade;
  }
  c[0] = clamp01(r);
  c[1] = clamp01(gg);
  c[2] = clamp01(b);
}

/** Apply a chain of grades (e.g. Adjust then Filter) to packed RGB floats; returns a new array. */
export function gradePixels(rgb: Float32Array, grades: (CompiledGrade | null)[]): Float32Array {
  const out = new Float32Array(rgb.length);
  const c = new Float32Array(3);
  const active = grades.filter((g): g is CompiledGrade => !!g);
  for (let i = 0; i < rgb.length; i += 3) {
    c[0] = rgb[i];
    c[1] = rgb[i + 1];
    c[2] = rgb[i + 2];
    for (const g of active) gradeColor(c, g);
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CIELAB statistics
// ---------------------------------------------------------------------------------------------

const SRGB_LUT = new Float32Array(4096);
for (let i = 0; i < 4096; i++) {
  const v = i / 4095;
  SRGB_LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const toLinear = (v: number): number => SRGB_LUT[Math.round(clamp01(v) * 4095)];
const fLab = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0..1, display encoded) → CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number, out: Float32Array | number[]): void {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(X);
  const fy = fLab(Y);
  const fz = fLab(Z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
}

export interface LabStats {
  meanL: number;
  stdL: number;
  meanA: number;
  stdA: number;
  meanB: number;
  stdB: number;
  /** Mean chroma √(a² + b²). */
  meanC: number;
  /** L percentiles: shadows (5 %), midtones (50 %), highlights (95 %). */
  p05: number;
  p50: number;
  p95: number;
  /**
   * Colour of the dark / middle / bright third of the pixels (ranked by L, so the zones follow the
   * same picture content when the exposure changes): mean a, b and chroma per zone.
   */
  zoneA: [number, number, number];
  zoneB: [number, number, number];
  zoneC: [number, number, number];
}

const HIST_BINS = 512;

/** Statistics of packed RGB floats (0..1). */
export function labStats(rgb: Float32Array): LabStats {
  const n = Math.max(1, Math.floor(rgb.length / 3));
  const lab = new Float32Array(n * 3);
  const px = new Float32Array(3);
  const hist = new Uint32Array(HIST_BINS);
  let sL = 0;
  let sL2 = 0;
  let sA = 0;
  let sA2 = 0;
  let sB = 0;
  let sB2 = 0;
  let sC = 0;
  for (let i = 0; i < n; i++) {
    rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], px);
    const L = px[0];
    const a = px[1];
    const b = px[2];
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
    sL += L;
    sL2 += L * L;
    sA += a;
    sA2 += a * a;
    sB += b;
    sB2 += b * b;
    sC += Math.hypot(a, b);
    hist[Math.min(HIST_BINS - 1, Math.max(0, Math.floor((L / 100) * HIST_BINS)))]++;
  }
  const pct = (q: number): number => {
    const target = q * n;
    let acc = 0;
    for (let i = 0; i < HIST_BINS; i++) {
      const next = acc + hist[i];
      if (next >= target) {
        const frac = hist[i] ? (target - acc) / hist[i] : 0;
        return ((i + frac) / HIST_BINS) * 100;
      }
      acc = next;
    }
    return 100;
  };
  // Rank zones: the darkest / middle / brightest third of the pixels (thresholds from the
  // L histogram, so this stays linear in the number of pixels).
  const t1 = pct(1 / 3);
  const t2 = pct(2 / 3);
  const zoneA: [number, number, number] = [0, 0, 0];
  const zoneB: [number, number, number] = [0, 0, 0];
  const zoneC: [number, number, number] = [0, 0, 0];
  const counts = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3];
    const z = L < t1 ? 0 : L < t2 ? 1 : 2;
    zoneA[z] += lab[i * 3 + 1];
    zoneB[z] += lab[i * 3 + 2];
    zoneC[z] += Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]);
    counts[z]++;
  }
  for (let z = 0; z < 3; z++) {
    const c = Math.max(1, counts[z]);
    zoneA[z] /= c;
    zoneB[z] /= c;
    zoneC[z] /= c;
  }
  const mean = (v: number): number => v / n;
  const std = (v: number, v2: number): number => Math.sqrt(Math.max(0, v2 / n - (v / n) ** 2));
  return {
    meanL: mean(sL),
    stdL: std(sL, sL2),
    meanA: mean(sA),
    stdA: std(sA, sA2),
    meanB: mean(sB),
    stdB: std(sB, sB2),
    meanC: mean(sC),
    p05: pct(0.05),
    p50: pct(0.5),
    p95: pct(0.95),
    zoneA,
    zoneB,
    zoneC,
  };
}

/** Weighted residuals between two stat sets (each roughly "1 = clearly different"). */
export function statResiduals(a: LabStats, b: LabStats): number[] {
  return [
    (a.meanL - b.meanL) / 6,
    (a.stdL - b.stdL) / 5,
    (a.p05 - b.p05) / 7,
    (a.p50 - b.p50) / 7,
    (a.p95 - b.p95) / 7,
    (a.meanA - b.meanA) / 3,
    (a.meanB - b.meanB) / 3,
    (a.meanC - b.meanC) / 4,
    (a.stdA - b.stdA) / 5,
    (a.stdB - b.stdB) / 5,
    ...[0, 1, 2].flatMap((z) => [(a.zoneA[z] - b.zoneA[z]) / 4, (a.zoneB[z] - b.zoneB[z]) / 4, (a.zoneC[z] - b.zoneC[z]) / 5]),
  ];
}

/** Root-mean-square of the stat residuals — 0 is a perfect match, < 0.5 is visually close. */
export function statDistance(a: LabStats, b: LabStats): number {
  const r = statResiduals(a, b);
  return Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length);
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Adjust fields solved by the matcher, with their ranges. */
export const MATCH_PARAMS = [
  { key: 'exposure', min: -2, max: 2 },
  { key: 'contrast', min: -0.8, max: 1 },
  { key: 'highlights', min: -1, max: 1 },
  { key: 'shadows', min: -1, max: 1 },
  { key: 'gamma', min: -1, max: 1 },
  { key: 'temperature', min: -1, max: 1 },
  { key: 'tint', min: -1, max: 1 },
  { key: 'saturation', min: -1, max: 1 },
] as const;

export type MatchKey = (typeof MATCH_PARAMS)[number]['key'];

export interface MatchInput {
  /** Packed RGB samples (0..1) of the clip to correct, before any grade. */
  source: Float32Array;
  /** Packed RGB samples of the reference as it is displayed (after its own grade). */
  target: Float32Array;
  /** The clip's current Adjust; fields other than the solved ones are kept. */
  baseAdjust?: GradeInput;
  /** The clip's filter (applied after Adjust by the renderer), resolved to a grade. */
  filter?: GradeInput | null;
  /** 0..1 how far to move towards the reference (default 1). */
  strength?: number;
  iterations?: number;
}

export interface MatchResult {
  adjust: GradeInput;
  /** Stats of the source as displayed before / after, and of the target. */
  before: LabStats;
  after: LabStats;
  target: LabStats;
  /** statDistance before and after. */
  distanceBefore: number;
  distanceAfter: number;
}

/** Mix two stat sets (used for partial strength). */
function mixStats(a: LabStats, b: LabStats, k: number): LabStats {
  const m = (x: number, y: number): number => x + (y - x) * k;
  const z = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  return {
    meanL: m(a.meanL, b.meanL),
    stdL: m(a.stdL, b.stdL),
    meanA: m(a.meanA, b.meanA),
    stdA: m(a.stdA, b.stdA),
    meanB: m(a.meanB, b.meanB),
    stdB: m(a.stdB, b.stdB),
    meanC: m(a.meanC, b.meanC),
    p05: m(a.p05, b.p05),
    p50: m(a.p50, b.p50),
    p95: m(a.p95, b.p95),
    zoneA: z(a.zoneA, b.zoneA),
    zoneB: z(a.zoneB, b.zoneB),
    zoneC: z(a.zoneC, b.zoneC),
  };
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

type Residuals = (p: number[]) => number[];
const sumSq = (r: number[]): number => r.reduce((s, v) => s + v * v, 0);

/**
 * Levenberg–Marquardt with a numeric Jacobian over the `active` parameters, projected onto the
 * parameter bounds after every step.
 */
function levenbergMarquardt(p0: number[], active: number[], residuals: Residuals, iterations: number): { p: number[]; cost: number } {
  const clampP = (p: number[]): number[] => p.map((v, i) => Math.min(MATCH_PARAMS[i].max, Math.max(MATCH_PARAMS[i].min, v)));
  let p = clampP(p0);
  let r = residuals(p);
  let c = sumSq(r);
  let lambda = 1e-2;
  const P = active.length;
  for (let it = 0; it < iterations; it++) {
    const J: number[][] = [];
    const h = 1e-3;
    for (const j of active) {
      const q = p.slice();
      q[j] += q[j] + h > MATCH_PARAMS[j].max ? -h : h;
      const step = q[j] - p[j];
      const rq = residuals(q);
      J.push(rq.map((v, i) => (v - r[i]) / step));
    }
    const JtJ: number[][] = [];
    const Jtr: number[] = [];
    for (let a = 0; a < P; a++) {
      JtJ.push(new Array<number>(P).fill(0));
      let s1 = 0;
      for (let i = 0; i < r.length; i++) s1 += J[a][i] * r[i];
      Jtr.push(-s1);
      for (let b = 0; b < P; b++) {
        let s2 = 0;
        for (let i = 0; i < r.length; i++) s2 += J[a][i] * J[b][i];
        JtJ[a][b] = s2;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
      const delta = solve(A, Jtr);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const q = p.slice();
      active.forEach((j, k) => (q[j] += delta[k]));
      const qc = clampP(q);
      const rq = residuals(qc);
      const cq = sumSq(rq);
      if (cq < c) {
        const gain = c - cq;
        p = qc;
        r = rq;
        c = cq;
        lambda = Math.max(1e-6, lambda / 3);
        improved = gain > 1e-7;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return { p, cost: c };
}

/** Find Adjust values that make the source look like the target. */
export function matchColors(input: MatchInput): MatchResult {
  const base: GradeInput = { ...(input.baseAdjust ?? {}) };
  const filter = compileGrade(input.filter ?? null);
  const target0 = labStats(input.target);
  const render = (adj: GradeInput): LabStats => labStats(gradePixels(input.source, [compileGrade(adj), filter]));
  const before = render(base);
  const strength = Math.min(1, Math.max(0, input.strength ?? 1));
  const target = strength >= 1 ? target0 : mixStats(before, target0, strength);

  const P = MATCH_PARAMS.length;
  const idx = (k: MatchKey): number => MATCH_PARAMS.findIndex((d) => d.key === k);
  const toAdjust = (p: number[]): GradeInput => {
    const out: GradeInput = { ...base };
    MATCH_PARAMS.forEach((d, i) => ((out as Record<string, number>)[d.key] = p[i]));
    return out;
  };
  // Prefer small, editable values — and primary corrections (exposure, contrast, white balance,
  // saturation) over the secondary tone controls, the way a colourist would.
  const REG: Record<MatchKey, number> = { exposure: 0.04, contrast: 0.05, temperature: 0.04, tint: 0.04, saturation: 0.04, highlights: 0.16, shadows: 0.16, gamma: 0.12 };
  const regs = MATCH_PARAMS.map((d) => REG[d.key]);
  const regTerms = (p: number[]): number[] => p.map((v, i) => v * regs[i]);
  const all: Residuals = (p) => [...statResiduals(render(toAdjust(p)), target), ...regTerms(p)];
  // Residual subsets for the staged solve (indices into statResiduals).
  const pick = (ids: number[]): Residuals => (p) => {
    const r = statResiduals(render(toAdjust(p)), target);
    return [...ids.map((i) => r[i]), ...regTerms(p)];
  };
  const TONE = [0, 1, 2, 3, 4];
  const COLOUR = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const toneParams = (['exposure', 'contrast', 'highlights', 'shadows', 'gamma'] as MatchKey[]).map(idx);
  const colourParams = (['temperature', 'tint', 'saturation'] as MatchKey[]).map(idx);
  const allParams = MATCH_PARAMS.map((_, i) => i);
  const iterations = input.iterations ?? 40;

  // Candidate 1: tone first, then colour, then everything together (avoids trading a colour
  // cast against exposure). Candidate 2: everything at once from neutral. Keep the better.
  const zero = new Array<number>(P).fill(0);
  const tone = levenbergMarquardt(zero, toneParams, pick(TONE), iterations);
  const colour = levenbergMarquardt(tone.p, colourParams, pick(COLOUR), iterations);
  const staged = levenbergMarquardt(colour.p, allParams, all, iterations);
  const joint = levenbergMarquardt(zero, allParams, all, iterations);
  const best = staged.cost <= joint.cost ? staged : joint;

  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const adjust = toAdjust(best.p.map(round));
  const after = render(adjust);
  return { adjust, before, after, target: target0, distanceBefore: statDistance(before, target0), distanceAfter: statDistance(after, target0) };
}

/** Pack RGBA bytes into RGB floats, sub-sampling to at most `max` pixels. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array, max = Infinity): Float32Array {
  const n = rgba.length >> 2;
  const step = Math.max(1, Math.ceil(n / max));
  const count = Math.ceil(n / step);
  const out = new Float32Array(count * 3);
  for (let i = 0, k = 0; i < n && k < count; i += step, k++) {
    out[k * 3] = rgba[i * 4] / 255;
    out[k * 3 + 1] = rgba[i * 4 + 1] / 255;
    out[k * 3 + 2] = rgba[i * 4 + 2] / 255;
  }
  return out;
}
