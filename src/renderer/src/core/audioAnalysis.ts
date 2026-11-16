/**
 * Audio analysis on plain sample arrays: silence detection, voice activity, onset / tempo /
 * beat tracking and spectral-gating noise reduction. Pure functions (no Web Audio, no DOM) so
 * they run in a worker, in the renderer and in unit tests alike.
 */

import type { TimeRange } from './speech';

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-9, g));

/** RMS level in dBFS of consecutive frames (`hop` samples apart, `win` samples long). */
export function frameLevels(samples: Float32Array, win: number, hop: number): Float32Array {
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const out = new Float32Array(Math.max(n, samples.length > 0 ? 1 : 0));
  if (n === 0) {
    let s = 0;
    for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
    if (out.length) out[0] = gainToDb(Math.sqrt(s / Math.max(1, samples.length)));
    return out;
  }
  // Running sum of squares for O(n) framing.
  let acc = 0;
  for (let i = 0; i < win; i++) acc += samples[i] * samples[i];
  out[0] = gainToDb(Math.sqrt(acc / win));
  for (let f = 1; f < n; f++) {
    const a = (f - 1) * hop;
    for (let i = a; i < a + hop; i++) acc -= samples[i] * samples[i];
    for (let i = a + win; i < a + win + hop; i++) acc += samples[i] * samples[i];
    out[f] = gainToDb(Math.sqrt(Math.max(0, acc) / win));
  }
  return out;
}

/** Mix channels down to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return -120;
  return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
}

// ---------------------------------------------------------------------------------------------
// Silence
// ---------------------------------------------------------------------------------------------

export interface SilenceOptions {
  /** Frames quieter than this (dBFS) count as silent. */
  thresholdDb: number;
  /** Seconds; shorter pauses are kept. */
  minDuration: number;
  /** Seconds of silence kept next to the sound on each side. */
  padding: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { thresholdDb: -40, minDuration: 0.6, padding: 0.12 };

