/**
 * Compressor maths (`AudioProps.compressor`), built on Web Audio's DynamicsCompressorNode.
 *
 * The node applies an automatic "make-up" gain of (1 / fullRangeGain)^0.6 (Web Audio spec,
 * DynamicsCompressor processing). Kinora cancels it with a gain stage so that the Make-up
 * control is the only make-up applied — quiet passages are not boosted behind the user's back.
 * `staticCurve` reproduces the node's knee curve for the transfer graph.
 */

import type { CompressorSettings } from '../types';

export const COMPRESSOR_LIMITS = {
  threshold: { min: -60, max: 0 },
  ratio: { min: 1, max: 20 },
  attack: { min: 0.0001, max: 0.2 },
  release: { min: 0.01, max: 1 },
  makeup: { min: 0, max: 24 },
} as const;

export const DEFAULT_COMPRESSOR: CompressorSettings = { enabled: true, threshold: -18, ratio: 3, attack: 0.008, release: 0.15, makeup: 3 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function sanitizeCompressor(c: Partial<CompressorSettings> | null | undefined): CompressorSettings {
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const L = COMPRESSOR_LIMITS;
  return {
    enabled: c?.enabled !== false,
    threshold: clamp(num(c?.threshold, DEFAULT_COMPRESSOR.threshold), L.threshold.min, L.threshold.max),
    ratio: clamp(num(c?.ratio, DEFAULT_COMPRESSOR.ratio), L.ratio.min, L.ratio.max),
    attack: clamp(num(c?.attack, DEFAULT_COMPRESSOR.attack), L.attack.min, L.attack.max),
    release: clamp(num(c?.release, DEFAULT_COMPRESSOR.release), L.release.min, L.release.max),
    makeup: clamp(num(c?.makeup, DEFAULT_COMPRESSOR.makeup), L.makeup.min, L.makeup.max),
  };
}

/** Soft knee (dB) used for a ratio: 6 dB for gentle ratios, hard knee for limiting. */
export function kneeFor(ratio: number): number {
  return 6 * clamp((12 - ratio) / 8, 0, 1);
}

export interface CompressorPreset {
  id: string;
  name: string;
  settings: CompressorSettings;
}

export const COMPRESSOR_PRESETS: CompressorPreset[] = [
  { id: 'voice', name: 'Voice', settings: { enabled: true, threshold: -20, ratio: 3, attack: 0.005, release: 0.12, makeup: 4 } },
  { id: 'music-glue', name: 'Music glue', settings: { enabled: true, threshold: -16, ratio: 2, attack: 0.03, release: 0.25, makeup: 2 } },
  { id: 'podcast', name: 'Podcast', settings: { enabled: true, threshold: -24, ratio: 4, attack: 0.003, release: 0.15, makeup: 7 } },
  { id: 'limiter', name: 'Limiter', settings: { enabled: true, threshold: -3, ratio: 20, attack: 0.001, release: 0.1, makeup: 0 } },
];

export function getCompressorPreset(id: string): CompressorPreset | undefined {
  return COMPRESSOR_PRESETS.find((p) => p.id === id);
}

const dbToLin = (db: number): number => Math.pow(10, db / 20);
const linToDb = (v: number): number => (v <= 0 ? -1000 : 20 * Math.log10(v));

/**
 * The node's static compression curve (Web Audio spec / Chromium DynamicsCompressorKernel):
 * linear below the threshold, an exponential knee up to threshold + knee, then a constant ratio.
 */
export class KneeCurve {
  readonly linearThreshold: number;
  readonly kneeThresholdDb: number;
  readonly kneeThreshold: number;
  readonly yKneeThresholdDb: number;
  readonly slope: number;
  readonly k: number;

  constructor(
    readonly thresholdDb: number,
    readonly kneeDb: number,
    readonly ratio: number,
  ) {
    this.linearThreshold = dbToLin(thresholdDb);
    this.slope = 1 / ratio;
    this.k = this.kAtSlope(1 / ratio);
    this.kneeThresholdDb = thresholdDb + kneeDb;
    this.kneeThreshold = dbToLin(this.kneeThresholdDb);
    this.yKneeThresholdDb = linToDb(this.knee(this.kneeThreshold, this.k));
  }

  private knee(x: number, k: number): number {
    if (x < this.linearThreshold) return x;
    return this.linearThreshold + (1 - Math.exp(-k * (x - this.linearThreshold))) / k;
  }

  private slopeAt(x: number, k: number): number {
    if (x < this.linearThreshold) return 1;
    const x2 = x * 1.001;
    const xDb = linToDb(x);
    const x2Db = linToDb(x2);
    const yDb = linToDb(this.knee(x, k));
    const y2Db = linToDb(this.knee(x2, k));
    return (y2Db - yDb) / (x2Db - xDb);
  }

  private kAtSlope(desired: number): number {
    const x = dbToLin(this.thresholdDb + this.kneeDb);
    let minK = 0.1;
    let maxK = 10000;
    let k = 5;
    for (let i = 0; i < 15; i++) {
      const s = this.slopeAt(x, k);
      if (s < desired) maxK = k;
      else minK = k;
      k = Math.sqrt(minK * maxK);
    }
    return k;
  }

  /** Output (linear) for a static input level (linear). */
  saturate(x: number): number {
    if (x < this.kneeThreshold) return this.knee(x, this.k);
    const yDb = this.yKneeThresholdDb + this.slope * (linToDb(x) - this.kneeThresholdDb);
    return dbToLin(yDb);
  }
}

/** Automatic make-up gain (dB) the node adds for these settings. */
export function nodeAutoMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const curve = new KneeCurve(thresholdDb, kneeDb, ratio);
  const fullRangeGain = curve.saturate(1);
  return 0.6 * -linToDb(fullRangeGain);
}

/** Gain (dB) of the stage after the node: user make-up minus the node's automatic make-up. */
export function makeupStageDb(s: CompressorSettings): number {
  return s.makeup - nodeAutoMakeupDb(s.threshold, kneeFor(s.ratio), s.ratio);
}

/** Static input → output level (dB) of the whole compressor, including the user make-up. */
export function staticCurveDb(s: CompressorSettings, inputDb: number): number {
  const curve = new KneeCurve(s.threshold, kneeFor(s.ratio), s.ratio);
  return linToDb(curve.saturate(dbToLin(inputDb))) + s.makeup;
}

export const isActiveCompressor = (c: CompressorSettings | undefined): boolean => !!c && c.enabled !== false;
