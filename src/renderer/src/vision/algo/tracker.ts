/**
 * Region tracker for motion tracking.
 *
 * Normalised cross-correlation template matching on grayscale frames:
 *   - coarse-to-fine: a half-resolution search over a window sized from the predicted motion,
 *     then a ±2 px refinement at working resolution with sub-pixel peak interpolation;
 *   - scale-robust: the template is resampled at 3 scales around the current one each frame;
 *   - adaptive appearance: confident matches blend into a second template while the original
 *     one is kept to prevent drift (the better of the two wins);
 *   - confidence + re-acquisition: when the peak correlation drops the tracker coasts on its
 *     damped velocity with a growing search window and snaps back once the object reappears.
 *
 * Pure (no DOM) so it runs in the vision worker and in unit tests.
 */

export interface GrayFrame {
  data: Uint8Array;
  w: number;
  h: number;
}

export interface TrackBox {
  /** Centre and size, in frame pixels. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface TrackResult extends TrackBox {
  /** Peak correlation 0..1 (≥ 0.6 is a solid lock). */
  conf: number;
  lost: boolean;
}

export interface TrackerOptions {
  /** Relative scale step tried each frame (default 0.04 → 0.96 / 1 / 1.04). */
  scaleStep?: number;
  /** Below this correlation the object counts as lost (default 0.45). */
  lostBelow?: number;
  /** Correlation needed to re-acquire a lost object (default 0.55). */
  reacquireAbove?: number;
  /** Largest template side (px) before frames are processed at a coarser level (default 40). */
  maxTemplate?: number;
}

/** Half-resolution copy (2×2 box filter). */
export function downsample(f: GrayFrame): GrayFrame {
  const w = Math.max(1, f.w >> 1);
  const h = Math.max(1, f.h >> 1);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = Math.min(f.h - 1, y * 2) * f.w;
    const r1 = Math.min(f.h - 1, y * 2 + 1) * f.w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(f.w - 1, x * 2);
      const x1 = Math.min(f.w - 1, x * 2 + 1);
      out[y * w + x] = (f.data[r0 + x0] + f.data[r0 + x1] + f.data[r1 + x0] + f.data[r1 + x1] + 2) >> 2;
    }
  }
  return { data: out, w, h };
}

interface Plane {
  data: ArrayLike<number>;
  w: number;
  h: number;
}

/** Bilinear resample of the region centred at (cx, cy), sw×sh source px, into tw×th. */
function resample(f: Plane, cx: number, cy: number, sw: number, sh: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  const x0 = cx - sw / 2;
  const y0 = cy - sh / 2;
  const kx = sw / tw;
  const ky = sh / th;
  const maxX = f.w - 1;
  const maxY = f.h - 1;
  for (let j = 0; j < th; j++) {
    const sy = Math.min(maxY, Math.max(0, y0 + (j + 0.5) * ky - 0.5));
    const iy = Math.min(maxY - 1, Math.floor(sy));
    const fy = maxY > 0 ? sy - iy : 0;
    const iy1 = Math.min(maxY, iy + 1);
    for (let i = 0; i < tw; i++) {
      const sx = Math.min(maxX, Math.max(0, x0 + (i + 0.5) * kx - 0.5));
      const ix = Math.min(Math.max(0, maxX - 1), Math.floor(sx));
      const fx = maxX > 0 ? sx - ix : 0;
      const ix1 = Math.min(maxX, ix + 1);
      const a = f.data[iy * f.w + ix] + (f.data[iy * f.w + ix1] - f.data[iy * f.w + ix]) * fx;
      const b = f.data[iy1 * f.w + ix] + (f.data[iy1 * f.w + ix1] - f.data[iy1 * f.w + ix]) * fx;
      out[j * tw + i] = a + (b - a) * fy;
    }
  }
  return out;
}

interface Tmpl {
  data: Float32Array;
  w: number;
  h: number;
  /** Zero-mean values and their L2 norm. */
  zm: Float32Array;
  norm: number;
}

function makeTemplate(data: Float32Array, w: number, h: number): Tmpl {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= Math.max(1, data.length);
  const zm = new Float32Array(data.length);
  let norm = 0;
  for (let i = 0; i < data.length; i++) {
    zm[i] = data[i] - mean;
    norm += zm[i] * zm[i];
  }
  return { data, w, h, zm, norm: Math.sqrt(norm) };
}

const resizeTemplate = (t: Tmpl, w: number, h: number): Tmpl => (w === t.w && h === t.h ? t : makeTemplate(resample(t, t.w / 2, t.h / 2, t.w, t.h, w, h), w, h));

/** NCC of template `t` with its top-left at integer (x, y). -1 when off-frame or flat. */
function nccAt(f: GrayFrame, t: Tmpl, x: number, y: number): number {
  if (x < 0 || y < 0 || x + t.w > f.w || y + t.h > f.h || t.norm < 1e-6) return -1;
  let s = 0;
  let si = 0;
  let si2 = 0;
  const n = t.w * t.h;
  const d = f.data;
  const zm = t.zm;
  for (let j = 0; j < t.h; j++) {
    let row = (y + j) * f.w + x;
    let trow = j * t.w;
    for (let i = 0; i < t.w; i++, row++, trow++) {
      const v = d[row];
      s += v * zm[trow];
      si += v;
      si2 += v * v;
    }
  }
  const varI = si2 - (si * si) / n;
  if (varI < 1e-3) return -1;
  return s / (t.norm * Math.sqrt(varI));
}

