/**
 * Tiny wavetable synthesiser in plain JS. It bakes single notes and chord stabs into buffers that
 * the loop engine then triggers like samples (`Loop.hit`).
 *
 * Why bake instead of building an oscillator graph per note: a music bed has several hundred
 * notes, and every node that exists in an offline graph costs time in every render quantum whether
 * it is sounding or not. One buffer source per note keeps a 16-second bed rendering in a fraction
 * of a second, repeated notes share one buffer, and a baked note wraps around the loop point
 * exactly (see `Loop.hit`).
 *
 * A voice is a stack of layers; each layer is a band-limited single-cycle waveform with its own
 * gain envelope. Fading a bright layer out faster than a dull one gives the "closing filter" of a
 * pluck without any filter state.
 */

import { FLOOR, type Ctx, type Pt } from './synth';
import type { F32 } from './dsp';

const SIZE = 2048;
const tables = new Map<string, F32>();

/**
 * One cycle (plus a guard sample) of the waveform with the given harmonic amplitudes, all in sine
 * phase, normalised to a peak of 1.
 */
export function table(harmonics: readonly number[]): F32 {
  const key = harmonics.join(',');
  let t = tables.get(key);
  if (t) return t;
  t = new Float32Array(SIZE + 1);
  for (let k = 1; k <= harmonics.length; k++) {
    const amp = harmonics[k - 1];
    if (!amp) continue;
    // sin(k·θ·i) by recurrence — no trig call per sample.
    const w = (2 * Math.PI * k) / SIZE;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = -Math.sin(w);
    for (let i = 0; i < SIZE; i++) {
      const s = c * s1 - s2;
      t[i] += amp * s1;
      s2 = s1;
      s1 = s;
    }
  }
  let peak = 0;
  for (let i = 0; i < SIZE; i++) peak = Math.max(peak, Math.abs(t[i]));
  if (peak > 0) for (let i = 0; i < SIZE; i++) t[i] /= peak;
  t[SIZE] = t[0];
  tables.set(key, t);
  return t;
}

export type Shape = 'saw' | 'square' | 'pulse' | 'string' | 'reed' | 'sine';

const STEPS = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64, 90, 128];

const nearest = (x: number): number => {
  let best = STEPS[0];
  for (const s of STEPS) if (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x))) best = s;
  return best;
};

/**
 * Harmonic amplitudes of `shape` as if heard through a low-pass at harmonic number `cut`
 * (`slope` 2 ≈ 12 dB/octave). `limit` caps the number of harmonics (to stay below Nyquist).
 */
export function harmonicsOf(shape: Shape, cut: number, slope = 2, limit = 128): number[] {
  if (shape === 'sine') return [1];
  const c = nearest(cut);
  let cap = STEPS[0];
  for (const s of STEPS) if (s <= Math.max(1, limit)) cap = s;
  const count = Math.max(1, Math.min(Math.ceil(c * 4), Math.floor(cap)));
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    let a: number;
    // Alternating signs put the zero crossing of the saw at phase 0.
    if (shape === 'saw') a = (k % 2 ? 1 : -1) / k;
    else if (shape === 'square') a = k % 2 ? 1 / k : 0;
    else if (shape === 'pulse') a = Math.sin(k * Math.PI * 0.22) / k;
    else if (shape === 'reed') a = (k % 2 ? 1 : 0.35) / Math.pow(k, 1.15);
    else a = (Math.abs(Math.sin(k * Math.PI * 0.21)) + 0.05) / Math.pow(k, 1.1);
    out.push(Math.round((a / Math.sqrt(1 + Math.pow(k / c, 2 * slope))) * 1e5) / 1e5);
  }
  return out;
}

/** Sample an envelope (times in seconds from the start of the note) into `n` gain values. */
export function renderEnv(pts: readonly Pt[], n: number, sr: number): F32 {
  const out = new Float32Array(n);
  let from = Math.min(n, Math.max(0, Math.round(pts[0][0] * sr)));
  for (let s = 1; s < pts.length; s++) {
    const t0 = pts[s - 1][0];
    const v0 = pts[s - 1][1];
    const t1 = pts[s][0];
    const v1 = pts[s][1];
    const curve = pts[s][2];
    const to = Math.min(n, Math.max(from, Math.round(t1 * sr)));
    const span = Math.max(1e-9, t1 - t0);
    if (curve === 'exp') {
      const a = Math.max(FLOOR, v0);
      const ratio = Math.max(FLOOR, v1) / a;
      for (let i = from; i < to; i++) out[i] = a * Math.pow(ratio, (i / sr - t0) / span);
    } else if (curve === 'set') {
      for (let i = from; i < to; i++) out[i] = v0;
    } else {
      for (let i = from; i < to; i++) out[i] = v0 + ((v1 - v0) * (i / sr - t0)) / span;
    }
    from = to;
  }
  const last = pts[pts.length - 1][1];
  for (let i = from; i < n; i++) out[i] = last;
  return out;
}

export interface BakeLayer {
  /** Harmonic amplitudes (see `harmonicsOf`). */
  harmonics: readonly number[];
  /** Gain envelope, times relative to the start of the note. */
  pts: readonly Pt[];
  /** Frequency in Hz. */
  f: number;
  /** Never detuned or spread (sub layers). */
  centre?: boolean;
}

export interface BakeOpts {
  /** Detune of a left / right pair in cents (0 = one centred, mono voice). */
  detune?: number;
  /** Stereo position of the detuned pair (0..1). */
  spread?: number;
}

/**
 * Render a stack of layers into a buffer: mono without `detune`, otherwise stereo with one copy
 * of every layer tuned down on the left and one tuned up on the right.
 */
export function bakeLayers(ctx: Ctx, layers: readonly BakeLayer[], o: BakeOpts = {}): AudioBuffer {
  const sr = ctx.sampleRate;
  const detune = o.detune ?? 0;
  const end = Math.max(...layers.map((l) => l.pts[l.pts.length - 1][0]));
  const n = Math.max(8, Math.ceil(end * sr) + 2);
  const stereo = detune !== 0;
  const left = new Float32Array(n);
  const right = stereo ? new Float32Array(n) : left;
  // Equal-power pan gains of the detuned pair.
  const x = (1 - Math.min(1, Math.max(0, o.spread ?? 0.5))) / 2;
  const near = Math.cos((x * Math.PI) / 2);
  const far = Math.sin((x * Math.PI) / 2);
  for (const layer of layers) {
    const tab = table(layer.harmonics);
    const len = Math.min(n, Math.ceil(layer.pts[layer.pts.length - 1][0] * sr) + 1);
    const gain = renderEnv(layer.pts, len, sr);
    const voices: [cents: number, gl: number, gr: number][] =
      !stereo ? [[0, 1, 0]] : layer.centre ? [[0, Math.SQRT1_2, Math.SQRT1_2]] : [[-detune, near * 0.62, far * 0.62], [detune, far * 0.62, near * 0.62]];
    for (const [cents, gl, gr] of voices) {
      const inc = (layer.f * Math.pow(2, cents / 1200) * SIZE) / sr;
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const idx = phase | 0;
        const v = (tab[idx] + (tab[idx + 1] - tab[idx]) * (phase - idx)) * gain[i];
        left[i] += v * gl;
        if (stereo) right[i] += v * gr;
        phase += inc;
        if (phase >= SIZE) phase -= SIZE;
      }
    }
  }
  const buffer = ctx.createBuffer(stereo ? 2 : 1, n, sr);
  buffer.copyToChannel(left, 0);
  if (stereo) buffer.copyToChannel(right, 1);
  return buffer;
}
