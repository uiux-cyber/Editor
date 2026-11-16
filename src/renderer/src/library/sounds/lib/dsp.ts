/**
 * Plain-JS signal processing used to "bake" short buffers that are then played through
 * AudioBufferSourceNodes: drum hits for the music beds and seamless noise beds for the ambiences.
 *
 * Baking keeps two things simple that are awkward with nodes alone:
 *  - a hit that rings past the loop point can be wrapped exactly (play the same buffer again at
 *    time 0, starting at the matching offset);
 *  - noise can be filtered circularly, so a filtered noise bed has no seam at all.
 * Everything is deterministic (seeded PRNG only).
 */

import { seededRandom } from '@/core/easing';
import { cached, type Ctx } from './synth';

export type F32 = Float32Array<ArrayBuffer>;

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export interface Coefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

/** Biquad coefficients (Audio EQ Cookbook). `bandpass` has 0 dB gain at its centre. */
export function coefs(kind: FilterKind, sr: number, freq: number, q = 0.707, gainDb = 0): Coefs {
  const w0 = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const k = 2 * Math.sqrt(A) * ((sin / 2) * Math.SQRT2);
      b0 = A * (A + 1 - (A - 1) * cos + k);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - k);
      a0 = A + 1 + (A - 1) * cos + k;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - k;
      break;
    }
    default: {
      const k = 2 * Math.sqrt(A) * ((sin / 2) * Math.SQRT2);
      b0 = A * (A + 1 + (A - 1) * cos + k);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - k);
      a0 = A + 1 - (A - 1) * cos + k;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - k;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Filter `x` in place. With `circular`, the filter state is first warmed up on the end of the
 * buffer, so the result is (to well below audibility) one period of a periodic signal.
 */
export function biquad(x: F32, c: Coefs, circular = false): F32 {
  const n = x.length;
  let z1 = 0;
  let z2 = 0;
  if (circular) {
    for (let i = Math.max(0, n - 48000); i < n; i++) {
      const v = x[i];
      const y = c.b0 * v + z1;
      z1 = c.b1 * v - c.a1 * y + z2;
      z2 = c.b2 * v - c.a2 * y;
    }
  }
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const y = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * y + z2;
    z2 = c.b2 * v - c.a2 * y;
    x[i] = y;
  }
  return x;
}

// ---------------------------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------------------------