interface Peak {
  /** Centre of the best placement (sub-pixel). */
  x: number;
  y: number;
  score: number;
}

/** Best placement of `t` centred within `radius` of (cx, cy), with sub-pixel refinement. */
function search(f: GrayFrame, t: Tmpl, cx: number, cy: number, radius: number, step = 1): Peak {
  const bx = Math.round(cx - t.w / 2);
  const by = Math.round(cy - t.h / 2);
  let best = { x: bx, y: by, score: -2 };
  const r = Math.max(1, Math.round(radius));
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const s = nccAt(f, t, bx + dx, by + dy);
      if (s > best.score) best = { x: bx + dx, y: by + dy, score: s };
    }
  }
  if (best.score <= -1) return { x: cx, y: cy, score: -1 };
  if (step > 1) {
    // Polish a strided search on the full grid around the winner.
    for (let dy = -step + 1; dy < step; dy++) {
      for (let dx = -step + 1; dx < step; dx++) {
        const s = nccAt(f, t, best.x + dx, best.y + dy);
        if (s > best.score) best = { x: best.x + dx, y: best.y + dy, score: s };
      }
    }
  }
  const sub = (a: number, b: number, c: number): number => {
    const den = a - 2 * b + c;
    return Math.abs(den) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  };
  const l = nccAt(f, t, best.x - 1, best.y);
  const rr = nccAt(f, t, best.x + 1, best.y);
  const u = nccAt(f, t, best.x, best.y - 1);
  const dd = nccAt(f, t, best.x, best.y + 1);
  const ox = l > -1 && rr > -1 ? sub(l, best.score, rr) : 0;
  const oy = u > -1 && dd > -1 ? sub(u, best.score, dd) : 0;
  return { x: best.x + ox + t.w / 2, y: best.y + oy + t.h / 2, score: best.score };
}

export class TemplateTracker {
  /** Working pyramid level: frames are downscaled 2^level times so templates stay small. */
  readonly level: number;
  private box: TrackBox;
  private vx = 0;
  private vy = 0;
  private scale = 1;
  private lostFrames = 0;
  private readonly base: Tmpl;
  private adaptive: Tmpl;
  private readonly baseW: number;
  private readonly baseH: number;
  private readonly opts: Required<TrackerOptions>;

  constructor(first: GrayFrame, box: TrackBox, opts: TrackerOptions = {}) {
    this.opts = { scaleStep: 0.04, lostBelow: 0.45, reacquireAbove: 0.55, maxTemplate: 40, ...opts };
    let level = 0;
    while (Math.max(box.w, box.h) / 2 ** level > this.opts.maxTemplate && level < 4) level++;
    this.level = level;
    this.box = { ...box };
    const f = this.pyramid(first);
    const k = 2 ** level;
    this.baseW = Math.max(6, Math.round(box.w / k));
    this.baseH = Math.max(6, Math.round(box.h / k));
    this.base = makeTemplate(resample(f, box.cx / k, box.cy / k, box.w / k, box.h / k, this.baseW, this.baseH), this.baseW, this.baseH);
    this.adaptive = this.base;
  }

  private pyramid(f: GrayFrame): GrayFrame {
    let out = f;
    for (let i = 0; i < this.level; i++) out = downsample(out);
    return out;
  }

  get current(): TrackBox {
    return { ...this.box };
  }

