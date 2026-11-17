/**
 * Audio extraction for analysis: decode a media clip's source range, or mix the whole timeline,
 * into plain Float32 sample arrays at a chosen rate (16 kHz mono for speech recognition, full
 * rate for noise reduction). Decoding uses Mediabunny / WebCodecs; resampling and mixing use an
 * OfflineAudioContext, so results match what the exporter hears.
 */

import { AudioBufferSink, type Input, type InputAudioTrack } from 'mediabunny';
import { sourceTimeAt } from '@/core/project';
import { clipGainAt, getAudioClips } from '@/core/scene';
import { clipEnd } from '@/core/time';
import type { AudioClip, ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { buildChain } from '../audio/chain';
import { openInput } from '../media/assets';

export class ExtractCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface ExtractOptions {
  sampleRate: number;
  /** 1 = mono mix, 2 = stereo (or the source's channel count when lower). */
  channels: 1 | 2;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export interface ExtractedAudio {
  channels: Float32Array[];
  sampleRate: number;
  /** Seconds covered. */
  duration: number;
}

const WINDOW = 20;

interface Source {
  input: Input;
  track: InputAudioTrack;
  sink: AudioBufferSink;
  sampleRate: number;
  channels: number;
}

async function openSource(asset: MediaAsset): Promise<Source> {
  const input = openInput(asset);
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) {
    input.dispose();
    throw new Error(`"${asset.name}" has no sound that can be decoded.`);
  }
  return { input, track, sink: new AudioBufferSink(track), sampleRate: await track.getSampleRate(), channels: Math.min(2, await track.getNumberOfChannels()) };
}

/** Decode `[s0, s1)` source seconds into an AudioBuffer of the source's own rate. */
async function decodeRange(ctx: BaseAudioContext, src: Source, s0: number, s1: number): Promise<AudioBuffer | null> {
  const length = Math.max(1, Math.ceil((s1 - s0) * src.sampleRate));
  const out = ctx.createBuffer(src.channels, length, src.sampleRate);
  let wrote = false;
  for await (const { buffer, timestamp } of src.sink.buffers(Math.max(0, s0), s1)) {
    const offset = Math.round((timestamp - s0) * src.sampleRate);
    for (let ch = 0; ch < src.channels; ch++) {
      const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      const from = Math.max(0, -offset);
      const to = Math.min(data.length, length - offset);
      if (to > from) {
        out.getChannelData(ch).set(data.subarray(from, to), offset + from);
        wrote = true;
      }
    }
  }
  return wrote ? out : null;
}

const check = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ExtractCancelled();
};

/**
 * Decode source seconds `[from, to)` of an asset. With `rate` ≠ 1 the result is time-scaled the
 * way a clip at that speed plays (pitch follows, as in the editor).
 */
export async function decodeAsset(asset: MediaAsset, from: number, to: number, opts: ExtractOptions & { rate?: number }): Promise<ExtractedAudio> {
  const rate = opts.rate ?? 1;
  const src = await openSource(asset);
  try {
    const outChannels = opts.channels === 1 ? 1 : Math.max(1, src.channels);
    const span = Math.max(0, to - from);
    const outDuration = span / rate;
    const total = Math.max(1, Math.round(outDuration * opts.sampleRate));
    const channels = Array.from({ length: outChannels }, () => new Float32Array(total));
    for (let w0 = 0; w0 < span; w0 += WINDOW * rate) {
      check(opts.signal);
      const w1 = Math.min(span, w0 + WINDOW * rate);
      const frames = Math.max(1, Math.round(((w1 - w0) / rate) * opts.sampleRate));
      const ctx = new OfflineAudioContext(outChannels, frames, opts.sampleRate);
      const buf = await decodeRange(ctx, src, from + w0, from + w1);
      if (buf) {
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.playbackRate.value = rate;
        node.connect(ctx.destination);
        node.start(0);
        const rendered = await ctx.startRendering();
        const at = Math.round((w0 / rate) * opts.sampleRate);
        for (let ch = 0; ch < outChannels; ch++) {
          const data = rendered.getChannelData(ch);
          channels[ch].set(data.subarray(0, Math.min(data.length, total - at)), at);
        }
      }
      opts.onProgress?.(Math.min(1, w1 / Math.max(1e-6, span)));
    }
    return { channels, sampleRate: opts.sampleRate, duration: outDuration };
  } finally {
    src.input.dispose();
  }
}

