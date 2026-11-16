/**
 * Background generation of timeline visuals: filmstrip thumbnails for video and waveform peaks
 * for audio. Both are produced progressively and cached per asset for the session.
 */

import { AudioSampleSink, CanvasSink } from 'mediabunny';
import type { ID, MediaAsset } from '@/core/types';
import { sharedInput } from './assets';

type Listener = () => void;
const listeners = new Map<ID, Set<Listener>>();

/** Subscribe to progressive updates for an asset's filmstrip / waveform. */
export function onAssetVisuals(assetId: ID, cb: Listener): () => void {
  let set = listeners.get(assetId);
  if (!set) listeners.set(assetId, (set = new Set()));
  set.add(cb);
  return () => set!.delete(cb);
}

const notify = (assetId: ID): void => listeners.get(assetId)?.forEach((cb) => cb());

// Small job queue so background decoding never starves playback.
const queue: (() => Promise<void>)[] = [];
let running = 0;
const MAX_JOBS = 2;

function schedule(job: () => Promise<void>): void {
  queue.push(job);
  pump();
}

function pump(): void {
  while (running < MAX_JOBS && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void job()
      .catch((err) => console.warn('[peaks] job failed', err))
      .finally(() => {
        running--;
        pump();
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Filmstrips
// ---------------------------------------------------------------------------------------------

export interface Filmstrip {
  /** Seconds between consecutive frames. */
  step: number;
  /** Thumbnail size in pixels. */
  width: number;
  height: number;
  /** frames[i] shows source time i * step (undefined until decoded). */
  frames: (HTMLCanvasElement | OffscreenCanvas | undefined)[];
  done: boolean;
}

const filmstrips = new Map<ID, Filmstrip>();
const FILM_HEIGHT = 72;
const MAX_FILM_FRAMES = 160;

export function getFilmstrip(asset: MediaAsset): Filmstrip | null {
  if (asset.kind !== 'video' || !(asset.duration > 0)) return null;
  let strip = filmstrips.get(asset.id);
  if (strip) return strip;
  const count = Math.max(1, Math.min(MAX_FILM_FRAMES, Math.ceil(asset.duration / 0.75)));
  const step = asset.duration / count;
  const aspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9;
  const created: Filmstrip = { step, width: Math.max(8, Math.round(FILM_HEIGHT * aspect)), height: FILM_HEIGHT, frames: new Array(count), done: false };
  strip = created;
  filmstrips.set(asset.id, created);
  schedule(async () => {
    const input = sharedInput(asset);
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      created.done = true;
      return;
    }
    const sink = new CanvasSink(track, { width: created.width, height: created.height, fit: 'cover' });
    const first = await track.getFirstTimestamp();
    // Decode a sparse pass first so the whole clip gets covered quickly, then fill the gaps.
    const order: number[] = [];
    for (const stride of [8, 4, 2, 1]) {
      for (let i = 0; i < count; i += stride) if (!order.includes(i)) order.push(i);
    }
    const passes: number[][] = [];
    for (const stride of [8, 4, 2, 1]) {
      const pass = order.filter((i) => i % stride === 0 && (stride === 8 || i % (stride * 2) !== 0));
      if (pass.length) passes.push(pass.sort((a, b) => a - b));
    }
    let lastNotify = 0;
    for (const pass of passes) {
      let k = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(pass.map((i) => Math.max(first, i * step)))) {
        const index = pass[k++];
        if (wrapped) created.frames[index] = wrapped.canvas;
        const now = performance.now();
        if (now - lastNotify > 250) {
          lastNotify = now;
          notify(asset.id);
        }
      }
      notify(asset.id);
    }
    created.done = true;
    notify(asset.id);
  });
  return strip;
}

/** Nearest decoded frame at or before `time`, falling back to any neighbouring frame. */
export function filmFrameAt(strip: Filmstrip, time: number): HTMLCanvasElement | OffscreenCanvas | undefined {
  const n = strip.frames.length;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(time / strip.step)));
  for (let d = 0; d < n; d++) {
    const a = strip.frames[idx - d];
    if (a) return a;
    const b = strip.frames[idx + d];
    if (b) return b;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Waveforms
// ---------------------------------------------------------------------------------------------

export const PEAKS_PER_SECOND = 100;

export interface Waveform {
  /** Peak amplitude (0..1) per bucket of 1 / PEAKS_PER_SECOND seconds. */
  peaks: Float32Array;
  /** Number of buckets decoded so far. */
  filled: number;
  done: boolean;
}

const waveforms = new Map<ID, Waveform>();

export function getWaveform(asset: MediaAsset): Waveform | null {
  if (!asset.hasAudio || !(asset.duration > 0)) return null;
  let wave = waveforms.get(asset.id);
  if (wave) return wave;
  const total = Math.max(1, Math.ceil(asset.duration * PEAKS_PER_SECOND));
  const created: Waveform = { peaks: new Float32Array(total), filled: 0, done: false };
  wave = created;
  waveforms.set(asset.id, created);
  schedule(async () => {
    const input = sharedInput(asset);
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      created.done = true;
      notify(asset.id);
      return;
    }
    const sink = new AudioSampleSink(track);
    let scratch = new Float32Array(0);
    let lastNotify = 0;
    let lastYield = performance.now();
    for await (const sample of sink.samples()) {
      try {
        const frames = sample.numberOfFrames;
        const rate = sample.sampleRate;
        if (scratch.length < frames) scratch = new Float32Array(frames);
        const channels = Math.min(2, sample.numberOfChannels);
        for (let ch = 0; ch < channels; ch++) {
          sample.copyTo(scratch, { planeIndex: ch, format: 'f32-planar' });
          const t0 = Math.max(0, sample.timestamp);
          for (let i = 0; i < frames; i++) {
            const bucket = Math.floor((t0 + i / rate) * PEAKS_PER_SECOND);
            if (bucket >= total) break;
            const v = Math.abs(scratch[i]);
            if (v > created.peaks[bucket]) created.peaks[bucket] = v;
          }
        }
        created.filled = Math.min(total, Math.ceil((Math.max(0, sample.timestamp) + sample.duration) * PEAKS_PER_SECOND));
      } finally {
        sample.close();
      }
      const now = performance.now();
      if (now - lastNotify > 300) {
        lastNotify = now;
        notify(asset.id);
      }
      if (now - lastYield > 12) {
        // Give the UI thread room to breathe while decoding long files.
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    created.filled = total;
    created.done = true;
    notify(asset.id);
  });
  return wave;
}

export function forgetVisuals(assetId: ID): void {
  filmstrips.delete(assetId);
  waveforms.delete(assetId);
}
