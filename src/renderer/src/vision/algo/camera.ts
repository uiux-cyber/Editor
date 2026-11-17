/**
 * Virtual camera for auto-reframe: turns noisy per-sample subject positions into a calm, eased
 * camera path (normalised 0..1 source coordinates).
 *
 * Pipeline
 *   1. low-confidence samples are replaced by interpolation from their confident neighbours;
 *   2. a median filter removes single-sample detection spikes;
 *   3. a zero-phase Gaussian removes detector jitter;
 *   4. a dead-zone (hysteresis) camera only moves once the subject drifts outside a tolerance
 *      window, so small motions never wobble the frame;
 *   5. a second short Gaussian rounds the starts / stops of moves;
 *   6. Ramer–Douglas–Peucker reduces the path to sparse keyframes whose easing is chosen per
 *      segment (holds, eased moves, linear pans through intermediate keys).
 *
 * Pure and dependency-free (besides easing) so it can be unit tested.
 */

import { applyEase } from '@/core/easing';
import type { EaseId } from '@/core/types';

export interface FocusSample {
  /** Seconds (source time). */
  t: number;
  /** Subject centre, 0..1 of the source picture. */
  x: number;
  y: number;
  /** 0..1; samples below `minConfidence` are treated as unknown. */
  conf: number;
}

export interface CameraKey {
  t: number;
  x: number;
  y: number;
  /** Easing from this key to the next. */
  ease: EaseId;
}

export interface CameraOptions {
  /** Half-width of the dead zone, in picture fractions (default 0.045). */
  deadzone?: number;
  /** Sigma of the jitter filter, seconds (default 0.45). */
  smoothSec?: number;
  /** Sigma of the corner rounding, seconds (default 0.25). */
  roundSec?: number;
  /** Simplification tolerance, picture fractions (default 0.012). */
  tolerance?: number;
  /** Samples below this confidence are interpolated (default 0.15). */
  minConfidence?: number;
}

const finite = (v: number): boolean => Number.isFinite(v);

/** Replace NaN entries by linear interpolation (holding at the ends). */
export function fillGaps(values: number[]): number[] {
  const out = values.slice();
  const known = out.map((v, i) => (finite(v) ? i : -1)).filter((i) => i >= 0);
  if (known.length === 0) return out.map(() => 0.5);
  for (let i = 0; i < out.length; i++) {
    if (finite(out[i])) continue;
    let lo = -1;
    let hi = -1;
    for (const k of known) {
      if (k < i) lo = k;
      else {
        hi = k;
        break;
      }
    }
    if (lo < 0) out[i] = out[hi];
    else if (hi < 0) out[i] = out[lo];
    else out[i] = out[lo] + ((out[hi] - out[lo]) * (i - lo)) / (hi - lo);
  }
  return out;
}

export function medianFilter(values: number[], radius: number): number[] {
  if (radius <= 0) return values.slice();
  const out = new Array<number>(values.length);
  const win: number[] = [];
  for (let i = 0; i < values.length; i++) {
    win.length = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++) win.push(values[k]);
    win.sort((a, b) => a - b);
    out[i] = win[win.length >> 1];
  }
  return out;
}

/** Zero-phase Gaussian smoothing with reflected edges; sigma in samples. */
export function gaussianSmooth(values: number[], sigma: number, weights?: number[]): number[] {
  if (sigma < 0.3 || values.length < 3) return values.slice();
  const r = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let k = -r; k <= r; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (j < 0) j = -j;
      if (j >= n) j = 2 * (n - 1) - j;
      j = Math.min(n - 1, Math.max(0, j));
      const w = kernel[k + r] * (weights ? Math.max(1e-3, weights[j]) : 1);
      s += values[j] * w;
      ws += w;
    }
    out[i] = s / ws;
  }
  return out;
}