/** Silent stretches of a signal (seconds from its start), already shrunk by the padding. */
export function detectSilences(samples: Float32Array, sampleRate: number, options: Partial<SilenceOptions> = {}): TimeRange[] {
  const o = { ...DEFAULT_SILENCE, ...options };
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const win = hop * 2;
  const levels = frameLevels(samples, win, hop);
  const total = samples.length / sampleRate;
  const silent = Array.from(levels, (db) => db < o.thresholdDb);
  // Ignore clicks: a loud blip shorter than 40 ms inside silence does not break it.
  const blip = Math.round(0.04 / 0.01);
  for (let i = 0; i < silent.length; ) {
    if (silent[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < silent.length && !silent[j]) j++;
    if (j - i <= blip && i > 0 && j < silent.length) for (let k = i; k < j; k++) silent[k] = true;
    i = j;
  }
  const out: TimeRange[] = [];
  for (let i = 0; i < silent.length; ) {
    if (!silent[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < silent.length && silent[j]) j++;
    // Frame f covers [f*hop, f*hop + win): silence runs from the centre of the first frame.
    const s = i === 0 ? 0 : (i * hop + win / 2) / sampleRate;
    const e = j >= silent.length ? total : (j * hop + win / 2) / sampleRate;
    if (e - s >= o.minDuration) {
      const a = s <= 1e-6 ? 0 : s + o.padding;
      const b = e >= total - 1e-6 ? total : e - o.padding;
      if (b - a > 0.05) out.push({ start: a, end: b });
    }
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Voice activity
// ---------------------------------------------------------------------------------------------

export interface SpeechOptions {
  /** dB above the noise floor that counts as speech. */
  sensitivityDb: number;
  /** Seconds a detection is held after the level drops. */
  hangover: number;
  /** Seconds; shorter bursts are ignored. */
  minSpeech: number;
}

/** Second-order IIR band-pass (RBJ cookbook), applied in place to a copy. */
export function bandpass(samples: Float32Array, sampleRate: number, low: number, high: number): Float32Array {
  const out = new Float32Array(samples.length);
  const f0 = Math.sqrt(low * high);
  const q = f0 / Math.max(1, high - low);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Ranges (seconds) where someone is speaking, from an energy detector on the voice band. */
export function detectSpeech(samples: Float32Array, sampleRate: number, options: Partial<SpeechOptions> = {}): TimeRange[] {
  const o: SpeechOptions = { sensitivityDb: 10, hangover: 0.25, minSpeech: 0.12, ...options };
  const voice = bandpass(samples, sampleRate, 250, 3800);
  const hop = Math.max(1, Math.round(sampleRate * 0.02));
  const levels = frameLevels(voice, hop * 2, hop);
  const floor = percentile(levels, 0.1);
  const threshold = Math.max(floor + o.sensitivityDb, -55);
  const frameSec = hop / sampleRate;
  const hold = Math.round(o.hangover / frameSec);
  const raw: TimeRange[] = [];
  let startF = -1;
  let lastLoud = -1;
  for (let f = 0; f < levels.length; f++) {
    if (levels[f] >= threshold) {
      if (startF < 0) startF = f;
      lastLoud = f;
    } else if (startF >= 0 && f - lastLoud > hold) {
      raw.push({ start: startF * frameSec, end: (lastLoud + 2) * frameSec });
      startF = -1;
    }
  }
  if (startF >= 0) raw.push({ start: startF * frameSec, end: Math.min(samples.length / sampleRate, (lastLoud + 2) * frameSec) });
  return raw.filter((r) => r.end - r.start >= o.minSpeech);
}

// ---------------------------------------------------------------------------------------------
// FFT / STFT
// ---------------------------------------------------------------------------------------------

const fftTables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tables(n: number): { cos: Float64Array; sin: Float64Array; rev: Uint32Array } {
  let t = fftTables.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  fftTables.set(n, t);
  return t;
}

/** In-place iterative radix-2 FFT (`inverse` scales by 1/n). `n` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = inverse ? -sin[k * step] : sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export const hann = (n: number): Float64Array => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
};

/** Magnitude spectra of overlapping windows: frames × (n/2 + 1). */
export function stftMagnitudes(samples: Float32Array, n: number, hop: number): { mags: Float32Array[]; frames: number } {
  const w = hann(n);
  const frames = Math.max(1, Math.floor((samples.length - n) / hop) + 1);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mags: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < n; i++) {
      re[i] = (samples[off + i] ?? 0) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    const m = new Float32Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) m[k] = Math.hypot(re[k], im[k]);
    mags.push(m);
  }
  return { mags, frames };
}

// ---------------------------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------------------------

export interface BeatOptions {
  minBpm: number;
  maxBpm: number;
  /** Beats per bar used for downbeats. */
  beatsPerBar: number;
}

export interface BeatResult {
  bpm: number;
  /** Beat times in seconds. */
  beats: number[];
  /** Subset of `beats` that start a bar. */
  downbeats: number[];
  /** 0..1, how periodic the onsets are. */
  confidence: number;
}

/** Onset strength envelope (spectral flux) plus a bass-band version for downbeats. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, n = 1024, hop = 256): { env: Float32Array; low: Float32Array; frameRate: number } {
  const { mags, frames } = stftMagnitudes(samples, n, hop);
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const bassBins = Math.max(2, Math.round((180 * n) / sampleRate));
  let prev: Float32Array = new Float32Array(n / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const m = mags[f];
    let flux = 0;
    let lowFlux = 0;
    for (let k = 1; k <= n / 2; k++) {
      const v = Math.log1p(1000 * m[k]);
      const d = v - prev[k];
      if (d > 0) {
        flux += d;
        if (k <= bassBins) lowFlux += d;
      }
      m[k] = v;
    }
    env[f] = flux;
    low[f] = lowFlux;
    prev = m;
  }
  // Remove the slowly varying part and normalise.
  const norm = (x: Float32Array): void => {
    const w = 16;
    const out = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i];
      if (i >= w) acc -= x[i - w];
      const mean = acc / Math.min(i + 1, w);
      out[i] = Math.max(0, x[i] - mean);
    }
    let max = 0;
    for (const v of out) max = Math.max(max, v);
    for (let i = 0; i < x.length; i++) x[i] = max > 0 ? out[i] / max : 0;
  };
  norm(env);
  norm(low);
  return { env, low, frameRate: sampleRate / hop };
}

/** Tempo, beat times and downbeats (dynamic-programming beat tracker after Ellis, 2007). */
export function detectBeats(samples: Float32Array, sampleRate: number, options: Partial<BeatOptions> = {}): BeatResult {
  const o: BeatOptions = { minBpm: 60, maxBpm: 200, beatsPerBar: 4, ...options };
  const { env, low, frameRate } = onsetEnvelope(samples, sampleRate);
  const n = env.length;
  if (n < 8) return { bpm: 0, beats: [], downbeats: [], confidence: 0 };

  // 1. Tempo from the autocorrelation of the onset envelope with a prior around 120 BPM.
  const minLag = Math.max(1, Math.floor((60 / o.maxBpm) * frameRate));
  const maxLag = Math.min(n - 1, Math.ceil((60 / o.minBpm) * frameRate));
  const ac = new Float64Array(maxLag + 2);
  let zero = 0;
  for (let i = 0; i < n; i++) zero += env[i] * env[i];
  for (let lag = minLag; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (n - lag);
  }
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    // Reward lags whose double is also periodic (resolves half / double tempo ambiguity).
    const harmonic = 2 * lag <= maxLag + 1 ? 0.5 * ac[2 * lag] : 0;
    const score = (ac[lag] + harmonic) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Parabolic interpolation for sub-frame precision.
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1];
    const b = ac[bestLag];
    const c = ac[bestLag + 1];
    const d = a - 2 * b + c;
    if (d < 0) period = bestLag + (0.5 * (a - c)) / d;
  }
  const bpm = (60 * frameRate) / period;
  const confidence = zero > 0 ? Math.min(1, (ac[bestLag] * n) / zero / 0.5) : 0;

  // 2. Beat positions: maximise onset strength while keeping the spacing close to the period.
  const alpha = 400;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    const lo = Math.max(0, Math.floor(t - 2 * period));
    const hi = Math.floor(t - period / 2);
    for (let p = lo; p <= hi; p++) {
      const r = Math.log((t - p) / period);
      const s = score[p] - alpha * r * r;
      if (arg < 0 || s > best) {
        best = s;
        arg = p;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Start from the best-scoring frame within the last period.
  let end = n - 1;
  let endScore = -Infinity;
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++) {
    if (score[t] > endScore) {
      endScore = score[t];
      end = t;
    }
  }
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    frames.push(t);
    if (back[t] < 0) break;
  }
  frames.reverse();
  // Extend the grid back to the start of the music if the tracker began late.
  while (frames.length && frames[0] - period > period * 0.25) {
    const guess = Math.round(frames[0] - period);
    let bestF = guess;
    for (let d = -2; d <= 2; d++) if (guess + d >= 0 && env[guess + d] > env[bestF]) bestF = guess + d;
    if (env[bestF] < 0.05) break;
    frames.unshift(bestF);
  }
  const hopSec = 1 / frameRate;
  // With log compression the flux peaks as an onset enters the analysis window, i.e. when it
  // sits near the window's right edge (window = 1024 samples, see onsetEnvelope).
  const offset = (0.8 * 1024) / sampleRate;
  const beats = frames.map((f) => Math.max(0, f * hopSec + offset));

  // 3. Downbeats: the bar phase whose beats carry the most bass onset energy.
  const bar = Math.max(1, Math.round(o.beatsPerBar));
  let phase = 0;
  let phaseScore = -Infinity;
  for (let ph = 0; ph < bar; ph++) {
    let s = 0;
    for (let i = ph; i < frames.length; i += bar) s += low[frames[i]] * 2 + env[frames[i]];
    const count = Math.ceil((frames.length - ph) / bar);
    s /= Math.max(1, count);
    if (s > phaseScore) {
      phaseScore = s;
      phase = ph;
    }
  }
  const downbeats = beats.filter((_, i) => i >= phase && (i - phase) % bar === 0);
  return { bpm: Math.round(bpm * 10) / 10, beats, downbeats, confidence };
}

// ---------------------------------------------------------------------------------------------
// Noise reduction (spectral gating)
// ---------------------------------------------------------------------------------------------

export interface DenoiseOptions {
  /** 0..1 — how much of the noise is removed (maps to up to 30 dB of attenuation). */
  strength: number;
  /** Over-subtraction factor, 1..4: higher removes more noise but can thin out quiet speech. */
  sensitivity: number;
}

export const DEFAULT_DENOISE: DenoiseOptions = { strength: 0.7, sensitivity: 2 };

export interface NoiseProfile {
  /** Mean power per FFT bin in the quietest frames. */
  power: Float32Array;
  n: number;
}

const DN_N = 2048;
const DN_HOP = 512;

/** Learn the noise spectrum from the quietest 10 % of the signal. */
export function learnNoiseProfile(samples: Float32Array): NoiseProfile {
  const n = DN_N;
  const hop = DN_HOP;
  const frames = Math.max(1, Math.floor((samples.length - n) / hop) + 1);
  const energy: { f: number; e: number }[] = [];
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const off = f * hop;
    for (let i = 0; i < n; i++) {
      const v = samples[off + i] ?? 0;
      e += v * v;
    }
    energy.push({ f, e });
  }
  energy.sort((a, b) => a.e - b.e);
  // Skip digital silence (exact zeros) — it says nothing about the noise.
  const usable = energy.filter((x) => x.e > 1e-12);
  const pool = usable.length ? usable : energy;
  const take = pool.slice(0, Math.min(pool.length, Math.max(16, Math.ceil(pool.length * 0.12))));
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const bins = n / 2 + 1;
  const sum = new Float64Array(bins);
  for (const { f } of take) {
    const off = f * hop;
    for (let i = 0; i < n; i++) {
      re[i] = (samples[off + i] ?? 0) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) sum[k] += re[k] * re[k] + im[k] * im[k];
  }
  // Average across neighbouring bins too: a few frames alone give a very noisy estimate.
  const power = new Float32Array(bins);
  const R = 4;
  for (let k = 0; k < bins; k++) {
    let s = 0;
    let c = 0;
    for (let d = -R; d <= R; d++) {
      const kk = k + d;
      if (kk < 0 || kk >= bins) continue;
      s += sum[kk];
      c++;
    }
    power[k] = s / c / take.length;
  }
  return { power, n };
}

