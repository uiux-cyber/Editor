/**
 * Audio time mapping DSP, shared by the export mix and the preview of reversed clips.
 *
 * Two ways to play a source through a time map `pos(n)` (input sample position for output
 * sample n):
 *
 *  - `resample`: reads the input at pos(n) (cubic interpolation, with a box pre-filter when
 *    reading faster than real time). Like tape: the pitch follows the speed. Exact for any map,
 *    including speed ramps and reverse.
 *  - `Wsola`: waveform-similarity overlap-add. Output grains of ~43 ms are cut from the input
 *    around pos(n) and overlap-added where they line up best with the previous grain, so the
 *    duration follows the map while the pitch stays the same. The map may vary over time (speed
 *    ramps keep their pitch too); grains are always read forwards, so reversed clips are
 *    stretched from a reversed input. Streaming: consecutive `render` calls continue seamlessly.
 *
 * Pure (no DOM) so it can be unit-tested.
 */

/** Planar input samples covering absolute input indices [start, start + length). */
export interface InputBlock {
  start: number;
  channels: Float32Array[];
}

const sampleAt = (data: Float32Array, i: number): number => (i >= 0 && i < data.length ? data[i] : 0);

/** Catmull-Rom interpolation of `data` at fractional index x (zero outside). */
export function cubicAt(data: Float32Array, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const y0 = sampleAt(data, i - 1);
  const y1 = sampleAt(data, i);
  const y2 = sampleAt(data, i + 1);
  const y3 = sampleAt(data, i + 2);
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

/**
 * Read `out.length` samples from `input` at positions pos[n] (absolute input indices). `rate[n]`
 * (optional) is the local read speed; above 1.25 a box pre-filter of that width limits aliasing.
 */
export function resample(input: InputBlock, pos: Float64Array, out: Float32Array[], rate?: Float64Array): void {
  const n = pos.length;
  for (let ch = 0; ch < out.length; ch++) {
    const src = input.channels[Math.min(ch, input.channels.length - 1)];
    const dst = out[ch];
    for (let i = 0; i < n; i++) {
      const x = pos[i] - input.start;
      const r = rate ? Math.abs(rate[i]) : 1;
      if (r > 1.25) {
        const taps = Math.min(8, Math.ceil(r));
        const step = r / taps;
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += cubicAt(src, x + (k - (taps - 1) / 2) * step);
        dst[i] = acc / taps;
      } else {
        dst[i] = cubicAt(src, x);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// WSOLA
// ---------------------------------------------------------------------------------------------

export interface WsolaOptions {
  /** Grain length in samples (default ≈ 43 ms at 48 kHz). Even. */
  frame?: number;
  /** Search radius in samples (default ≈ 10.7 ms at 48 kHz). */
  search?: number;
}

const DECIM = 4;

export class Wsola {
  readonly frame: number;
  readonly hop: number;
  readonly search: number;
  private window: Float32Array;
  /** Next grain to add: grain g starts at output sample g · hop and completes region g. */
  private g = 0;
  /** Input index where the previous grain started (null right after a reset). */
  private prevStart: number | null = null;
  /** Windowed second half of the previous grain, per channel. */
  private tail: Float32Array[];
  /** Output sample the next contiguous `render` call starts at. */
  private cursor = Number.NaN;
  /** A completed region that extends past the end of the last request. */
  private pending: Float32Array[];
  private pendingStart = 0;
  private hasPending = false;

  constructor(
    readonly channels: number,
    opts: WsolaOptions = {},
  ) {
    this.frame = Math.max(64, (opts.frame ?? 2048) & ~1);
    this.hop = this.frame / 2;
    this.search = Math.max(DECIM, opts.search ?? 512);
    // Periodic Hann: two windows at 50% overlap sum to exactly 1.
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
    this.tail = Array.from({ length: channels }, () => new Float32Array(this.hop));
    this.pending = Array.from({ length: channels }, () => new Float32Array(this.hop));
  }

  /** First grain to add when (re)starting at output sample `from`. */
  private firstGrain(from: number): number {
    // One grain early: its region ends at or before `from`, so the first region we hand out
    // already has both overlapping halves (no fade-in).
    return Math.floor(from / this.hop) - 1;
  }

  private reset(from: number): void {
    this.g = this.firstGrain(from);
    this.prevStart = null;
    for (const t of this.tail) t.fill(0);
    this.hasPending = false;
    this.cursor = from;
  }

  /**
   * Input index range needed to render output samples [from, from + count) for a
   * non-decreasing map `pos`.
   */
  inputRange(from: number, count: number, pos: (outIndex: number) => number): { lo: number; hi: number } {
    const contiguous = from === this.cursor;
    const g0 = contiguous ? this.g : this.firstGrain(from);
    const g1 = Math.ceil((from + count) / this.hop) + 1;
    let lo = pos(g0 * this.hop) - this.search;
    if (contiguous && this.prevStart !== null) lo = Math.min(lo, this.prevStart);
    const hi = pos(g1 * this.hop) + this.search + this.frame;
    return { lo: Math.floor(lo) - 8, hi: Math.ceil(hi) + 8 };
  }

  /**
   * Render output samples [from, from + count) into `out` (planar, at least `count` long).
   * `pos(n)` maps an output sample index to an input index and must be non-decreasing.
   * Consecutive calls continue seamlessly; a non-contiguous call restarts the grain sequence.
   */
  render(from: number, count: number, input: InputBlock, pos: (outIndex: number) => number, out: Float32Array[]): void {
    if (from !== this.cursor) this.reset(from);
    const H = this.hop;
    const end = from + count;
    let written = from;
    const copy = (src: Float32Array[], regionStart: number): void => {
      const a = Math.max(regionStart, written);
      const b = Math.min(regionStart + H, end);
      if (b <= a) return;
      for (let ch = 0; ch < this.channels; ch++) out[ch].set(src[ch].subarray(a - regionStart, b - regionStart), a - from);
      written = b;
    };
    if (this.hasPending) {
      copy(this.pending, this.pendingStart);
      if (this.pendingStart + H <= end) this.hasPending = false;
    }
    const region = Array.from({ length: this.channels }, () => new Float32Array(H));
    while (written < end) {
      const regionStart = this.g * H;
      this.addGrain(input, pos, region);
      copy(region, regionStart);
      if (regionStart + H > end) {
        for (let ch = 0; ch < this.channels; ch++) this.pending[ch].set(region[ch]);
        this.pendingStart = regionStart;
        this.hasPending = true;
      }
    }
    this.cursor = end;
  }

  /** Overlap-adds grain g, writing the completed region [g·hop, (g+1)·hop) into `region`. */
  private addGrain(input: InputBlock, pos: (outIndex: number) => number, region: Float32Array[]): void {
    const H = this.hop;
    const nominal = Math.round(pos(this.g * H));
    const start = this.prevStart === null ? nominal : this.bestMatch(input, nominal, this.prevStart + H);
    this.prevStart = start;
    this.g++;
    const w = this.window;
    for (let ch = 0; ch < this.channels; ch++) {
      const src = input.channels[Math.min(ch, input.channels.length - 1)];
      const base = start - input.start;
      const tail = this.tail[ch];
      const r = region[ch];
      for (let j = 0; j < H; j++) r[j] = tail[j] + w[j] * sampleAt(src, base + j);
      for (let j = 0; j < H; j++) tail[j] = w[H + j] * sampleAt(src, base + H + j);
    }
  }

  /** Input start near `nominal` whose first half best continues the signal at `natural`. */
  private bestMatch(input: InputBlock, nominal: number, natural: number): number {
    const L = this.hop;
    const S = this.search;
    const chans = input.channels;
    const nc = chans.length;
    const mono = (i: number): number => {
      const k = i - input.start;
      let v = 0;
      for (let c = 0; c < nc; c++) v += sampleAt(chans[c], k);
      return v;
    };
    // Coarse search on a decimated signal, then refine around the best lag at full rate.
    const n = Math.ceil(L / DECIM);
    const ref = new Float32Array(n);
    for (let k = 0; k < n; k++) ref[k] = mono(natural + k * DECIM);
    const cand = new Float32Array(n + Math.ceil((2 * S) / DECIM) + 2);
    const c0 = nominal - S;
    for (let k = 0; k < cand.length; k++) cand[k] = mono(c0 + k * DECIM);
    let best = 0;
    let bestScore = -Infinity;
    const lags = Math.floor((2 * S) / DECIM);
    for (let li = 0; li <= lags; li++) {
      let acc = 0;
      let energy = 1e-9;
      for (let k = 0; k < n; k++) {
        const v = cand[li + k];
        acc += v * ref[k];
        energy += v * v;
      }
      const score = acc / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = -S + li * DECIM;
      }
    }
    const coarse = best;
    bestScore = -Infinity;
    for (let d = coarse - DECIM + 1; d <= coarse + DECIM - 1; d++) {
      let acc = 0;
      let energy = 1e-9;
      for (let k = 0; k < L; k += 2) {
        const v = mono(nominal + d + k);
        acc += v * mono(natural + k);
        energy += v * v;
      }
      const score = acc / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return nominal + best;
  }
}

/** One-shot WSOLA over a whole buffer with a constant speed (output length = input / speed). */
export function stretchConstant(input: Float32Array[], speed: number, opts: WsolaOptions = {}): Float32Array[] {
  const outLen = Math.max(1, Math.round(input[0].length / speed));
  const w = new Wsola(input.length, opts);
  const out = input.map(() => new Float32Array(outLen));
  w.render(0, outLen, { start: 0, channels: input }, (n) => n * speed, out);
  return out;
}

/** Reverse planar channels in place. */
export function reverseChannels(channels: Float32Array[]): void {
  for (const c of channels) c.reverse();
}