/** The sound of one clip as it plays on the timeline (trim, speed, volume envelope and fades). */
export async function decodeClip(project: Project, clip: VideoClip | AudioClip, opts: ExtractOptions & { applyGain?: boolean }): Promise<ExtractedAudio> {
  const asset = project.assets[clip.assetId];
  if (!asset || !asset.hasAudio) throw new Error(`"${clip.name}" has no sound.`);
  const res = await decodeAsset(asset, clip.trimIn, clip.trimIn + clip.duration * clip.speed, { ...opts, rate: clip.speed });
  if (opts.applyGain) {
    for (const ch of res.channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= clipGainAt(clip, i / res.sampleRate);
    }
  }
  return res;
}

/**
 * Mix the timeline `[t0, t1)` (every audible clip, with volume, fades and audio effects) the way
 * the exporter does, at the requested rate. `only` restricts the mix to some clips.
 */
export async function mixTimeline(project: Project, t0: number, t1: number, opts: ExtractOptions & { only?: ReadonlySet<ID> }): Promise<ExtractedAudio> {
  const clips = getAudioClips(project).filter((c) => !opts.only || opts.only.has(c.id));
  const sources = new Map<ID, Source | null>();
  const total = Math.max(1, Math.round((t1 - t0) * opts.sampleRate));
  const out = Array.from({ length: opts.channels }, () => new Float32Array(total));
  try {
    for (let w0 = t0; w0 < t1; w0 += WINDOW) {
      check(opts.signal);
      const w1 = Math.min(t1, w0 + WINDOW);
      const frames = Math.max(1, Math.round((w1 - w0) * opts.sampleRate));
      const ctx = new OfflineAudioContext(opts.channels, frames, opts.sampleRate);
      let any = false;
      for (const clip of clips) {
        const a = Math.max(w0, clip.start);
        const b = Math.min(w1, clipEnd(clip));
        if (b - a <= 1e-6) continue;
        const asset = project.assets[clip.assetId];
        if (!asset) continue;
        if (!sources.has(asset.id)) sources.set(asset.id, await openSource(asset).catch(() => null));
        const src = sources.get(asset.id);
        if (!src) continue;
        const buffer = await decodeRange(ctx, src, sourceTimeAt(clip, a - clip.start), sourceTimeAt(clip, b - clip.start));
        if (!buffer) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = clip.speed;
        const gain = ctx.createGain();
        const span = b - a;
        const steps = Math.max(2, Math.ceil(span * 100) + 1);
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) curve[i] = clipGainAt(clip, a - clip.start + (i / (steps - 1)) * span);
        const when = a - w0;
        gain.gain.value = curve[0];
        try {
          gain.gain.setValueCurveAtTime(curve, when, Math.max(1e-3, Math.min(span, (frames - 1) / opts.sampleRate - when)));
        } catch {
          gain.gain.setValueAtTime(curve[0], when);
        }
        const chain = buildChain(ctx, clip, 'export');
        if (chain.input && chain.output) {
          node.connect(chain.input);
          chain.output.connect(gain);
        } else node.connect(gain);
        gain.connect(ctx.destination);
        node.start(when);
        any = true;
      }
      if (any) {
        const rendered = await ctx.startRendering();
        const at = Math.round((w0 - t0) * opts.sampleRate);
        for (let ch = 0; ch < opts.channels; ch++) {
          const data = rendered.getChannelData(ch);
          out[ch].set(data.subarray(0, Math.min(data.length, total - at)), at);
        }
      }
      opts.onProgress?.(Math.min(1, (w1 - t0) / Math.max(1e-6, t1 - t0)));
    }
  } finally {
    for (const s of sources.values()) s?.input.dispose();
  }
  return { channels: out, sampleRate: opts.sampleRate, duration: t1 - t0 };
}