/** Dead-zone camera: holds still until the target leaves the window, then follows its edge. */
export function deadzoneFollow(values: number[], dz: number): number[] {
  if (values.length === 0) return [];
  const out = new Array<number>(values.length);
  let c = values[0];
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - c;
    if (d > dz) c = values[i] - dz;
    else if (d < -dz) c = values[i] + dz;
    out[i] = c;
  }
  // Re-centre during long holds: once the subject has settled, ease the camera onto it. This is
  // done by a second pass from the other end so the result stays zero-phase.
  let c2 = values[values.length - 1];
  const back = new Array<number>(values.length);
  for (let i = values.length - 1; i >= 0; i--) {
    const d = values[i] - c2;
    if (d > dz) c2 = values[i] - dz;
    else if (d < -dz) c2 = values[i] + dz;
    back[i] = c2;
  }
  return out.map((v, i) => (v + back[i]) / 2);
}

interface Pt {
  t: number;
  x: number;
  y: number;
}

/** Ramer–Douglas–Peucker on (t, x, y) with the error measured in x / y only. Returns indices. */
export function simplify(points: Pt[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a];
    const pb = points[b];
    let worst = -1;
    let worstErr = tolerance;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const u = pb.t > pa.t ? (p.t - pa.t) / (pb.t - pa.t) : 0;
      const ex = p.x - (pa.x + (pb.x - pa.x) * u);
      const ey = p.y - (pa.y + (pb.y - pa.y) * u);
      const err = Math.hypot(ex, ey);
      if (err > worstErr) {
        worstErr = err;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** Smooth focus samples into sparse camera keyframes. */
export function smoothCameraPath(input: FocusSample[], opts: CameraOptions = {}): CameraKey[] {
  const samples = input.filter((s) => finite(s.t) && finite(s.x) && finite(s.y)).sort((a, b) => a.t - b.t);
  if (samples.length === 0) return [];
  if (samples.length === 1) return [{ t: samples[0].t, x: samples[0].x, y: samples[0].y, ease: 'linear' }];
  const dz = opts.deadzone ?? 0.045;
  const minConf = opts.minConfidence ?? 0.15;
  const tol = opts.tolerance ?? 0.012;
  const span = samples[samples.length - 1].t - samples[0].t;
  const dt = span / Math.max(1, samples.length - 1) || 0.2;

  const anyConfident = samples.some((s) => s.conf >= minConf);
  const pick = (s: FocusSample, v: number): number => (!anyConfident || s.conf >= minConf ? v : NaN);
  let xs = fillGaps(samples.map((s) => pick(s, s.x)));
  let ys = fillGaps(samples.map((s) => pick(s, s.y)));
  const weights = samples.map((s) => (s.conf >= minConf ? 0.4 + 0.6 * Math.min(1, s.conf) : 0.15));

  xs = medianFilter(xs, 2);
  ys = medianFilter(ys, 2);
  const sigma = (opts.smoothSec ?? 0.45) / dt;
  xs = gaussianSmooth(xs, sigma, weights);
  ys = gaussianSmooth(ys, sigma, weights);
  xs = deadzoneFollow(xs, dz);
  ys = deadzoneFollow(ys, dz);
  const round = (opts.roundSec ?? 0.25) / dt;
  xs = gaussianSmooth(xs, round);
  ys = gaussianSmooth(ys, round);

  const pts: Pt[] = samples.map((s, i) => ({ t: s.t, x: clamp01(xs[i]), y: clamp01(ys[i]) }));
  const idx = simplify(pts, tol);
  const keys: CameraKey[] = idx.map((i) => ({ ...pts[i], ease: 'linear' as EaseId }));

  // Easing: moves that start / end at rest ease, pans that continue through a key stay linear.
  const still = tol * 0.5;
  const moving = (k: number): boolean => k >= 0 && k < keys.length - 1 && Math.hypot(keys[k + 1].x - keys[k].x, keys[k + 1].y - keys[k].y) > still;
  for (let k = 0; k < keys.length - 1; k++) {
    if (!moving(k)) {
      keys[k].ease = 'linear';
      continue;
    }
    const prev = moving(k - 1);
    const next = moving(k + 1);
    keys[k].ease = !prev && !next ? 'easeInOut' : !prev ? 'easeIn' : !next ? 'easeOut' : 'linear';
  }
  return keys;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Evaluate a camera path at time `t` (holds before the first / after the last key). */
export function evalCamera(keys: CameraKey[], t: number): { x: number; y: number } {
  if (keys.length === 0) return { x: 0.5, y: 0.5 };
  if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = applyEase(a.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