/**
 * Spectral gating by smoothed power subtraction: each time-frequency cell is compared with the
 * learned noise power (averaged over its 3 × 3 neighbourhood, which keeps random noise peaks from
 * slipping through), attenuated towards a floor set by `strength`, and the gains are smoothed
 * over time to avoid "musical noise". Output length equals the input length.
 */
export function spectralGate(samples: Float32Array, profile: NoiseProfile, options: Partial<DenoiseOptions> = {}, onProgress?: (r: number) => void): Float32Array {
  const o = { ...DEFAULT_DENOISE, ...options };
  const n = profile.n;
  const hop = DN_HOP;
  const bins = n / 2 + 1;
  const floorGain = dbToGain(-30 * Math.min(1, Math.max(0, o.strength)));
  const alpha = Math.min(4, Math.max(0.5, o.sensitivity));
  const w = hann(n);
  // Pad so the first / last samples get full overlap-add coverage.
  const padded = new Float32Array(samples.length + 2 * n);
  padded.set(samples, n);
  const frames = Math.floor((padded.length - n) / hop) + 1;

  const specRe: Float32Array[] = [];
  const specIm: Float32Array[] = [];
  const pow: Float32Array[] = [];
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < n; i++) {
      re[i] = padded[off + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    const r = new Float32Array(bins);
    const ii = new Float32Array(bins);
    const pw = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      r[k] = re[k];
      ii[k] = im[k];
      pw[k] = re[k] * re[k] + im[k] * im[k];
    }
    specRe.push(r);
    specIm.push(ii);
    pow.push(pw);
    if (onProgress && f % 256 === 0) onProgress((f / frames) * 0.4);
  }
  // Gains from the power averaged over a 5 × 5 time-frequency neighbourhood (separable box sum).
  const gains: Float32Array[] = [];
  const R = 2;
  const colSum = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    colSum.fill(0);
    let rows = 0;
    for (let df = -R; df <= R; df++) {
      const row = pow[f + df];
      if (!row) continue;
      rows++;
      for (let k = 0; k < bins; k++) colSum[k] += row[k];
    }
    const g = new Float32Array(bins);
    let s = 0;
    let c = 0;
    for (let k = 0; k < Math.min(R, bins); k++) {
      s += colSum[k];
      c++;
    }
    for (let k = 0; k < bins; k++) {
      if (k + R < bins) {
        s += colSum[k + R];
        c++;
      }
      if (k - R - 1 >= 0) {
        s -= colSum[k - R - 1];
        c--;
      }
      const local = s / (c * rows);
      const ratio = local > 0 ? (alpha * profile.power[k]) / local : 1;
      g[k] = Math.max(floorGain, Math.sqrt(Math.max(0, 1 - ratio)));
    }
    gains.push(g);
    if (onProgress && f % 256 === 0) onProgress(0.4 + (f / frames) * 0.2);
  }
  // Apply (gains smoothed over ±2 frames, attack-biased so word onsets stay crisp) and resynthesise.
  const outBuf = new Float64Array(padded.length);
  for (let f = 0; f < frames; f++) {
    const r = specRe[f];
    const ii = specIm[f];
    for (let k = 0; k < bins; k++) {
      let g = gains[f][k] * 3;
      let wsum = 3;
      for (const [df, wt] of [[-2, 1], [-1, 2], [1, 2], [2, 1]] as const) {
        const row = gains[f + df];
        if (!row) continue;
        g += row[k] * wt;
        wsum += wt;
      }
      const smooth = Math.max(g / wsum, gains[f][k] * 0.85);
      re[k] = r[k] * smooth;
      im[k] = ii[k] * smooth;
    }
    // Rebuild the conjugate-symmetric half.
    for (let k = bins; k < n; k++) {
      re[k] = re[n - k];
      im[k] = -im[n - k];
    }
    fft(re, im, true);
    const off = f * hop;
    for (let i = 0; i < n; i++) outBuf[off + i] += re[i] * w[i];
    if (onProgress && f % 256 === 0) onProgress(0.6 + (f / frames) * 0.4);
  }
  // Hann analysis + Hann synthesis at 75 % overlap sums to 1.5.
  const norm = 1 / 1.5;
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) result[i] = outBuf[i + n] * norm;
  onProgress?.(1);
  return result;
}

/** Denoise every channel with a profile learned from their mono mix. */
export function denoiseChannels(channels: Float32Array[], options: Partial<DenoiseOptions> = {}, onProgress?: (r: number) => void): Float32Array[] {
  const profile = learnNoiseProfile(toMono(channels));
  return channels.map((ch, i) => spectralGate(ch, profile, options, onProgress ? (r) => onProgress((i + r) / channels.length) : undefined));
}

/** Simple linear-interpolation resampler (adequate for analysis, not for playback). */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const a = Math.floor(x);
    const t = x - a;
    out[i] = (samples[a] ?? 0) * (1 - t) + (samples[a + 1] ?? samples[a] ?? 0) * t;
  }
  return out;
}
