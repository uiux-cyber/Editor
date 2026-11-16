import { seededRandom } from '@/core/easing';
import type { SoundDef } from '../types';
import { coefs, crackleBed, normalize, stereoNoise, toBuffer, type F32 } from './lib/dsp';
import { CEILING, deterministic, softClip, vca } from './lib/synth';

type Mod = (x: number) => number;
type Layer = (channels: F32[], gain: number, mod?: Mod) => void;

const CURVE_POINTS = 513;

/** Gain curve of a layer: `mod` sampled over one loop, starting at loop position `phase` (0..1). */
function modCurve(gain: number, mod: Mod | undefined, phase: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) curve[i] = gain * (mod ? Math.max(0, mod((i / (CURVE_POINTS - 1) + phase) % 1)) : 1);
  return curve;
}

/**
 * Offset (in samples) of the quietest millisecond of the summed layers, so that the loop can start
 * there instead of on a loud grain of noise or a crackle.
 */
function quietestStart(layers: readonly { channels: F32[]; gain: number; mod?: Mod }[], n: number, sr: number): number {
  const sum = new Float32Array(n * 2);
  for (const l of layers) {
    const curve = modCurve(l.gain, l.mod, 0);
    for (let ch = 0; ch < 2; ch++) {
      const x = l.channels[Math.min(ch, l.channels.length - 1)];
      for (let i = 0; i < n; i++) {
        const pos = (i / n) * (CURVE_POINTS - 1);
        const k = Math.min(CURVE_POINTS - 2, Math.floor(pos));
        const g = curve[k] + (curve[k + 1] - curve[k]) * (pos - k);
        sum[i * 2 + ch] += x[i] * g;
      }
    }
  }
  const block = 16;
  const blocks = Math.floor(n / block);
  const peaks = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let m = 0;
    for (let i = b * block * 2; i < (b + 1) * block * 2; i++) m = Math.max(m, Math.abs(sum[i]));
    peaks[b] = m;
  }
  const span = Math.ceil((0.001 * sr) / block);
  let best = 0;
  let bestPeak = Infinity;
  for (let b = 0; b < blocks; b++) {
    let m = 0;
    for (let j = 0; j < span; j++) m = Math.max(m, peaks[(b + j) % blocks]);
    if (m < bestPeak) {
      bestPeak = m;
      best = b;
    }
  }
  return best * block;
}

/**
 * Ambiences are seamless loops. Every noise layer is one loop-length buffer that was filtered
 * circularly, and all movement comes from gain curves that are periodic over the loop, so the
 * signal path stays memoryless and the end joins the start without a seam or a fade. Because every
 * layer is periodic, the whole bed can also be rotated: it starts at its quietest millisecond, so
 * the first samples of the clip are never a loud grain.
 */
function amb(id: string, name: string, duration: number, keywords: string[], level: number, build: (n: number, sr: number, layer: Layer) => void): SoundDef {
  return {
    id,
    name,
    category: 'ambience',
    duration,
    loop: true,
    keywords,
    render: (ctx, dest) =>
      deterministic(ctx, () => {
        const sr = ctx.sampleRate;
        const n = Math.round(duration * sr);
        const layers: { channels: F32[]; gain: number; mod?: Mod }[] = [];
        build(n, sr, (channels, gain, mod) => layers.push({ channels, gain, mod }));
        const offset = quietestStart(layers, n, sr);
        const clip = softClip(ctx, level);
        clip.output.connect(vca(ctx, CEILING)).connect(dest);
        for (const l of layers) {
          const rotated = l.channels.map((x) => {
            const y = new Float32Array(n);
            y.set(x.subarray(offset));
            y.set(x.subarray(0, offset), n - offset);
            return y;
          });
          const src = ctx.createBufferSource();
          src.buffer = toBuffer(ctx, rotated);
          const g = vca(ctx, l.gain);
          if (l.mod) g.gain.setValueCurveAtTime(modCurve(l.gain, l.mod, offset / n), 0, duration);
          src.connect(g).connect(clip.input);
          src.start(0);
          src.stop(duration);
        }
      }),
  };
}

