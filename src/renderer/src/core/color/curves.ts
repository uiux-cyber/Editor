/**
 * Tone curves (`Grade.curves`): master + R / G / B control points, interpolated with a monotone
 * cubic (Fritsch–Carlson) so a curve never overshoots between its points, and baked into a
 * 256-entry lookup table for the GPU (engine/gl/ext/curves.ts).
 *
 * Composition: each output channel is `channelCurve(masterCurve(input))`.
 */

import type { CurvePoints, Curves } from '../types';

export type CurveChannel = keyof Curves;
export const CURVE_CHANNELS: CurveChannel[] = ['master', 'r', 'g', 'b'];
export const CURVE_LUT_SIZE = 256;
/** Closest two points may get on the x axis. */
export const CURVE_MIN_GAP = 0.01;
export const CURVE_MAX_POINTS = 16;

export const identityCurve = (): CurvePoints => [
  [0, 0],
  [1, 1],
];

export const identityCurves = (): Curves => ({ master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() });

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Normalise user / file data into a valid curve: finite numbers in 0..1, sorted by x, no two
 * points closer than CURVE_MIN_GAP, endpoints at x = 0 and x = 1.
 */
export function sanitizeCurve(points: unknown): CurvePoints {
  if (!Array.isArray(points)) return identityCurve();
  const pts: [number, number][] = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([clamp01(x), clamp01(y)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && p[0] - last[0] < CURVE_MIN_GAP * 0.5) {
      // Duplicate x: keep the later point's value.
      last[1] = p[1];
      continue;
    }
    out.push([p[0], p[1]]);
  }
  if (out.length === 0) return identityCurve();
  if (out[0][0] > 0) {
    if (out[0][0] < CURVE_MIN_GAP) out[0][0] = 0;
    else out.unshift([0, 0]);
  }
  const last = out[out.length - 1];
  if (last[0] < 1) {
    if (1 - last[0] < CURVE_MIN_GAP) last[0] = 1;
    else out.push([1, 1]);
  }
  return out.slice(0, CURVE_MAX_POINTS);
}

export function sanitizeCurves(c: unknown): Curves {
  const src = (c && typeof c === 'object' ? c : {}) as Partial<Record<CurveChannel, unknown>>;
  return { master: sanitizeCurve(src.master), r: sanitizeCurve(src.r), g: sanitizeCurve(src.g), b: sanitizeCurve(src.b) };
}

export function isIdentityCurve(points: CurvePoints | undefined): boolean {
  if (!points || points.length === 0) return true;
  return points.every(([x, y]) => Math.abs(x - y) < 1e-4);
}

export function isIdentityCurves(c: Curves | undefined | null): boolean {
  if (!c) return true;
  return CURVE_CHANNELS.every((ch) => isIdentityCurve(c[ch]));
}

/** Untouched curves: every channel is just the two default end points (no user points). */
export function isDefaultCurves(c: Curves | undefined | null): boolean {
  if (!c) return true;
  return CURVE_CHANNELS.every((ch) => !c[ch] || (c[ch].length <= 2 && isIdentityCurve(c[ch])));
}

/** Monotone cubic interpolant through the points (Fritsch–Carlson tangents). */
export function monotoneCubic(points: CurvePoints): (x: number) => number {
  const pts = points.length >= 2 ? points : identityCurve();
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    d.push(h > 0 ? (ys[i + 1] - ys[i]) / h : 0);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    // Binary search for the segment.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    if (h <= 0) return ys[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi];
  };
}

/** Sample a curve into `size` evenly spaced entries over 0..1 (clamped to 0..1). */
export function curveTable(points: CurvePoints, size = CURVE_LUT_SIZE): Float32Array {
  const f = monotoneCubic(points);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = clamp01(f(i / (size - 1)));
  return out;
}

/**
 * Bake the four curves into an RGBA float table (size × 1): R = r(master(x)), G = g(master(x)),
 * B = b(master(x)), A = master(x).
 */
export function curvesLut(curves: Curves, size = CURVE_LUT_SIZE): Float32Array {
  const master = monotoneCubic(curves.master);
  const r = monotoneCubic(curves.r);
  const g = monotoneCubic(curves.g);
  const b = monotoneCubic(curves.b);
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const m = clamp01(master(i / (size - 1)));
    out[i * 4] = clamp01(r(m));
    out[i * 4 + 1] = clamp01(g(m));
    out[i * 4 + 2] = clamp01(b(m));
    out[i * 4 + 3] = m;
  }
  return out;
}

/** Apply baked curves to a colour exactly like the shader does (linear filtering between entries). */
export function applyCurvesLut(lut: Float32Array, rgb: [number, number, number]): [number, number, number] {
  const size = lut.length / 4;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const x = clamp01(rgb[c]) * (size - 1);
    const i0 = Math.min(size - 1, Math.floor(x));
    const i1 = Math.min(size - 1, i0 + 1);
    const f = x - i0;
    out[c] = lut[i0 * 4 + c] * (1 - f) + lut[i1 * 4 + c] * f;
  }
  return out;
}

/** Insert a point (keeps the curve valid). Returns the new points and the index of the point. */
export function addCurvePoint(points: CurvePoints, x: number, y: number): { points: CurvePoints; index: number } {
  const px = clamp01(x);
  const py = clamp01(y);
  if (points.length >= CURVE_MAX_POINTS) return { points, index: -1 };
  for (const p of points) if (Math.abs(p[0] - px) < CURVE_MIN_GAP) return { points, index: -1 };
  const next = [...points.map((p) => [p[0], p[1]] as [number, number]), [px, py] as [number, number]].sort((a, b) => a[0] - b[0]);
  return { points: next, index: next.findIndex((p) => p[0] === px && p[1] === py) };
}

/**
 * Move point `index` to (x, y). Interior points stay strictly between their neighbours; the
 * endpoints only move vertically.
 */
export function moveCurvePoint(points: CurvePoints, index: number, x: number, y: number): CurvePoints {
  if (index < 0 || index >= points.length) return points;
  const next = points.map((p) => [p[0], p[1]] as [number, number]);
  const last = next.length - 1;
  let nx = clamp01(x);
  if (index === 0) nx = 0;
  else if (index === last) nx = 1;
  else nx = Math.min(next[index + 1][0] - CURVE_MIN_GAP, Math.max(next[index - 1][0] + CURVE_MIN_GAP, nx));
  next[index] = [nx, clamp01(y)];
  return next;
}

/** Remove an interior point (endpoints are reset to the diagonal instead). */
export function removeCurvePoint(points: CurvePoints, index: number): CurvePoints {
  if (index < 0 || index >= points.length) return points;
  const next = points.map((p) => [p[0], p[1]] as [number, number]);
  if (index === 0) next[0] = [0, 0];
  else if (index === next.length - 1) next[index] = [1, 1];
  else next.splice(index, 1);
  return next;
}