/** White noise in -1..1. */
export function white(n: number, seed: number): F32 {
  const rnd = seededRandom(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  return x;
}

/** Raised-cosine fade-in and fade-out, in place. */
export function fade(x: F32, sr: number, inSec: number, outSec: number): F32 {
  const n = x.length;
  const a = Math.min(n, Math.floor(inSec * sr));
  const b = Math.min(n, Math.floor(outSec * sr));
  for (let i = 0; i < a; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  for (let i = 0; i < b; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  return x;
}

/** Scale all channels together so that the loudest sample hits `peak`. */
export function normalize(channels: F32[], peak = 1): void {
  let max = 0;
  for (const x of channels) for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  if (max <= 0) return;
  const k = peak / max;
  for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= k;
}

export function toBuffer(ctx: Ctx, channels: F32[]): AudioBuffer {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((x, ch) => buffer.copyToChannel(x, ch));
  return buffer;
}

/** Exactly `n` samples of white noise, run circularly through `filters` — loops without a seam. */
export function loopNoise(n: number, seed: number, filters: readonly Coefs[]): F32 {
  const x = white(n, seed);
  for (const c of filters) biquad(x, c, true);
  return x;
}

// ---------------------------------------------------------------------------------------------
// Baked drum hits (all normalised to a peak of 1.0)
// ---------------------------------------------------------------------------------------------

export interface KickSpec {
  /** Start / end frequency of the pitch sweep (Hz). */
  f0?: number;
  f1?: number;
  /** Time constant of the pitch sweep (s). */
  sweep?: number;
  /** Hold at full level before the decay starts (s). */
  hold?: number;
  /** Time constant of the amplitude decay (s). */
  decay?: number;
  /** Level of the click transient. */
  click?: number;
  /** Saturation amount (1 = clean-ish, 3 = crunchy). */
  drive?: number;
  /** Low-pass over the whole hit (Hz) — lower for dusty, soft kicks. */
  tone?: number;
  len?: number;
}

export function kickBuf(ctx: Ctx, s: KickSpec = {}): AudioBuffer {
  return cached(ctx, 'kick:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { f0 = 150, f1 = 47, sweep = 0.03, hold = 0.015, decay = 0.13, click = 0.2, drive = 1.6, tone = 9000, len = 0.5 } = s;
    const n = Math.ceil(len * sr);
    const x = new Float32Array(n);
    const rnd = seededRandom(77);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const phase = 2 * Math.PI * (f1 * t + (f0 - f1) * sweep * (1 - Math.exp(-t / sweep)));
      const amp = t < hold ? 1 : Math.exp(-(t - hold) / decay);
      lp += 0.4 * (rnd() * 2 - 1 - lp);
      const v = Math.sin(phase) * amp + lp * click * Math.exp(-t / 0.003);
      x[i] = Math.tanh(v * drive);
    }
    biquad(x, coefs('lowpass', sr, tone, 0.6));
    fade(x, sr, 0.0012, Math.min(0.08, len * 0.3));
    normalize([x]);
    return toBuffer(ctx, [x]);
  });
}

export interface SnareSpec {
  /** Pitch of the drum body (Hz). */
  tone?: number;
  toneDecay?: number;
  /** Body / noise balance (0 = all noise, 1 = all body). */
  toneMix?: number;
  /** Time constant of the snare-wire noise (s). */
  noiseDecay?: number;
  /** High-pass of the noise (Hz). */
  hp?: number;
  /** Low-pass over the whole hit (Hz). */
  lp?: number;
  /** Level and time constant of the baked stereo room tail. */
  room?: number;
  roomDecay?: number;
  /** If set, the room tail is held and then cut after this many seconds (gated reverb). */
  gate?: number;
  drive?: number;
  len?: number;
  seed?: number;
}

export function snareBuf(ctx: Ctx, s: SnareSpec = {}): AudioBuffer {
  return cached(ctx, 'snare:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { tone = 185, toneDecay = 0.05, toneMix = 0.5, noiseDecay = 0.07, hp = 1500, lp = 15000, room = 0, roomDecay = 0.16, gate = 0, drive = 1.3, seed = 31 } = s;
    const len = s.len ?? Math.max(0.3, room > 0 ? (gate > 0 ? gate + 0.12 : roomDecay * 6) : noiseDecay * 7);
    const n = Math.ceil(len * sr);
    const shape = (x: F32): F32 => {
      biquad(x, coefs('highpass', sr, hp, 0.7));
      biquad(x, coefs('peaking', sr, 3800, 0.8, 4));
      return x;
    };
    const common = shape(white(n, seed));
    const out: F32[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const side = shape(white(n, seed + 11 + ch));
      const roomNoise = room > 0 ? biquad(biquad(white(n, seed + 23 + ch), coefs('bandpass', sr, 1700, 0.45)), coefs('lowpass', sr, 6500, 0.6)) : null;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const bend = tone * (t + 0.5 * 0.012 * (1 - Math.exp(-t / 0.012)));
        const body = (Math.sin(2 * Math.PI * bend) + 0.4 * Math.sin(2 * Math.PI * bend * 1.6) * Math.exp(-t / 0.02)) * Math.exp(-t / toneDecay);
        const wires = (0.8 * common[i] + 0.4 * side[i]) * Math.exp(-t / noiseDecay);
        let v = toneMix * body + (1 - toneMix) * 1.5 * wires;
        if (roomNoise) {
          const tail = gate > 0 ? (t < gate ? 0.75 + 0.25 * Math.exp(-t / roomDecay) : Math.exp(-(t - gate) / 0.012)) : Math.exp(-t / roomDecay);
          v += roomNoise[i] * room * 2.2 * (1 - Math.exp(-t / 0.004)) * tail;
        }
        x[i] = Math.tanh(v * drive);
      }
      biquad(x, coefs('lowpass', sr, lp, 0.6));
      fade(x, sr, 0.0008, Math.min(0.05, len * 0.25));
      out.push(x);
    }
    normalize(out);
    return toBuffer(ctx, out);
  });
}

