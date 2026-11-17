/**
 * Shot-boundary (hard cut) detection.
 *
 * Every decoded frame (downscaled to ~96 px) is reduced to a colour histogram and a binary edge
 * map. Consecutive frames are compared with
 *   - the histogram distance (half the L1 distance, 0..1) — robust to motion, sensitive to cuts;
 *   - the edge change ratio (fraction of edge pixels that appear / disappear, 0..1) — catches
 *     cuts between shots with similar colours.
 * The combined score is thresholded adaptively against its local median + k·MAD so busy footage
 * (camera shake, fast motion) needs a stronger jump than a calm interview, and a minimum shot
 * length keeps flashes and double detections from splitting a clip into slivers.
 */

export interface FrameFeatures {
  /** Normalised colour histogram (sums to 1). */
  hist: Float32Array;
  /** Binary edge map, 1 byte per pixel. */
  edges: Uint8Array;
  /** Dilated edge map (3×3) used for tolerant edge matching. */
  dilated: Uint8Array;
  edgeCount: number;
  w: number;
  h: number;
  /** Mean luma 0..1. */
  luma: number;
}

export interface FrameStat {
  /** Source time of the frame, seconds. */
  t: number;
  /** Histogram distance to the previous frame, 0..1 (0 for the first frame). */
  hist: number;
  /** Edge change ratio to the previous frame, 0..1. */
  edge: number;
  /** Mean luma of the frame, 0..1. */
  luma: number;
}

export interface SceneCut {
  /** Source time of the first frame of the new shot. */
  t: number;
  score: number;
  /** Index into the stats array. */
  index: number;
}

export interface CutOptions {
  /** 0 (only obvious cuts) .. 1 (every plausible cut). Default 0.5. */
  sensitivity?: number;
  /** Minimum shot length, seconds. Default 0.6. */
  minShot?: number;
  /** Half-width of the adaptive window, frames. Default 20. */
  window?: number;
}

const BINS = 4; // per channel → 64 colour bins

/** Histogram + edges of an RGBA image. */
export function frameFeatures(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): FrameFeatures {
  const n = w * h;
  const hist = new Float32Array(BINS * BINS * BINS);
  const luma = new Float32Array(n);
  let lumaSum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    hist[((r * BINS) >> 8) * BINS * BINS + ((g * BINS) >> 8) * BINS + ((b * BINS) >> 8)] += 1;
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luma[i] = y;
    lumaSum += y;
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= n;

  // Sobel magnitude, thresholded adaptively (mean + 0.5·std, with an absolute floor).
  const mag = new Float32Array(n);
  let ms = 0;
  let ms2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1];
      const gy = luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      ms += m;
      ms2 += m * m;
    }
  }
  const inner = Math.max(1, (w - 2) * (h - 2));
  const mean = ms / inner;
  const std = Math.sqrt(Math.max(0, ms2 / inner - mean * mean));
  const thr = Math.max(0.12, mean + 0.5 * std);
  const edges = new Uint8Array(n);
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    if (mag[i] > thr) {
      edges[i] = 1;
      edgeCount++;
    }
  }
  const dilated = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) dilated[yy * w + xx] = 1;
        }
      }
    }
  }
  return { hist, edges, dilated, edgeCount, w, h, luma: lumaSum / Math.max(1, n) };
}

/** Distances between two consecutive frames. */
export function frameDifference(a: FrameFeatures, b: FrameFeatures): { hist: number; edge: number } {
  let l1 = 0;
  for (let i = 0; i < a.hist.length; i++) l1 += Math.abs(a.hist[i] - b.hist[i]);
  let edge = 0;
  if (a.w === b.w && a.h === b.h && (a.edgeCount > 0 || b.edgeCount > 0)) {
    let entering = 0; // edges in b far from any edge in a
    let exiting = 0; // edges in a far from any edge in b
    for (let i = 0; i < b.edges.length; i++) {
      if (b.edges[i] && !a.dilated[i]) entering++;
      if (a.edges[i] && !b.dilated[i]) exiting++;
    }
    edge = Math.max(b.edgeCount ? entering / b.edgeCount : 0, a.edgeCount ? exiting / a.edgeCount : 0);
    // Very few edges (flat frames) make the ratio unreliable; weight it down.
    const support = Math.min(1, (a.edgeCount + b.edgeCount) / (0.02 * a.edges.length));
    edge *= support;
  }
  return { hist: Math.min(1, l1 / 2), edge: Math.min(1, edge) };
}

/** Combined per-frame cut score, 0..1. */
export function cutScore(s: Pick<FrameStat, 'hist' | 'edge'>): number {
  return Math.min(1, 0.62 * s.hist + 0.38 * s.edge + 0.25 * Math.min(s.hist, s.edge));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Find hard cuts in a sequence of frame statistics. */
export function detectCuts(stats: FrameStat[], opts: CutOptions = {}): SceneCut[] {
  const n = stats.length;
  if (n < 3) return [];
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const minShot = Math.max(0, opts.minShot ?? 0.6);
  const W = Math.max(4, opts.window ?? 20);
  const scores = stats.map((s, i) => (i === 0 ? 0 : cutScore(s)));
  const k = 9 - 6 * sens; // MADs above the local median
  const floor = 0.32 - 0.2 * sens; // absolute minimum score

  const candidates: SceneCut[] = [];
  for (let i = 1; i < n; i++) {
    const s = scores[i];
    if (s < floor) continue;
    // Local maximum within ±2 frames.
    let isMax = true;
    for (let j = Math.max(1, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      if (j !== i && (scores[j] > s || (scores[j] === s && j < i))) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const win: number[] = [];
    for (let j = Math.max(1, i - W); j <= Math.min(n - 1, i + W); j++) if (Math.abs(j - i) > 1) win.push(scores[j]);
    const med = median(win);
    const mad = median(win.map((v) => Math.abs(v - med))) * 1.4826;
    const thr = Math.max(floor, med + k * Math.max(mad, 0.015));
    if (s > thr) candidates.push({ t: stats[i].t, score: s, index: i });
  }

  // Minimum shot length: keep the strongest of cuts that are too close together, and never cut
  // closer than `minShot` to the start / end of the analysed range.
  const t0 = stats[0].t;
  const t1 = stats[n - 1].t;
  const kept: SceneCut[] = [];
  for (const c of candidates.filter((c) => c.t - t0 >= minShot * 0.5 && t1 - c.t >= minShot * 0.5).sort((a, b) => b.score - a.score)) {
    if (kept.every((k2) => Math.abs(k2.t - c.t) >= minShot)) kept.push(c);
  }
  return kept.sort((a, b) => a.t - b.t);
}