  /** Track into the next frame. */
  update(frame: GrayFrame): TrackResult {
    const k = 2 ** this.level;
    const f = this.pyramid(frame);
    const coarse = downsample(f);
    const lost = this.lostFrames > 0;
    const px = (this.box.cx + this.vx) / k;
    const py = (this.box.cy + this.vy) / k;
    const speed = Math.hypot(this.vx, this.vy) / k;
    const tw = Math.round(this.baseW * this.scale);
    const th = Math.round(this.baseH * this.scale);
    const baseRadius = 3 + speed * 1.5 + Math.max(tw, th) * 0.3;
    const radius = lost ? Math.min(Math.max(f.w, f.h), baseRadius * (1 + Math.min(this.lostFrames, 30) * 0.5)) : baseRadius;

    let best: { peak: Peak; scale: number; rank: number } | null = null;
    const step = this.opts.scaleStep;
    const templates = this.adaptive === this.base ? [this.base] : [this.adaptive, this.base];
    for (const s of [1, 1 - step, 1 + step]) {
      const sc = Math.min(6, Math.max(0.2, this.scale * s));
      const w = Math.max(6, Math.round(this.baseW * sc));
      const h = Math.max(6, Math.round(this.baseH * sc));
      for (const tmpl of templates) {
        const tc = resizeTemplate(tmpl, Math.max(4, Math.round(w / 2)), Math.max(4, Math.round(h / 2)));
        const cp = search(coarse, tc, px / 2, py / 2, radius / 2, radius > 30 ? 2 : 1);
        const t = resizeTemplate(tmpl, w, h);
        const fp = search(f, t, cp.score > -1 ? cp.x * 2 : px, cp.score > -1 ? cp.y * 2 : py, 2);
        // A slight preference for the current scale keeps the size from wandering on noise.
        const rank = fp.score - (s === 1 ? 0 : 0.001);
        if (!best || rank > best.rank) best = { peak: fp, scale: sc, rank };
      }
    }
    const conf = Math.max(0, Math.min(1, best?.peak.score ?? 0));
    const threshold = lost ? this.opts.reacquireAbove : this.opts.lostBelow;

    if (best && conf >= threshold) {
      const nx = best.peak.x * k;
      const ny = best.peak.y * k;
      const dx = nx - this.box.cx;
      const dy = ny - this.box.cy;
      if (lost) {
        this.vx = 0;
        this.vy = 0;
      } else {
        this.vx = this.vx * 0.4 + dx * 0.6;
        this.vy = this.vy * 0.4 + dy * 0.6;
      }
      this.scale = this.scale * 0.25 + best.scale * 0.75;
      this.box = { cx: nx, cy: ny, w: this.baseW * this.scale * k, h: this.baseH * this.scale * k };
      this.lostFrames = 0;
      if (conf > 0.8) {
        const patch = resample(f, nx / k, ny / k, this.baseW * this.scale, this.baseH * this.scale, this.baseW, this.baseH);
        const blended = new Float32Array(patch.length);
        for (let i = 0; i < patch.length; i++) blended[i] = this.adaptive.data[i] * 0.85 + patch[i] * 0.15;
        this.adaptive = makeTemplate(blended, this.baseW, this.baseH);
      }
      return { ...this.box, conf, lost: false };
    }

    // Lost: coast on the damped velocity and widen the search window next frame.
    this.lostFrames++;
    this.vx *= 0.8;
    this.vy *= 0.8;
    this.box = { ...this.box, cx: Math.min(frame.w, Math.max(0, this.box.cx + this.vx)), cy: Math.min(frame.h, Math.max(0, this.box.cy + this.vy)) };
    if (this.lostFrames > 2) this.adaptive = this.base;
    return { ...this.box, conf, lost: true };
  }
}

// ---------------------------------------------------------------------------------------------
// Path post-processing
// ---------------------------------------------------------------------------------------------

export interface PathSample {
  t: number;
  x: number;
  y: number;
  conf: number;
}

/**
 * Clean a raw track: drop low-confidence samples (gaps are interpolated), then remove sub-pixel
 * jitter with a small zero-phase Gaussian. Returns one sample per input time.
 */
export function cleanTrack(samples: PathSample[], minConf = 0.5, sigma = 1.2): PathSample[] {
  const n = samples.length;
  if (n === 0) return [];
  const good = samples.map((s) => s.conf >= minConf);
  if (!good.some(Boolean)) return samples.map((s) => ({ ...s }));
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  // Interpolate gaps.
  let prev = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && !good[i]) continue;
    if (i - prev > 1) {
      for (let j = prev + 1; j < i; j++) {
        if (prev < 0) {
          xs[j] = xs[i];
          ys[j] = ys[i];
        } else if (i >= n) {
          xs[j] = xs[prev];
          ys[j] = ys[prev];
        } else {
          const u = (samples[j].t - samples[prev].t) / Math.max(1e-9, samples[i].t - samples[prev].t);
          xs[j] = xs[prev] + (xs[i] - xs[prev]) * u;
          ys[j] = ys[prev] + (ys[i] - ys[prev]) * u;
        }
      }
    }
    prev = i;
  }
  const r = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let k = -r; k <= r; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const smooth = (v: number[]): number[] =>
    v.map((_, i) => {
      let s = 0;
      let w = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        s += v[j] * kernel[k + r];
        w += kernel[k + r];
      }
      return s / w;
    });
  const sx = sigma > 0.3 ? smooth(xs) : xs;
  const sy = sigma > 0.3 ? smooth(ys) : ys;
  return samples.map((s, i) => ({ t: s.t, x: sx[i], y: sy[i], conf: s.conf }));
}

/** Keep the samples needed to stay within `tolerance` of the path (RDP on x / y over time). */
export function reduceKeyframes(path: PathSample[], tolerance: number): PathSample[] {
  if (path.length <= 2) return path.slice();
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstErr = tolerance;
    for (let i = a + 1; i < b; i++) {
      const u = (path[i].t - path[a].t) / Math.max(1e-9, path[b].t - path[a].t);
      const ex = path[i].x - (path[a].x + (path[b].x - path[a].x) * u);
      const ey = path[i].y - (path[a].y + (path[b].y - path[a].y) * u);
      const e = Math.hypot(ex, ey);
      if (e > worstErr) {
        worstErr = e;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return path.filter((_, i) => keep[i]);
}