/** Sum of sines with a whole number of cycles per loop (mains hum and the like). */
function hum(n: number, sr: number, partials: readonly (readonly [freq: number, level: number])[]): F32[] {
  const x = new Float32Array(n);
  for (const [f, level] of partials) for (let i = 0; i < n; i++) x[i] += level * Math.sin((2 * Math.PI * f * i) / sr);
  return [x, x];
}

const TAU = 2 * Math.PI;

/** Periodic bump centred on `c` (0..1) with separate rise and fall widths. */
function swell(x: number, c: number, rise: number, fall: number): number {
  const u = ((((x - c + 0.5) % 1) + 1) % 1) - 0.5;
  const w = u < 0 ? rise : fall;
  return Math.exp(-(u * u) / (w * w));
}

const sounds: SoundDef[] = [
  amb('ambience-room-tone', 'Room Tone', 10, ['ambience', 'room tone', 'background', 'quiet', 'indoor', 'air', 'hum'], 1.16, (n, sr, layer) => {
    layer(stereoNoise(n, 901, [coefs('lowpass', sr, 140, 0.7), coefs('lowpass', sr, 240, 0.7)], 0.1), 1, (x) => 1 + 0.08 * Math.sin(TAU * x));
    layer(stereoNoise(n, 903, [coefs('bandpass', sr, 700, 0.35), coefs('lowpass', sr, 2600, 0.6)], 0.035), 1, (x) => 1 + 0.1 * Math.sin(TAU * 2 * x + 1));
    layer(stereoNoise(n, 905, [coefs('highpass', sr, 3500, 0.7), coefs('lowpass', sr, 9000, 0.6)], 0.008), 1);
    // Faint mains / ventilation hum; whole numbers of cycles fit the loop.
    layer(hum(n, sr, [[60, 0.012], [120, 0.007], [180, 0.003]]), 1);
  }),

  amb('ambience-soft-wind', 'Soft Wind', 12, ['ambience', 'wind', 'breeze', 'outdoor', 'nature', 'air', 'gust'], 1.26, (n, sr, layer) => {
    layer(stereoNoise(n, 911, [coefs('bandpass', sr, 300, 0.7), coefs('lowpass', sr, 800, 0.7)], 0.09), 1, (x) => 0.6 + 0.25 * Math.sin(TAU * x - 0.6) + 0.12 * Math.sin(TAU * 3 * x + 1.1));
    layer(stereoNoise(n, 913, [coefs('bandpass', sr, 750, 0.9), coefs('lowpass', sr, 2400, 0.7)], 0.07), 1, (x) => Math.max(0.05, 0.45 + 0.4 * Math.sin(TAU * x - 0.2) + 0.2 * Math.sin(TAU * 2 * x + 2) + 0.1 * Math.sin(TAU * 5 * x)));
    layer(stereoNoise(n, 915, [coefs('bandpass', sr, 1700, 0.8), coefs('lowpass', sr, 4500, 0.7)], 0.04), 1, (x) => Math.pow(Math.max(0.03, 0.3 + 0.45 * Math.sin(TAU * x + 0.1) + 0.25 * Math.sin(TAU * 2 * x + 2.4)), 1.5));
    // A thin whistling band that only appears in the gusts.
    layer(stereoNoise(n, 917, [coefs('bandpass', sr, 1250, 9), coefs('bandpass', sr, 1250, 4)], 0.012), 1, (x) => Math.pow(Math.max(0, Math.sin(TAU * x + 0.3)), 3) * (0.6 + 0.4 * Math.sin(TAU * 7 * x)));
  }),

  amb('ambience-vinyl-crackle', 'Vinyl Crackle', 9, ['ambience', 'vinyl', 'crackle', 'record', 'lofi', 'dust', 'noise'], 1.05, (n, sr, layer) => {
    // 9 s = five revolutions at 33⅓ rpm, so the once-per-turn pop and the rumble cycle loop cleanly.
    layer(crackleBed(sr, n, 921, { ticks: 16, pops: 0.9, cycle: 1.8 }), 0.5);
    layer(stereoNoise(n, 923, [coefs('highpass', sr, 2200, 0.7), coefs('lowpass', sr, 8500, 0.6)], 0.012), 1);
    layer(stereoNoise(n, 925, [coefs('lowpass', sr, 70, 0.7), coefs('highpass', sr, 22, 0.7)], 0.03), 1, (x) => 1 + 0.3 * Math.sin(TAU * 5 * x));
  }),

  amb('ambience-rain', 'Rain', 10, ['ambience', 'rain', 'weather', 'nature', 'storm', 'water', 'calm'], 1.41, (n, sr, layer) => {
    layer(stereoNoise(n, 931, [coefs('highpass', sr, 500, 0.7), coefs('bandpass', sr, 2400, 0.3), coefs('lowpass', sr, 9000, 0.6)], 0.085), 1, (x) => 1 + 0.08 * Math.sin(TAU * x) + 0.05 * Math.sin(TAU * 3 * x + 1));
    layer(stereoNoise(n, 933, [coefs('bandpass', sr, 300, 0.6), coefs('lowpass', sr, 700, 0.7)], 0.03), 1);
    // Individual drops: a dense patter of small ticks plus sparser, rounder "plips".
    layer(crackleBed(sr, n, 935, { ticks: 90, pops: 0, tone: 4200 }), 0.22);
    layer(crackleBed(sr, n, 937, { ticks: 7, pops: 0, tone: 1500 }), 0.2);
  }),

  amb('ambience-ocean-swell', 'Ocean Swell', 12, ['ambience', 'ocean', 'waves', 'sea', 'beach', 'surf', 'water'], 1.0, (n, sr, layer) => {
    // Two waves per loop, the second a little smaller; foam hisses in just after each crest.
    const wave = (x: number): number => swell(x, 0.27, 0.12, 0.2) + 0.75 * swell(x, 0.77, 0.1, 0.17);
    const foam = (x: number): number => swell(x, 0.31, 0.05, 0.22) + 0.75 * swell(x, 0.8, 0.045, 0.2);
    layer(stereoNoise(n, 941, [coefs('lowpass', sr, 220, 0.7), coefs('lowpass', sr, 400, 0.7)], 0.1), 1, (x) => 0.35 + 0.65 * wave(x));
    layer(stereoNoise(n, 943, [coefs('bandpass', sr, 650, 0.5), coefs('lowpass', sr, 2200, 0.7)], 0.09), 1, (x) => 0.12 + 0.88 * wave(x));
    layer(stereoNoise(n, 945, [coefs('highpass', sr, 2200, 0.7), coefs('lowpass', sr, 7500, 0.6)], 0.05), 1, (x) => 0.05 + 0.95 * foam(x));
  }),

  amb('ambience-night-crickets', 'Night Crickets', 10, ['ambience', 'night', 'crickets', 'insects', 'summer', 'outdoor', 'evening'], 2.58, (n, sr, layer) => {
    layer(stereoNoise(n, 951, [coefs('bandpass', sr, 500, 0.4), coefs('lowpass', sr, 1500, 0.7)], 0.02), 1);
    layer(stereoNoise(n, 953, [coefs('highpass', sr, 5000, 0.7), coefs('lowpass', sr, 9000, 0.6)], 0.004), 1);
    // Each cricket repeats a chirp of a few short pulses; the periods divide the loop exactly.
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    const rnd = seededRandom(959);
    const crickets = [
      { f: 4400, period: 0.5, offset: 0.06, pan: 0.25, level: 1, pulses: 3 },
      { f: 4050, period: 0.625, offset: 0.27, pan: 0.72, level: 0.8, pulses: 4 },
      { f: 4700, period: 0.4, offset: 0.15, pan: 0.5, level: 0.28, pulses: 3 },
    ];
    for (const c of crickets) {
      for (let start = c.offset; start < 10 - 0.2; start += c.period) {
        const loud = c.level * (0.75 + 0.25 * rnd());
        for (let p = 0; p < c.pulses; p++) {
          const first = Math.floor((start + p * 0.026) * sr);
          const len = Math.floor(0.015 * sr);
          for (let i = 0; i < len; i++) {
            const t = i / sr;
            const v = Math.pow(Math.sin((Math.PI * i) / len), 2) * (Math.sin(TAU * c.f * t) + 0.2 * Math.sin(TAU * 2 * c.f * t)) * loud;
            left[first + i] += v * (1 - c.pan);
            right[first + i] += v * c.pan;
          }
        }
      }
    }
    const chirps = [left, right];
    normalize(chirps);
    layer(chirps, 0.16);
  }),
];

export default sounds;
