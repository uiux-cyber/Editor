/**
 * Parametric EQ maths (`AudioProps.eq`). The coefficients follow the Web Audio API
 * specification of BiquadFilterNode exactly (the RBJ cookbook, shelves with slope S = 1), so the
 * response drawn in the inspector is the response the preview and the export apply.
 *
 * `EqBand.q` is a conventional linear Q for every type. Web Audio interprets the Q of lowpass /
 * highpass filters in dB, so nodes get `20·log10(q)` for those (see `nodeQ`); shelves ignore Q.
 */

import type { EqBand } from '../types';

export type EqType = EqBand['type'];
export const EQ_TYPES: EqType[] = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass'];
export const EQ_TYPE_LABEL: Record<EqType, string> = {
  highpass: 'High-pass',
  lowshelf: 'Low shelf',
  peaking: 'Bell',
  highshelf: 'High shelf',
  lowpass: 'Low-pass',
};

export const EQ_MIN_FREQ = 20;
export const EQ_MAX_FREQ = 20000;
export const EQ_MAX_GAIN = 18;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 18;
export const EQ_MAX_BANDS = 8;

export const typeHasGain = (t: EqType): boolean => t === 'peaking' || t === 'lowshelf' || t === 'highshelf';
export const typeHasQ = (t: EqType): boolean => t === 'peaking' || t === 'highpass' || t === 'lowpass';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function sanitizeBand(b: Partial<EqBand> | null | undefined): EqBand {
  const type: EqType = EQ_TYPES.includes(b?.type as EqType) ? (b!.type as EqType) : 'peaking';
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    type,
    frequency: clamp(num(b?.frequency, 1000), EQ_MIN_FREQ, EQ_MAX_FREQ),
    gain: clamp(num(b?.gain, 0), -EQ_MAX_GAIN, EQ_MAX_GAIN),
    q: clamp(num(b?.q, type === 'peaking' ? 1 : Math.SQRT1_2), EQ_MIN_Q, EQ_MAX_Q),
  };
}

export function sanitizeEq(eq: unknown): EqBand[] {
  if (!Array.isArray(eq)) return [];
  return eq.slice(0, EQ_MAX_BANDS).map((b) => sanitizeBand(b as Partial<EqBand>));
}

/** A band that changes nothing (bell / shelf at 0 dB). Pass filters always act. */
export const isNeutralBand = (b: EqBand): boolean => typeHasGain(b.type) && Math.abs(b.gain) < 0.01;

export const isNeutralEq = (eq: EqBand[] | undefined): boolean => !eq || sanitizeEq(eq).every(isNeutralBand);

/** Q value to set on a BiquadFilterNode for this band. */
export function nodeQ(b: EqBand): number {
  if (b.type === 'highpass' || b.type === 'lowpass') return 20 * Math.log10(b.q);
  return b.q;
}

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/** Biquad coefficients exactly as specified for BiquadFilterNode. */
export function biquadCoefficients(band: EqBand, sampleRate: number): Biquad {
  const b = sanitizeBand(band);
  const nyquist = sampleRate / 2;
  const f0 = Math.min(b.frequency, nyquist * 0.9999);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const A = Math.pow(10, b.gain / 40);
  const alphaQ = sw / (2 * b.q);
  // Shelf slope S = 1: alpha = sin(w0)/2 · sqrt((A + 1/A)(1/S − 1) + 2)
  const alphaS = (sw / 2) * Math.SQRT2;
  const sA = Math.sqrt(A);
  switch (b.type) {
    case 'lowpass':
      return { b0: (1 - cw) / 2, b1: 1 - cw, b2: (1 - cw) / 2, a0: 1 + alphaQ, a1: -2 * cw, a2: 1 - alphaQ };
    case 'highpass':
      return { b0: (1 + cw) / 2, b1: -(1 + cw), b2: (1 + cw) / 2, a0: 1 + alphaQ, a1: -2 * cw, a2: 1 - alphaQ };
    case 'peaking':
      return { b0: 1 + alphaQ * A, b1: -2 * cw, b2: 1 - alphaQ * A, a0: 1 + alphaQ / A, a1: -2 * cw, a2: 1 - alphaQ / A };
    case 'lowshelf':
      return {
        b0: A * (A + 1 - (A - 1) * cw + 2 * alphaS * sA),
        b1: 2 * A * (A - 1 - (A + 1) * cw),
        b2: A * (A + 1 - (A - 1) * cw - 2 * alphaS * sA),
        a0: A + 1 + (A - 1) * cw + 2 * alphaS * sA,
        a1: -2 * (A - 1 + (A + 1) * cw),
        a2: A + 1 + (A - 1) * cw - 2 * alphaS * sA,
      };
    case 'highshelf':
    default:
      return {
        b0: A * (A + 1 + (A - 1) * cw + 2 * alphaS * sA),
        b1: -2 * A * (A - 1 + (A + 1) * cw),
        b2: A * (A + 1 + (A - 1) * cw - 2 * alphaS * sA),
        a0: A + 1 - (A - 1) * cw + 2 * alphaS * sA,
        a1: 2 * (A - 1 - (A + 1) * cw),
        a2: A + 1 - (A - 1) * cw - 2 * alphaS * sA,
      };
  }
}

