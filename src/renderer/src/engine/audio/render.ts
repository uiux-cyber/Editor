/**
 * Offline rendering of a media clip's sound through its time mapping (speed, speed ramp,
 * reverse, freeze, preserve pitch). Used by the export mix and, for reversed clips, by the
 * preview — so both play exactly the same samples.
 *
 * Behaviour
 *  - Freeze frames are silent.
 *  - Without "Preserve pitch" the source is read like tape: the pitch follows the (possibly
 *    time-varying) speed, and reversed clips play reversed audio.
 *  - With "Preserve pitch", the sound is time-stretched with WSOLA (engine/audio/stretch.ts):
 *    constant speeds and speed ramps keep the original pitch (the stretch factor follows the
 *    ramp continuously). Very fast speeds (above ~4×) keep the pitch but become choppy, as in any
 *    time-stretcher; reversed clips stretch the reversed sound (grains play forwards in it).
 */

import { AudioBufferSink, type Input } from 'mediabunny';
import { sourceSpan, sourceTimeAt, speedAt } from '@/core/timemap';
import type { AudioClip, VideoClip } from '@/core/types';
import { Wsola, resample, type InputBlock } from './stretch';

export const RENDER_RATE = 48000;

export interface AudioSource {
  sink: AudioBufferSink;
  sampleRate: number;
  channels: number;
  /** Seconds of audio in the source (0 = unknown). */
  duration: number;
}

/** Open the primary audio track of an input for decoding, or null when there is none. */
export async function openAudioSource(input: Input): Promise<AudioSource | null> {
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;
  return {
    sink: new AudioBufferSink(track),
    sampleRate: await track.getSampleRate(),
    channels: Math.max(1, Math.min(2, await track.getNumberOfChannels())),
    duration: await track.computeDuration().catch(() => 0),
  };
}

/** Decode source seconds [s0, s1) into planar channels at the source rate. */
export async function decodeRange(src: AudioSource, s0: number, s1: number): Promise<InputBlock> {
  const rate = src.sampleRate;
  const startIndex = Math.floor(s0 * rate);
  const length = Math.max(1, Math.ceil(s1 * rate) - startIndex);
  const channels = Array.from({ length: src.channels }, () => new Float32Array(length));
  const from = Math.max(0, s0);
  if (s1 > from) {
    for await (const { buffer, timestamp } of src.sink.buffers(from, s1)) {
      const offset = Math.round(timestamp * rate) - startIndex;
      for (let ch = 0; ch < src.channels; ch++) {
        const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        const a = Math.max(0, -offset);
        const b = Math.min(data.length, length - offset);
        if (b > a) channels[ch].set(data.subarray(a, b), offset + a);
      }
    }
  }
  return { start: startIndex, channels };
}

type Clip = VideoClip | AudioClip;

/** Signature of the fields that change how a clip sounds (for caches). */
export const mappingKey = (c: Clip): string =>
  `${c.assetId}|${c.trimIn}|${c.speed}|${c.duration}|${c.reverse ? 1 : 0}|${c.freeze ? 1 : 0}|${c.preservePitch ? 1 : 0}|${c.speedRamp ? JSON.stringify(c.speedRamp) : ''}`;

/** True when the clip needs time-stretching to keep its pitch. */
export const needsStretch = (c: Clip): boolean => !!c.preservePitch && !c.freeze && ((!!c.speedRamp && c.speedRamp.length > 0) || Math.abs(c.speed - 1) > 1e-4);

/**
 * Renders a clip's sound in clip-local time. Consecutive `render` calls that continue where the
 * previous one ended are seamless (the time-stretcher keeps its state).
 */
export class ClipAudioRenderer {
  private wsola: Wsola | null = null;
  /** Top of the source range (reverse coordinates for the stretcher). */
  private readonly top: number;

  constructor(
    readonly clip: Clip,
    private src: AudioSource,
    readonly rate = RENDER_RATE,
  ) {
    this.top = clip.trimIn + sourceSpan(clip);
  }

  /**
   * Render `frames` samples starting at clip-local sample `n0` (sample n ↔ local time n / rate).
   * Returns two planar channels.
   */
  async render(n0: number, frames: number): Promise<Float32Array<ArrayBuffer>[]> {
    const out = [new Float32Array(frames), new Float32Array(frames)];
    const clip = this.clip;
    if (frames <= 0 || clip.freeze) return out;
    const sr = this.rate;
    if (needsStretch(clip)) {
      await this.renderStretched(n0, frames, out);
    } else {
      // Source position (seconds) per output sample, exact on a coarse grid and interpolated.
      const pos = new Float64Array(frames);
      const rate = new Float64Array(frames);
      const step = 32;
      let lo = Infinity;
      let hi = -Infinity;
      let maxRate = 1;
      for (let i = 0; i < frames; i += step) {
        const j = Math.min(frames, i + step);
        const a = sourceTimeAt(clip, (n0 + i) / sr);
        const b = sourceTimeAt(clip, (n0 + j) / sr);
        for (let k = i; k < j; k++) pos[k] = a + ((b - a) * (k - i)) / (j - i);
        const r = speedAt(clip, (n0 + i) / sr) * (this.src.sampleRate / sr);
        for (let k = i; k < j; k++) rate[k] = r;
        maxRate = Math.max(maxRate, r);
        lo = Math.min(lo, a, b);
        hi = Math.max(hi, a, b);
      }
      // Room for the interpolation taps and the anti-alias pre-filter.
      const pad = 0.01 + (maxRate + 8) / this.src.sampleRate;
      const block = await decodeRange(this.src, lo - pad, hi + pad);
      const srcRate = this.src.sampleRate;
      for (let k = 0; k < frames; k++) pos[k] *= srcRate;
      const tmp = [new Float32Array(frames), new Float32Array(frames)];
      resample(block, pos, tmp, rate);
      out[0].set(tmp[0]);
      out[1].set(this.src.channels > 1 ? tmp[1] : tmp[0]);
    }
    return out;
  }

  /** WSOLA through the mapping, in RENDER_RATE input coordinates (reversed for reverse clips). */
  private async renderStretched(n0: number, frames: number, out: Float32Array<ArrayBuffer>[]): Promise<void> {
    const clip = this.clip;
    const sr = this.rate;
    const reverse = !!clip.reverse;
    const top = this.top;
    // Input coordinate (samples at `sr`) for an output sample: increasing in both directions.
    const map = (n: number): number => {
      const s = sourceTimeAt(clip, n / sr);
      return (reverse ? top - s : s) * sr;
    };
    this.wsola ??= new Wsola(2);
    const { lo, hi } = this.wsola.inputRange(n0, frames, map);
    // Source seconds covering [lo, hi] input samples.
    const s0 = reverse ? top - hi / sr : lo / sr;
    const s1 = reverse ? top - lo / sr : hi / sr;
    const raw = await decodeRange(this.src, s0 - 0.01, s1 + 0.01);
    // Resample to `sr` at rate 1 into the stretcher's coordinates.
    const len = Math.max(1, hi - lo + 1);
    const pos = new Float64Array(len);
    const srcRate = this.src.sampleRate;
    for (let i = 0; i < len; i++) {
      const x = lo + i; // input coordinate
      const s = reverse ? top - x / sr : x / sr;
      pos[i] = s * srcRate;
    }
    const conv = [new Float32Array(len), new Float32Array(len)];
    resample(raw, pos, conv);
    if (this.src.channels < 2) conv[1].set(conv[0]);
    this.wsola.render(n0, frames, { start: lo, channels: conv }, map, out);
  }
}