export interface HatSpec {
  /** Time constant of the decay (s): ~0.02 closed, ~0.15 open, ~0.6 crash. */
  decay?: number;
  hp?: number;
  lp?: number;
  /** Amount of the metallic square-wave cluster against plain noise (0..1). */
  metal?: number;
  attack?: number;
  len?: number;
  seed?: number;
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function hatBuf(ctx: Ctx, s: HatSpec = {}): AudioBuffer {
  return cached(ctx, 'hat:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { decay = 0.022, hp = 7000, lp = 13500, metal = 0.4, attack = 0.0008, seed = 51 } = s;
    const len = s.len ?? Math.min(2.5, decay * 7 + 0.02);
    const n = Math.ceil(len * sr);
    const cluster = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (const f of METAL) v += Math.sin(2 * Math.PI * f * 1.48 * t) >= 0 ? 1 : -1;
      cluster[i] = v / METAL.length;
    }
    const out: F32[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const x = white(n, seed + ch * 17);
      for (let i = 0; i < n; i++) x[i] = x[i] * (1 - metal) + cluster[i] * metal * 1.6;
      biquad(x, coefs('highpass', sr, hp, 0.7));
      biquad(x, coefs('highpass', sr, hp * 0.8, 0.7));
      biquad(x, coefs('lowpass', sr, lp, 0.6));
      for (let i = 0; i < n; i++) x[i] *= Math.exp(-i / sr / decay);
      fade(x, sr, attack, Math.min(0.05, len * 0.25));
      out.push(x);
    }
    normalize(out);
    return toBuffer(ctx, out);
  });
}

export interface ClapSpec {
  /** Time constant of the tail (s). */
  decay?: number;
  /** Centre of the band-pass (Hz). */
  f?: number;
  q?: number;
  len?: number;
  seed?: number;
}

export function clapBuf(ctx: Ctx, s: ClapSpec = {}): AudioBuffer {
  return cached(ctx, 'clap:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { decay = 0.075, f = 1250, q = 1.0, seed = 71 } = s;
    const len = s.len ?? decay * 6 + 0.06;
    const n = Math.ceil(len * sr);
    const shape = (x: F32): F32 => {
      biquad(x, coefs('bandpass', sr, f, q));
      biquad(x, coefs('highpass', sr, 600, 0.7));
      return x;
    };
    const common = shape(white(n, seed));
    const out: F32[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const side = shape(white(n, seed + 5 + ch));
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = 0;
        for (const start of [0, 0.011, 0.0215]) if (t >= start) e += 0.85 * Math.exp(-(t - start) / 0.0032);
        if (t >= 0.031) e += Math.exp(-(t - 0.031) / decay);
        x[i] = Math.tanh((0.7 * common[i] + 0.5 * side[i]) * e * 3);
      }
      fade(x, sr, 0.0006, Math.min(0.05, len * 0.25));
      out.push(x);
    }
    normalize(out);
    return toBuffer(ctx, out);
  });
}

export interface PercSpec {
  /** Pitch of the drum (Hz). */
  f?: number;
  /** Relative pitch drop on the attack (0.3 = starts 30 % sharp). */
  bend?: number;
  /** Time constant of the decay (s). */
  decay?: number;
  /** Level of the noisy slap transient. */
  slap?: number;
  len?: number;
  seed?: number;
}

/** Tuned hand drum / tom / rim-style hit: a sine body with a pitch drop plus a short slap. */
export function percBuf(ctx: Ctx, s: PercSpec = {}): AudioBuffer {
  return cached(ctx, 'perc:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { f = 260, bend = 0.25, decay = 0.07, slap = 0.25, seed = 91 } = s;
    const len = s.len ?? decay * 7 + 0.02;
    const n = Math.ceil(len * sr);
    const snap = biquad(white(n, seed), coefs('bandpass', sr, Math.min(9000, f * 6), 1.2));
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const phase = 2 * Math.PI * f * (t + bend * 0.015 * (1 - Math.exp(-t / 0.015)));
      x[i] = Math.sin(phase) * Math.exp(-t / decay) + 0.35 * Math.sin(phase * 1.59) * Math.exp(-t / (decay * 0.4)) + snap[i] * slap * 3 * Math.exp(-t / 0.006);
    }
    fade(x, sr, 0.0008, Math.min(0.03, len * 0.25));
    normalize([x]);
    return toBuffer(ctx, [x]);
  });
}

export interface ShakerSpec {
  /** Soft attack time (s). */
  attack?: number;
  /** Time constant of the decay (s). */
  decay?: number;
  f?: number;
  seed?: number;
}

export function shakerBuf(ctx: Ctx, s: ShakerSpec = {}): AudioBuffer {
  return cached(ctx, 'shaker:' + JSON.stringify(s), () => {
    const sr = ctx.sampleRate;
    const { attack = 0.014, decay = 0.028, f = 6200, seed = 111 } = s;
    const len = attack + decay * 7 + 0.01;
    const n = Math.ceil(len * sr);
    const out: F32[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const x = white(n, seed + ch * 3);
      biquad(x, coefs('bandpass', sr, f, 0.7));
      biquad(x, coefs('highpass', sr, 3200, 0.7));
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const rise = t < attack ? Math.pow(Math.sin((Math.PI * t) / (2 * attack)), 2) : 1;
        x[i] *= rise * Math.exp(-Math.max(0, t - attack) / decay);
      }
      fade(x, sr, 0.001, 0.01);
      out.push(x);
    }
    normalize(out);
    return toBuffer(ctx, out);
  });
}