/** Magnitude response (dB) of one biquad at `freq` Hz. */
export function biquadResponseDb(c: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (a0 + a1 e^-jw + a2 e^-2jw)
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = c.a0 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const mag2 = (nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di);
  return 10 * Math.log10(Math.max(1e-30, mag2));
}

export function bandResponseDb(band: EqBand, freq: number, sampleRate = 48000): number {
  return biquadResponseDb(biquadCoefficients(band, sampleRate), freq, sampleRate);
}

/** Combined response (dB) of all bands at each frequency. */
export function eqResponseDb(bands: EqBand[], freqs: ArrayLike<number>, sampleRate = 48000): Float64Array {
  const out = new Float64Array(freqs.length);
  for (const band of bands) {
    const c = biquadCoefficients(band, sampleRate);
    for (let i = 0; i < freqs.length; i++) out[i] += biquadResponseDb(c, freqs[i], sampleRate);
  }
  return out;
}

/** `n` log-spaced frequencies from EQ_MIN_FREQ to EQ_MAX_FREQ. */
export function logFrequencies(n: number, lo = EQ_MIN_FREQ, hi = EQ_MAX_FREQ): Float64Array {
  const out = new Float64Array(n);
  const a = Math.log(lo);
  const b = Math.log(hi);
  for (let i = 0; i < n; i++) out[i] = Math.exp(a + ((b - a) * i) / Math.max(1, n - 1));
  return out;
}

export interface EqPreset {
  id: string;
  name: string;
  bands: EqBand[];
}

export const EQ_PRESETS: EqPreset[] = [
  {
    id: 'voice-clarity',
    name: 'Voice clarity',
    bands: [
      { type: 'highpass', frequency: 85, gain: 0, q: 0.707 },
      { type: 'peaking', frequency: 260, gain: -3, q: 1.1 },
      { type: 'peaking', frequency: 3200, gain: 3.5, q: 0.9 },
      { type: 'highshelf', frequency: 9000, gain: 2, q: 0.707 },
    ],
  },
  {
    id: 'bass-boost',
    name: 'Bass boost',
    bands: [
      { type: 'lowshelf', frequency: 110, gain: 6, q: 0.707 },
      { type: 'peaking', frequency: 320, gain: -1.5, q: 1.2 },
    ],
  },
  {
    id: 'de-mud',
    name: 'De-mud',
    bands: [
      { type: 'peaking', frequency: 300, gain: -4.5, q: 1.1 },
      { type: 'peaking', frequency: 550, gain: -1.5, q: 1.6 },
    ],
  },
  {
    id: 'telephone',
    name: 'Telephone',
    bands: [
      { type: 'highpass', frequency: 450, gain: 0, q: 0.9 },
      { type: 'peaking', frequency: 1600, gain: 5, q: 0.8 },
      { type: 'lowpass', frequency: 3200, gain: 0, q: 0.9 },
    ],
  },
  {
    id: 'rumble-cut',
    name: 'Rumble cut',
    // Two cascaded sections = a 4th-order Butterworth high-pass (24 dB / octave).
    bands: [
      { type: 'highpass', frequency: 75, gain: 0, q: 0.5412 },
      { type: 'highpass', frequency: 75, gain: 0, q: 1.3066 },
    ],
  },
  {
    id: 'bright',
    name: 'Bright',
    bands: [
      { type: 'highshelf', frequency: 5500, gain: 4, q: 0.707 },
      { type: 'peaking', frequency: 12000, gain: 1.5, q: 0.8 },
    ],
  },
];

export function getEqPreset(id: string): EqPreset | undefined {
  return EQ_PRESETS.find((p) => p.id === id);
}

/** A sensible new band for a frequency the user clicked. */
export function defaultBandAt(freq: number, gain = 0): EqBand {
  const f = clamp(freq, EQ_MIN_FREQ, EQ_MAX_FREQ);
  return { type: 'peaking', frequency: Math.round(f), gain: Math.round(gain * 10) / 10, q: 1 };
}

export function formatFrequency(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '')} kHz`;
  return `${Math.round(f)} Hz`;
}
