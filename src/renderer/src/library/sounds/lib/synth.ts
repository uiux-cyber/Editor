/**
 * Shared Web Audio building blocks for Kinora's synthesised sound library.
 *
 * This module lives in a sub-folder on purpose: the pack loader globs `sounds/*.ts` and expects a
 * default-exported array from every match, so helper modules must not sit next to the packs.
 *
 * Everything here is deterministic and only uses nodes that render in an OfflineAudioContext
 * (Oscillator, AudioBufferSource, Gain, BiquadFilter, Delay, WaveShaper, StereoPanner, Convolver).
 */

import { seededRandom } from '@/core/easing';
import { noiseBuffer } from '../core';
import type { SoundCategory, SoundDef } from '../../types';

export type Ctx = BaseAudioContext;
export type Curve = 'lin' | 'exp' | 'set';
/** Envelope breakpoint: [time, value, curve of the segment that ENDS at this point]. */
export type Pt = readonly [time: number, value: number, curve?: Curve];

/** Smallest value used as the target / origin of exponential ramps (-80 dB). */
export const FLOOR = 1e-4;

// ---------------------------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------------------------

const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Note name → MIDI number ("C4" = 60, "F#3", "Bb2"). */
export function midi(name: string): number {
  const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(name.trim());
  if (!m) throw new Error(`Invalid note name "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + NOTE_OFFSETS[m[1].toLowerCase()] + acc;
}

/** MIDI number → frequency in Hz (A4 = 440). */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Note name → frequency in Hz. */
export const hz = (name: string): number => mtof(midi(name));

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

/**
 * Schedule a breakpoint envelope. The first point is a plain `setValueAtTime`; every following
 * point ramps linearly unless its curve says otherwise. Exponential segments are clamped to
 * `FLOOR` so they are always valid.
 */
export function env(p: AudioParam, pts: readonly Pt[]): void {
  let prevT = 0;
  let prevV = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = Math.max(0, pts[i][0]);
    const v = pts[i][1];
    const c = pts[i][2];
    if (i === 0 || c === 'set') {
      p.setValueAtTime(v, t);
    } else if (c === 'exp') {
      if (prevV < FLOOR) p.setValueAtTime(FLOOR, prevT);
      p.exponentialRampToValueAtTime(Math.max(FLOOR, v), t);
    } else {
      p.linearRampToValueAtTime(v, t);
    }
    prevT = t;
    prevV = v;
  }
}

/** Shift an envelope given relative to a voice start to absolute time. */
export const shift = (pts: readonly Pt[], t: number): Pt[] => pts.map(([time, v, c]) => [time + t, v, c] as const);

/**
 * Percussive envelope: linear attack, exponential decay (`decay` = time to fall by 60 dB) and a
 * short linear tail to true zero. Returns the time at which the envelope is silent.
 */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number, hold = 0): number {
  const a = Math.max(0.0005, attack);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(Math.max(FLOOR * 0.1, peak * 0.001), t + a + hold + decay);
  p.linearRampToValueAtTime(0, t + a + hold + decay + 0.004);
  return t + a + hold + decay + 0.004;
}

export interface Adsr {
  peak: number;
  a: number;
  d: number;
  /** Sustain level as a fraction of the peak. */
  s: number;
  /** Time from the start of the note to its release. */
  dur: number;
  r: number;
}

/** Classic ADSR. Returns the time at which the envelope is silent. */
export function adsr(p: AudioParam, t: number, o: Adsr): number {
  const a = Math.max(0.0005, o.a);
  const sus = Math.max(FLOOR, o.peak * o.s);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(o.peak, t + a);
  let level = o.peak;
  if (o.dur > a + o.d) {
    p.exponentialRampToValueAtTime(sus, t + a + o.d);
    p.setValueAtTime(sus, t + o.dur);
    level = sus;
  } else if (o.dur > a) {
    level = o.peak * Math.pow(sus / o.peak, (o.dur - a) / o.d);
    p.exponentialRampToValueAtTime(level, t + o.dur);
  }
  const end = t + Math.max(o.dur, a) + o.r;
  p.exponentialRampToValueAtTime(Math.max(FLOOR * 0.1, level * 0.01), end - o.r * 0.25);
  p.linearRampToValueAtTime(0, end);
  return end;
}

/** Sample `fn(x)` for x in 0..1 into an automation curve (smooth swells, bell-shaped gains…). */
export function shape(p: AudioParam, t: number, dur: number, fn: (x: number) => number, scale = 1, points = 96): void {
  const values = new Float32Array(points);
  for (let i = 0; i < points; i++) values[i] = fn(i / (points - 1)) * scale;
  p.setValueCurveAtTime(values, Math.max(0, t), dur);
}

/** Smooth bump: 0 → 1 → 0, peaking at `peakAt` (0..1). `sharp` > 1 narrows it. */
export const bump =
  (peakAt = 0.5, sharp = 1) =>
  (x: number): number => {
    const u = x < peakAt ? x / peakAt : (1 - x) / (1 - peakAt);
    const s = Math.sin((Math.max(0, Math.min(1, u)) * Math.PI) / 2);
    return Math.pow(s * s, sharp);
  };

// ---------------------------------------------------------------------------------------------
// Small node helpers
// ---------------------------------------------------------------------------------------------

/** Gain node (defaults to silent so that envelopes can open it later). */
export function vca(ctx: Ctx, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filt(ctx: Ctx, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

export function panner(ctx: Ctx, pan = 0): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** Sums its (possibly stereo) input down to mono. */
export function mono(ctx: Ctx, value = 1): GainNode {
  const g = ctx.createGain();
  g.channelCount = 1;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  g.gain.value = value;
  return g;
}

/** Connect nodes in series and return the last one. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Route `node` to `out`, through a panner when `pan` is not centred. */
export function toOut(ctx: Ctx, node: AudioNode, out: AudioNode, pan = 0): void {
  if (pan) node.connect(panner(ctx, pan)).connect(out);
  else node.connect(out);
}

const buffers = new WeakMap<Ctx, Map<string, AudioBuffer>>();

/** Per-context cache for synthesised buffers (noise, impulse responses, baked drums…). */
export function cached(ctx: Ctx, key: string, make: () => AudioBuffer): AudioBuffer {
  let map = buffers.get(ctx);
  if (!map) {
    map = new Map();
    buffers.set(ctx, map);
  }
  let buf = map.get(key);
  if (!buf) {
    buf = make();
    map.set(key, buf);
  }
  return buf;
}

const waves = new WeakMap<Ctx, Map<string, PeriodicWave>>();

/**
 * Band-limited custom waveform from harmonic amplitudes (index 0 = fundamental). All harmonics are
 * in sine phase, so the wave starts at a zero crossing.
 */
export function wave(ctx: Ctx, harmonics: readonly number[]): PeriodicWave {
  const key = harmonics.join(',');
  let map = waves.get(ctx);
  if (!map) {
    map = new Map();
    waves.set(ctx, map);
  }
  let w = map.get(key);
  if (!w) {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    for (let i = 0; i < harmonics.length; i++) imag[i + 1] = harmonics[i];
    w = ctx.createPeriodicWave(real, imag);
    map.set(key, w);
  }
  return w;
}

export type WaveType = OscillatorType | PeriodicWave;

/** Give an oscillator either a built-in waveform or a custom periodic wave. */
export function setWave(o: OscillatorNode, type: WaveType): void {
  if (typeof type === 'string') o.type = type as OscillatorType;
  else o.setPeriodicWave(type as PeriodicWave);
}

/** Oscillator that is already scheduled to start and stop. */
export function osc(ctx: Ctx, type: WaveType, freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  setWave(o, type);
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(Math.max(0, t0));
  o.stop(Math.max(0, t1));
  return o;
}

/** Deterministic stereo white-noise source, already scheduled to start and stop. */
export function noise(ctx: Ctx, seed: number, t0: number, t1: number): AudioBufferSourceNode {
  const need = Math.max(0.05, t1 - t0);
  const len = Math.min(4, Math.max(0.25, Math.ceil(need * 4) / 4));
  const src = ctx.createBufferSource();
  src.buffer = cached(ctx, `noise:${seed}:${len}`, () => noiseBuffer(ctx, len, seed));
  src.loop = need > len;
  src.start(Math.max(0, t0));
  src.stop(Math.max(0, t1));
  return src;
}

/** Walk a step pattern such as "x---x-o-X---x---": x = hit, X = accent, o = ghost, else rest. */
export function steps(pattern: string, t0: number, stepDur: number, fn: (time: number, vel: number, index: number) => void): void {
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const vel = ch === 'X' ? 1 : ch === 'x' ? 0.78 : ch === 'o' ? 0.4 : 0;
    if (vel > 0) fn(t0 + i * stepDur, vel, i);
  }
}

// ---------------------------------------------------------------------------------------------
// Saturation, limiting and the final output stage
// ---------------------------------------------------------------------------------------------

const CLIP_RANGE = 4;
const CLIP_KNEE = 0.8;
let clipCurve: Float32Array<ArrayBuffer> | null = null;

function getClipCurve(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const n = 8193;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(u);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE));
    curve[i] = u < 0 ? -y : y;
  }
  clipCurve = curve;
  return curve;
}

/**
 * Transparent limiter: exactly linear up to 0.8, then a tanh knee that never exceeds 1.0
 * (inputs up to ±4 are shaped; anything beyond is hard-limited at 1.0).
 */
export function softClip(ctx: Ctx, preGain = 1): { input: GainNode; output: WaveShaperNode } {
  const input = vca(ctx, preGain / CLIP_RANGE);
  const shaper = ctx.createWaveShaper();
  shaper.curve = getClipCurve();
  input.connect(shaper);
  return { input, output: shaper };
}

const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();

/** Warm tanh saturation. `amount` is the gain into the curve (1 = gentle, 4+ = heavy). Output ≤ 1. */
export function drive(ctx: Ctx, amount: number, range = 8): { input: GainNode; output: WaveShaperNode } {
  let curve = driveCurves.get(range);
  if (!curve) {
    const n = 4097;
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * range);
    driveCurves.set(range, curve);
  }
  const input = vca(ctx, amount / range);
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  input.connect(shaper);
  return { input, output: shaper };
}

export interface OutOpts {
  /** Length of the sound in seconds (the SoundDef duration). */
  dur: number;
  /** Gain into the limiter. */
  level?: number;
  /** Fade-in at time 0 (default 2 ms). */
  attack?: number;
  /** Fade-out before the end (default 20 ms). */
  release?: number;
}

/** Peak ceiling of every sound (just under -1 dBFS). */
export const CEILING = 0.89;

/**
 * Final stage for one-shots: level → soft limiter → edge fades → `dest`. Connect voices to the
 * returned node. The output can never exceed `CEILING`, starts from silence and is silent for the
 * last few milliseconds.
 */
export function output(ctx: Ctx, dest: AudioNode, o: OutOpts): GainNode {
  const clip = softClip(ctx, o.level ?? 1);
  const edge = vca(ctx, 0);
  const attack = o.attack ?? 0.002;
  const end = o.dur - 0.006;
  const release = Math.min(o.release ?? 0.02, end - attack - 0.001);
  edge.gain.setValueAtTime(0, 0);
  edge.gain.linearRampToValueAtTime(CEILING, attack);
  edge.gain.setValueAtTime(CEILING, end - release);
  edge.gain.linearRampToValueAtTime(0, end);
  clip.output.connect(edge).connect(dest);
  return clip.input;
}

// ---------------------------------------------------------------------------------------------
// Space: feedback-delay-network reverb, noise-impulse reverb, echo, widener
// ---------------------------------------------------------------------------------------------
//
// No effect here builds a feedback loop out of DelayNodes. Chromium renders such cycles
// differently from one render to the next, which breaks determinism. Reverbs and echoes are
// convolutions instead, with impulse responses computed in plain JS. The feedback-delay network
// below is simulated sample by sample in JS to produce its impulse response.

export interface Fx {
  input: AudioNode;
  output: AudioNode;
}

/** Convolver with `ir` (no normalisation) behind a unity input gain. */
function convolver(ctx: Ctx, ir: AudioBuffer): Fx {
  const input = vca(ctx, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir;
  input.connect(conv);
  return { input, output: conv };
}

export interface ReverbOpts {
  /** RT60 in seconds. */
  decay: number;
  /** High-frequency damping: cutoff of the low-pass inside the feedback loops (Hz). */
  damp?: number;
  /** Pre-delay in seconds. */
  pre?: number;
  /** Room size multiplier for the delay lengths (1 = medium hall). */
  size?: number;
  /** High-pass on the reverb input (Hz). */
  lowCut?: number;
}

const FDN_TIMES = [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0593, 0.0671, 0.0733];
const FDN_SIGNS = [1, -1, 1, -1, -1, 1, -1, 1];
const DIFFUSERS: readonly (readonly [seconds: number, gain: number])[] = [
  [0.0043, 0.6],
  [0.0069, 0.6],
  [0.0107, 0.55],
];

/**
 * Impulse response of a stereo feedback delay network: three Schroeder all-pass diffusers feed
 * eight damped delay lines coupled by a Householder matrix. Even lines feed the left output and
 * odd lines the right, so the tail is decorrelated.
 */
function fdnImpulse(ctx: Ctx, o: ReverbOpts): AudioBuffer {
  const sr = ctx.sampleRate;
  const size = o.size ?? 1;
  const pre = Math.round(Math.min(0.29, o.pre ?? 0.012) * sr);
  const n = pre + Math.ceil(o.decay * 1.1 * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  // Diffused excitation: a unit impulse through the all-pass chain.
  let x: Float32Array<ArrayBuffer> = new Float32Array(n);
  x[pre] = 1;
  for (const [seconds, g] of DIFFUSERS) {
    const d = Math.max(1, Math.round(seconds * size * sr));
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const xd = i >= d ? x[i - d] : 0;
      const yd = i >= d ? y[i - d] : 0;
      y[i] = -g * x[i] + xd + g * yd;
    }
    x = y;
  }

  const lines = FDN_TIMES.length;
  const delays = FDN_TIMES.map((t) => Math.max(1, Math.round(t * size * sr)));
  const gains = FDN_TIMES.map((t) => Math.pow(10, (-3 * t * size) / o.decay));
  const meanSq = gains.reduce((s, g) => s + g * g, 0) / lines;
  const out = 0.5 * Math.sqrt(Math.max(0.02, 1 - meanSq));
  const a = Math.exp((-2 * Math.PI * (o.damp ?? 5200)) / sr);
  // Ring buffers hold each line's input; `lp` is the state of each line's damping filter.
  const rings = delays.map((d) => new Float32Array(d));
  const lp = new Float64Array(lines);
  const fb = new Float64Array(lines);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < lines; k++) {
      const ring = rings[k];
      const read = ring[i % delays[k]];
      lp[k] = (1 - a) * read + a * lp[k];
      fb[k] = gains[k] * lp[k];
      sum += fb[k];
      const tap = read * FDN_SIGNS[k] * out;
      if (k % 2 === 0) left[i] += tap;
      else right[i] += tap;
    }
    const mix = (-2 / lines) * sum;
    for (let k = 0; k < lines; k++) rings[k][i % delays[k]] = x[i] + fb[k] + mix;
  }
  // Low cut and a short fade so the truncated tail ends cleanly.
  const channels = [left, right];
  for (const ch of channels) {
    biquadInPlace(ch, sr, 'highpass', o.lowCut ?? 140, 0.6);
    const fadeLen = Math.min(n, Math.floor(0.06 * sr));
    for (let i = 0; i < fadeLen; i++) ch[n - 1 - i] *= i / fadeLen;
  }
  const buffer = ctx.createBuffer(2, n, sr);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  return buffer;
}

/** Second-order filter applied in place (Audio EQ Cookbook low- / high-pass). */
function biquadInPlace(x: Float32Array, sr: number, type: 'lowpass' | 'highpass', freq: number, q: number): void {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = (type === 'lowpass' ? 1 - cos : -(1 + cos)) / a0;
  const b0 = (type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
}

/**
 * Stereo room / hall reverb (wet only) from a feedback delay network. The network is simulated in
 * JS and applied as a convolution, so the result is identical on every render.
 */
export function reverb(ctx: Ctx, o: ReverbOpts): Fx {
  const key = `fdn:${o.decay}:${o.damp ?? ''}:${o.pre ?? ''}:${o.size ?? ''}:${o.lowCut ?? ''}`;
  return convolver(ctx, cached(ctx, key, () => fdnImpulse(ctx, o)));
}

export interface ConvReverbOpts {
  /** RT60 in seconds. */
  decay: number;
  seed?: number;
  /** Cutoff above which the tail decays much faster (Hz). */
  tone?: number;
  /** Pre-delay in seconds. */
  pre?: number;
}

/**
 * Dense, smooth reverb: convolution with a synthesised impulse response (decaying stereo noise,
 * darker over time). The impulse is energy-normalised, so the tail carries about the same energy
 * as the dry signal for a wet gain of 1.
 */
export function convReverb(ctx: Ctx, o: ConvReverbOpts): Fx {
  const seed = o.seed ?? 4711;
  const tone = o.tone ?? 3500;
  const pre = o.pre ?? 0.008;
  const key = `ir:${o.decay}:${seed}:${tone}:${pre}`;
  const ir = cached(ctx, key, () => {
    const sr = ctx.sampleRate;
    const length = Math.ceil((pre + o.decay * 1.08) * sr);
    const buffer = ctx.createBuffer(2, length, sr);
    const start = Math.floor(pre * sr);
    const alpha = 1 - Math.exp((-2 * Math.PI * tone) / sr);
    const fadeIn = Math.floor(0.004 * sr);
    const fadeOut = Math.floor(0.05 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const rnd = seededRandom(seed + ch * 104729);
      const data = buffer.getChannelData(ch);
      let lp = 0;
      let energy = 0;
      for (let i = start; i < length; i++) {
        const t = (i - start) / sr;
        const w = rnd() * 2 - 1;
        lp += alpha * (w - lp);
        const body = lp * Math.exp((-6.908 * t) / o.decay);
        const air = (w - lp) * 0.35 * Math.exp((-6.908 * t) / (o.decay * 0.38));
        let v = body + air;
        if (i - start < fadeIn) v *= (i - start) / fadeIn;
        if (length - i < fadeOut) v *= (length - i) / fadeOut;
        data[i] = v;
        energy += v * v;
      }
      const norm = 1 / Math.sqrt(energy || 1);
      for (let i = start; i < length; i++) data[i] *= norm;
    }
    return buffer;
  });
  return convolver(ctx, ir);
}

export interface EchoOpts {
  time: number;
  feedback: number;
  /** Low-pass applied once more on every repeat (Hz). */
  tone?: number;
  /** Ping-pong amount: 0 = centred, 1 = hard left/right alternation. */
  spread?: number;
}

/**
 * Feedback echo (wet only), applied as a convolution with its own impulse response. With
 * `spread`, repeats alternate between left and right.
 */
export function echo(ctx: Ctx, o: EchoOpts): Fx {
  const spread = o.spread ?? 0;
  const key = `echo:${o.time}:${o.feedback}:${o.tone ?? ''}:${spread}`;
  const ir = cached(ctx, key, () => {
    const sr = ctx.sampleRate;
    const d = Math.max(1, Math.round(o.time * sr));
    // Repeats until they have fallen by 60 dB.
    const repeats = Math.max(1, Math.min(64, Math.ceil(-3 / Math.log10(Math.max(1e-3, Math.min(0.95, o.feedback))))));
    const n = d * (repeats + 1) + Math.floor(0.05 * sr);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    // Each repeat is the previous one, one delay later, scaled and low-passed once more.
    let pulse: Float32Array<ArrayBuffer> = new Float32Array(Math.floor(0.05 * sr));
    pulse[0] = 1;
    let level = 1;
    for (let r = 1; r <= repeats; r++) {
      const next = Float32Array.from(pulse);
      biquadInPlace(next, sr, 'lowpass', o.tone ?? 4000, 0.5);
      pulse = next;
      level *= r === 1 ? 1 : o.feedback;
      const side = r % 2 === 1 ? -spread : spread;
      const gl = Math.cos(((side + 1) * Math.PI) / 4);
      const gr = Math.sin(((side + 1) * Math.PI) / 4);
      for (let i = 0; i < pulse.length && r * d + i < n; i++) {
        left[r * d + i] += pulse[i] * level * gl;
        right[r * d + i] += pulse[i] * level * gr;
      }
    }
    const buffer = ctx.createBuffer(2, n, sr);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
  });
  const fx = convolver(ctx, ir);
  const input = mono(ctx);
  input.connect(fx.input);
  return { input, output: fx.output };
}

/**
 * Haas-style widener for a centred source: adds short, filtered, hard-panned copies. Returns the
 * wet signal only — mix it under the dry one.
 */
export function widen(ctx: Ctx, amount = 0.5): Fx {
  const input = mono(ctx);
  const output = vca(ctx, amount);
  const times = [0.0113, 0.0171];
  for (let i = 0; i < 2; i++) {
    const d = ctx.createDelay(0.05);
    d.delayTime.value = times[i];
    chain(input, d, filt(ctx, 'highpass', 250, 0.6), panner(ctx, i === 0 ? -1 : 1), output);
  }
  return { input, output };
}

// ---------------------------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------------------------

const isPts = (f: number | readonly Pt[]): f is readonly Pt[] => typeof f !== 'number';

function setFreq(p: AudioParam, f: number | readonly Pt[], t: number): void {
  if (isPts(f)) {
    p.value = f[0][1];
    env(p, shift(f, t));
  } else {
    p.value = f;
  }
}

export interface ToneOpts {
  t: number;
  /** Frequency in Hz, or a frequency envelope with times relative to `t`. */
  f: number | readonly Pt[];
  type?: WaveType;
  /** Attack in seconds (default 2 ms). */
  a?: number;
  /** Hold at the peak before the decay starts. */
  hold?: number;
  /** Decay: time to fall by 60 dB. */
  d: number;
  gain: number;
  pan?: number;
  detune?: number;
}

/** Oscillator with a percussive envelope and an optional pitch envelope. Returns the end time. */
export function tone(ctx: Ctx, out: AudioNode, o: ToneOpts): number {
  const g = vca(ctx);
  const end = perc(g.gain, o.t, o.gain, o.a ?? 0.002, o.d, o.hold ?? 0);
  const src = osc(ctx, o.type ?? 'sine', 440, o.t, end + 0.01, o.detune ?? 0);
  setFreq(src.frequency, o.f, o.t);
  src.connect(g);
  toOut(ctx, g, out, o.pan ?? 0);
  return end;
}

export interface NoiseHitOpts {
  t: number;
  seed: number;
  type?: BiquadFilterType;
  /** Filter frequency in Hz, or an envelope with times relative to `t`. */
  f: number | readonly Pt[];
  q?: number;
  /** Use two cascaded filters for steeper skirts. */
  steep?: boolean;
  a?: number;
  hold?: number;
  d: number;
  gain: number;
  pan?: number;
  /** Collapse the noise to mono (centred, tighter). */
  centre?: boolean;
}

/** Filtered noise burst with a percussive envelope. Returns the end time. */
export function noiseHit(ctx: Ctx, out: AudioNode, o: NoiseHitOpts): number {
  const g = vca(ctx);
  const end = perc(g.gain, o.t, o.gain, o.a ?? 0.001, o.d, o.hold ?? 0);
  const src = noise(ctx, o.seed, o.t, end + 0.01);
  const f1 = filt(ctx, o.type ?? 'bandpass', 1000, o.q ?? 1);
  setFreq(f1.frequency, o.f, o.t);
  let last: AudioNode = o.centre ? chain(src, mono(ctx), f1) : chain(src, f1);
  if (o.steep) {
    const f2 = filt(ctx, o.type ?? 'bandpass', 1000, o.q ?? 1);
    setFreq(f2.frequency, o.f, o.t);
    last = last.connect(f2);
  }
  last.connect(g);
  toOut(ctx, g, out, o.pan ?? 0);
  return end;
}

/** [frequency ratio, amplitude, decay multiplier] */
export type Partial3 = readonly [ratio: number, amp: number, decay: number];

/** Glassy, mostly harmonic partials — a clean notification-style chime. */
export const CHIME: readonly Partial3[] = [
  [1, 1, 1],
  [2, 0.3, 0.6],
  [3, 0.12, 0.4],
  [4.2, 0.05, 0.22],
];
/** Tuned bar (glockenspiel / music box). */
export const GLOCK: readonly Partial3[] = [
  [1, 1, 1],
  [2.756, 0.32, 0.45],
  [5.404, 0.12, 0.25],
  [8.933, 0.04, 0.14],
];
/** Marimba bar: strong fundamental, tuned 4th harmonic, a touch of the 10th. */
export const MARIMBA: readonly Partial3[] = [
  [1, 1, 1],
  [3.98, 0.28, 0.32],
  [9.9, 0.07, 0.12],
];
/** Church-bell-like inharmonic set (hum, prime, tierce, quint, nominal…). */
export const BELL: readonly Partial3[] = [
  [0.5, 0.35, 1.3],
  [1, 1, 1],
  [1.19, 0.5, 0.8],
  [1.5, 0.3, 0.65],
  [2, 0.45, 0.55],
  [2.74, 0.2, 0.35],
  [4.07, 0.1, 0.2],
];

export interface ChimeOpts {
  t: number;
  f: number;
  /** Decay of the fundamental: time to fall by 60 dB. */
  d: number;
  gain: number;
  a?: number;
  pan?: number;
  partials?: readonly Partial3[];
}

/** Additive struck-bar / bell voice: sine partials with individual decays. Returns the end time. */
export function chime(ctx: Ctx, out: AudioNode, o: ChimeOpts): number {
  const partials = o.partials ?? CHIME;
  const sum = vca(ctx, 1);
  let end = o.t;
  for (const [ratio, amp, decay] of partials) {
    const f = o.f * ratio;
    if (f > 16000) continue;
    const g = vca(ctx);
    const e = perc(g.gain, o.t, o.gain * amp, o.a ?? 0.003, o.d * decay);
    osc(ctx, 'sine', f, o.t, e + 0.01).connect(g).connect(sum);
    end = Math.max(end, e);
  }
  toOut(ctx, sum, out, o.pan ?? 0);
  return end;
}

export interface FmOpts {
  t: number;
  f: number;
  /** Modulator / carrier frequency ratio. */
  ratio?: number;
  /** Peak modulation index. */
  index?: number;
  /** Time for the index to fall to ~5 % (seconds). */
  indexDecay?: number;
  a?: number;
  hold?: number;
  d: number;
  gain: number;
  pan?: number;
}

/** Two-operator FM voice (electric-piano / bell / metallic tones). Returns the end time. */
export function fm(ctx: Ctx, out: AudioNode, o: FmOpts): number {
  const ratio = o.ratio ?? 2;
  const index = o.index ?? 2;
  const g = vca(ctx);
  const end = perc(g.gain, o.t, o.gain, o.a ?? 0.003, o.d, o.hold ?? 0);
  const carrier = osc(ctx, 'sine', o.f, o.t, end + 0.01);
  const modulator = osc(ctx, 'sine', o.f * ratio, o.t, end + 0.01);
  const depth = vca(ctx);
  const peak = index * o.f * ratio;
  env(depth.gain, [
    [o.t, peak],
    [o.t + (o.indexDecay ?? o.d * 0.4), peak * 0.05, 'exp'],
  ]);
  modulator.connect(depth).connect(carrier.frequency);
  carrier.connect(g);
  toOut(ctx, g, out, o.pan ?? 0);
  return end;
}

export interface PluckOpts {
  t: number;
  f: number;
  /** Decay: time to fall by 60 dB. */
  d: number;
  gain: number;
  type?: WaveType;
  /** Filter opens to `f * bright` on the attack (capped at 9 kHz). */
  bright?: number;
  q?: number;
  pan?: number;
  detune?: number;
}

/** Subtractive pluck: a bright attack that closes quickly through a low-pass. Returns the end time. */
export function pluck(ctx: Ctx, out: AudioNode, o: PluckOpts): number {
  const g = vca(ctx);
  const end = perc(g.gain, o.t, o.gain, 0.002, o.d);
  const top = Math.min(9000, o.f * (o.bright ?? 8));
  const lp = filt(ctx, 'lowpass', top, o.q ?? 1.2);
  env(lp.frequency, [
    [o.t, top],
    [o.t + o.d * 0.4, Math.max(200, o.f * 1.3), 'exp'],
  ]);
  const detune = o.detune ?? 0;
  osc(ctx, o.type ?? 'sawtooth', o.f, o.t, end + 0.01, -detune).connect(lp);
  if (detune) osc(ctx, o.type ?? 'sawtooth', o.f, o.t, end + 0.01, detune).connect(lp);
  lp.connect(g);
  toOut(ctx, g, out, o.pan ?? 0);
  return end;
}

export interface PadOpts {
  t: number;
  dur: number;
  freqs: readonly number[];
  gain: number;
  a?: number;
  r?: number;
  /** Low-pass cutoff in Hz, or an envelope with times relative to `t`. */
  cutoff?: number | readonly Pt[];
  q?: number;
  type?: WaveType;
  /** Detune between the two oscillators of every note, in cents. */
  detune?: number;
  /** Stereo spread of the detuned pairs (0..1). */
  spread?: number;
}

/** Detuned-saw pad: every note is a left/right oscillator pair through a low-pass. Returns the end time. */
export function pad(ctx: Ctx, out: AudioNode, o: PadOpts): number {
  const a = o.a ?? 0.3;
  const r = o.r ?? 0.5;
  const end = o.t + o.dur;
  const detune = o.detune ?? 9;
  const spread = o.spread ?? 0.7;
  const per = o.gain / Math.sqrt(o.freqs.length);
  for (const side of [-1, 1]) {
    const lp = filt(ctx, 'lowpass', 1200, o.q ?? 0.8);
    setFreq(lp.frequency, o.cutoff ?? 1800, o.t);
    const g = vca(ctx);
    env(g.gain, [
      [o.t, 0],
      [o.t + a, per],
      [Math.max(o.t + a, end - r), per, 'set'],
      [end, 0],
    ]);
    for (const f of o.freqs) osc(ctx, o.type ?? 'sawtooth', f, o.t, end + 0.01, side * detune).connect(lp);
    chain(lp, g, panner(ctx, side * spread), out);
  }
  return end;
}

export interface KickOpts {
  t: number;
  gain: number;
  /** Start / end frequency of the pitch sweep. */
  f0?: number;
  f1?: number;
  /** Duration of the pitch sweep. */
  sweep?: number;
  /** Decay: time to fall by 60 dB. */
  d?: number;
  /** Level of the click transient relative to the body. */
  click?: number;
  seed?: number;
}

/** 808-style kick: sine with a fast pitch envelope plus a short filtered-noise click. */
export function kick(ctx: Ctx, out: AudioNode, o: KickOpts): number {
  const f0 = o.f0 ?? 150;
  const f1 = o.f1 ?? 46;
  const end = tone(ctx, out, {
    t: o.t,
    f: [
      [0, f0],
      [o.sweep ?? 0.07, f1, 'exp'],
    ],
    a: 0.0015,
    d: o.d ?? 0.45,
    gain: o.gain,
  });
  const click = o.click ?? 0.3;
  if (click > 0) noiseHit(ctx, out, { t: o.t, seed: o.seed ?? 5, type: 'lowpass', f: 3200, q: 0.6, a: 0.0008, d: 0.018, gain: o.gain * click, centre: true });
  return end;
}

export interface SnareOpts {
  t: number;
  gain: number;
  /** Pitch of the drum body. */
  f?: number;
  /** Decay of the noise: time to fall by 60 dB. */
  d?: number;
  seed?: number;
}

/** Snare: two pitched body partials plus high-passed noise. */
export function snare(ctx: Ctx, out: AudioNode, o: SnareOpts): number {
  const f = o.f ?? 190;
  const d = o.d ?? 0.2;
  tone(ctx, out, {
    t: o.t,
    f: [
      [0, f * 1.4],
      [0.02, f, 'exp'],
    ],
    a: 0.001,
    d: d * 0.6,
    gain: o.gain * 0.6,
  });
  tone(ctx, out, { t: o.t, f: f * 1.62, a: 0.001, d: d * 0.4, gain: o.gain * 0.25 });
  return noiseHit(ctx, out, { t: o.t, seed: o.seed ?? 9, type: 'highpass', f: 1800, q: 0.7, a: 0.001, d, gain: o.gain * 0.7 });
}

export interface HatOpts {
  t: number;
  gain: number;
  /** Decay: time to fall by 60 dB (0.05 = closed, 0.4 = open). */
  d?: number;
  f?: number;
  seed?: number;
  pan?: number;
}

/** Hi-hat: steeply high-passed noise. */
export function hat(ctx: Ctx, out: AudioNode, o: HatOpts): number {
  return noiseHit(ctx, out, { t: o.t, seed: o.seed ?? 13, type: 'highpass', f: o.f ?? 7500, q: 0.8, steep: true, a: 0.001, d: o.d ?? 0.06, gain: o.gain, pan: o.pan ?? 0 });
}

// ---------------------------------------------------------------------------------------------
// Deterministic wiring
// ---------------------------------------------------------------------------------------------
//
// Chromium adds up the inputs of a node (or AudioParam) in an order that is not stable from one
// render to the next. With two inputs that is harmless (a + b == b + a exactly), but with three or
// more the floating-point rounding differs, so two renders of the same graph are not bit-identical
// and the error can grow through filters and saturation. `deterministic` records every connection
// made while a sound builds its graph and then wires each destination with at most two inputs,
// through a balanced tree of unity-gain junctions.

type Dest = AudioNode | AudioParam;
type ConnectFn = (this: AudioNode, ...args: unknown[]) => unknown;

let recording = false;

function wireTree(ctx: Ctx, connect: ConnectFn, sources: AudioNode[], dest: Dest): void {
  let level = sources;
  while (level.length > 2) {
    const next: AudioNode[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      const junction = ctx.createGain();
      connect.call(level[i], junction);
      connect.call(level[i + 1], junction);
      next.push(junction);
    }
    if (level.length % 2 === 1) next.push(level[level.length - 1]);
    level = next;
  }
  for (const src of level) connect.call(src, dest);
}

/**
 * Run `build` (which creates and connects a sound's nodes) so that every connection it makes is
 * re-wired with a fan-in of at most two. Connections are wired after `build` returns; `connect`
 * still returns the destination, so chained `a.connect(b).connect(c)` calls work as usual.
 */
export function deterministic<T>(ctx: Ctx, build: () => T): T {
  if (recording) return build();
  const proto = AudioNode.prototype as unknown as { connect: ConnectFn };
  const native = proto.connect;
  const edges = new Map<Dest, AudioNode[]>();
  proto.connect = function (this: AudioNode, ...args: unknown[]): unknown {
    const dest = args[0];
    // Only plain node → node / node → param connections are recorded.
    if (args.length !== 1 || !(dest instanceof AudioNode || dest instanceof AudioParam)) return native.apply(this, args);
    let list = edges.get(dest);
    if (!list) {
      list = [];
      edges.set(dest, list);
    }
    if (!list.includes(this)) list.push(this);
    return dest instanceof AudioNode ? dest : undefined;
  };
  recording = true;
  let result: T;
  try {
    result = build();
  } finally {
    proto.connect = native;
    recording = false;
  }
  for (const [dest, sources] of edges) wireTree(ctx, native, sources, dest);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Pack helpers
// ---------------------------------------------------------------------------------------------

/** Stereo panner whose position follows an envelope (times relative to `t`). */
export function autoPan(ctx: Ctx, pts: readonly Pt[], t = 0): StereoPannerNode {
  const p = panner(ctx, pts[0][1]);
  env(p.pan, shift(pts, t));
  return p;
}

export interface SweepOpts {
  t: number;
  dur: number;
  seed: number;
  type?: BiquadFilterType;
  /** Filter frequency envelope, times relative to `t`. */
  f: readonly Pt[];
  q?: number;
  /** Two cascaded filters for a more focused band. */
  steep?: boolean;
  gain: number;
  /** Position (0..1) of the loudest point and how narrow the swell is. */
  peakAt?: number;
  sharp?: number;
  /** Static pan or a pan envelope (times relative to `t`). */
  pan?: number | readonly Pt[];
}

/** Swept, filtered noise with a smooth swell — the core of every whoosh. Returns the gain node. */
export function sweep(ctx: Ctx, out: AudioNode, o: SweepOpts): GainNode {
  const src = noise(ctx, o.seed, o.t, o.t + o.dur + 0.02);
  const type = o.type ?? 'bandpass';
  const f1 = filt(ctx, type, o.f[0][1], o.q ?? 1);
  env(f1.frequency, shift(o.f, o.t));
  let last: AudioNode = src.connect(f1);
  if (o.steep) {
    const f2 = filt(ctx, type, o.f[0][1], o.q ?? 1);
    env(f2.frequency, shift(o.f, o.t));
    last = last.connect(f2);
  }
  const g = vca(ctx);
  shape(g.gain, o.t, o.dur, bump(o.peakAt ?? 0.5, o.sharp ?? 1), o.gain);
  last.connect(g);
  const pan = o.pan ?? 0;
  if (typeof pan === 'number') toOut(ctx, g, out, pan);
  else g.connect(autoPan(ctx, pan, o.t)).connect(out);
  return g;
}

/** Stair-step curve for a WaveShaper: reduces the signal to `levels` amplitude steps (bit-crush). */
export function crusher(ctx: Ctx, levels: number): WaveShaperNode {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  return shaper;
}

export interface EdgeOpts {
  /** Fade-in at time 0 (default 2 ms). */
  attack?: number;
  /** Fade-out before the end (default 20 ms). */
  release?: number;
}

/**
 * Factory for one-shot sound definitions of one category. `level` is the gain into the limiter;
 * `build` receives the output bus to connect voices to.
 */
export function oneShot(category: SoundCategory) {
  return (id: string, name: string, duration: number, keywords: string[], level: number, build: (ctx: Ctx, out: GainNode) => void, edge: EdgeOpts = {}): SoundDef => ({
    id,
    name,
    category,
    duration,
    keywords,
    render: (ctx, dest) => deterministic(ctx, () => build(ctx, output(ctx, dest, { dur: duration, level, ...edge }))),
  });
}