/** Side-stick / rim click: two short woody resonances and a tick. */
export function rimBuf(ctx: Ctx, seed = 131): AudioBuffer {
  return cached(ctx, 'rim:' + seed, () => {
    const sr = ctx.sampleRate;
    const n = Math.ceil(0.12 * sr);
    const tick = biquad(white(n, seed), coefs('highpass', sr, 2800, 0.7));
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      x[i] =
        Math.sin(2 * Math.PI * 1720 * t) * Math.exp(-t / 0.009) +
        0.5 * Math.sin(2 * Math.PI * 430 * t) * Math.exp(-t / 0.02) +
        0.35 * Math.sin(2 * Math.PI * 2810 * t) * Math.exp(-t / 0.005) +
        tick[i] * 0.5 * Math.exp(-t / 0.002);
    }
    fade(x, sr, 0.0005, 0.02);
    normalize([x]);
    return toBuffer(ctx, [x]);
  });
}

// ---------------------------------------------------------------------------------------------
// Seamless beds
// ---------------------------------------------------------------------------------------------

/** Scale all channels together so that their overall RMS level is `target`. */
export function setRms(channels: F32[], target: number): F32[] {
  let sum = 0;
  let count = 0;
  for (const x of channels) {
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    count += x.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (rms > 0) {
    const k = target / rms;
    for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= k;
  }
  return channels;
}

/** Decorrelated stereo pair of seamless filtered noise, normalised to an RMS level. */
export function stereoNoise(n: number, seed: number, filters: readonly Coefs[], rms: number): F32[] {
  return setRms([loopNoise(n, seed, filters), loopNoise(n, seed + 7919, filters)], rms);
}

export interface CrackleSpec {
  /** Fine ticks per second. */
  ticks?: number;
  /** Larger, duller pops per second. */
  pops?: number;
  /** If set, one extra pop repeats with this period in seconds (a scratch passing once per revolution). */
  cycle?: number;
  /** Centre of the tick band (Hz). */
  tone?: number;
}

/**
 * Seamless stereo bed of random clicks and pops (vinyl crackle, rain drops…), peak-normalised to
 * 1.0. The impulses are filtered circularly, so clicks near the end ring on at the start.
 */
export function crackleBed(sr: number, n: number, seed: number, s: CrackleSpec = {}): F32[] {
  const { ticks = 14, pops = 0.8, cycle = 0, tone = 3400 } = s;
  const rnd = seededRandom(seed);
  const fine = [new Float32Array(n), new Float32Array(n)];
  const dull = [new Float32Array(n), new Float32Array(n)];
  const put = (target: F32[], pos: number, amp: number, pan: number): void => {
    target[0][pos % n] += amp * (0.35 + 0.65 * pan);
    target[1][pos % n] += amp * (0.35 + 0.65 * (1 - pan));
  };
  const seconds = n / sr;
  for (let i = 0; i < Math.round(ticks * seconds); i++) put(fine, Math.floor(rnd() * n), Math.pow(rnd(), 3) * (rnd() < 0.5 ? -1 : 1), rnd());
  for (let i = 0; i < Math.round(pops * seconds); i++) put(dull, Math.floor(rnd() * n), (0.5 + 0.5 * rnd()) * (rnd() < 0.5 ? -1 : 1), rnd());
  if (cycle > 0) for (let t = cycle * 0.37; t < seconds - 0.001; t += cycle) put(dull, Math.floor(t * sr), 0.8, 0.5);
  const out: F32[] = [];
  for (let ch = 0; ch < 2; ch++) {
    biquad(fine[ch], coefs('highpass', sr, tone * 0.45, 0.7), true);
    biquad(fine[ch], coefs('bandpass', sr, tone, 0.6), true);
    biquad(dull[ch], coefs('bandpass', sr, 420, 0.9), true);
    biquad(dull[ch], coefs('lowpass', sr, 1800, 0.7), true);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = fine[ch][i] + dull[ch][i] * 1.6;
    out.push(x);
  }
  normalize(out);
  return out;
}
