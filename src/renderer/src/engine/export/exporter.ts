/**
 * Export pipeline. Renders the project frame by frame with a dedicated compositor (exactly the
 * same code path as the preview), decodes source video with WebCodecs through Mediabunny, mixes
 * audio offline with Web Audio, and encodes + muxes straight to disk.
 */

import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  AudioBufferSink,
  AudioBufferSource,
  CanvasSink,
  CanvasSource,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type Input,
  type InputAudioTrack,
  type StreamTargetChunk,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import { getIndex, projectDuration, sourceTimeAt } from '@/core/project';
import { clipGainAt, getAudioClips, getSceneItems } from '@/core/scene';
import { clipEnd } from '@/core/time';
import type { AudioClip, ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { api } from '@/platform/api';
import { buildChain } from '../audio/chain';
import { Compositor, type FrameImage, type MediaProvider } from '../compositor';
import { getImage, openInput, preloadImages } from '../media/assets';
import { ensureFont } from '../sources/text';
import { endExportMattes, exportMatte, isCutoutClip, prepareExportMatte } from '@/vision/cutout';

export type ExportContainer = 'mp4' | 'webm' | 'mov' | 'gif' | 'mp3' | 'wav' | 'png';
export type QualityLevel = 'low' | 'medium' | 'high' | 'best';

export interface ExportSettings {
  container: ExportContainer;
  videoCodec: VideoCodec;
  width: number;
  height: number;
  fps: number;
  quality: QualityLevel;
  /** Include the sound track (ignored by GIF / PNG). */
  audio: boolean;
  /** Seconds, inside the project. */
  start: number;
  end: number;
  hardware: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  /** Put the index at the front of MP4 / MOV files (needs the whole file in memory). */
  fastStart: boolean;
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finalizing';
  /** 0..1 */
  ratio: number;
  frame: number;
  totalFrames: number;
  /** Rendered frames per second. */
  speed: number;
  /** Estimated seconds remaining. */
  eta: number;
}

export interface ExportResult {
  path: string;
  seconds: number;
  frames: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

export const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_WINDOW = 4;

const BPP: Record<QualityLevel, number> = { low: 0.045, medium: 0.085, high: 0.14, best: 0.22 };
const CODEC_EFFICIENCY: Record<string, number> = { avc: 1, hevc: 0.68, vp9: 0.7, av1: 0.58, vp8: 1.15 };

/** Target video bitrate (bits per second) for the given settings. */
export function videoBitrate(s: Pick<ExportSettings, 'width' | 'height' | 'fps' | 'quality' | 'videoCodec'>): number {
  const raw = s.width * s.height * Math.min(60, s.fps) * BPP[s.quality] * (CODEC_EFFICIENCY[s.videoCodec] ?? 1);
  return Math.round(Math.min(120e6, Math.max(300e3, raw)));
}

export const audioBitrate = (q: QualityLevel): number => (q === 'low' ? 128000 : q === 'best' ? 256000 : 192000);

/** Rough output size in bytes. */
export function estimateSize(s: ExportSettings, hasAudio: boolean): number {
  const seconds = Math.max(0, s.end - s.start);
  if (s.container === 'wav') return seconds * AUDIO_SAMPLE_RATE * 4;
  if (s.container === 'mp3') return (seconds * audioBitrate(s.quality)) / 8;
  if (s.container === 'gif') return seconds * s.fps * s.width * s.height * 0.22;
  if (s.container === 'png') return s.width * s.height * 1.2;
  return (seconds * (videoBitrate(s) + (hasAudio && s.audio ? audioBitrate(s.quality) : 0))) / 8;
}

export interface Capabilities {
  video: Record<string, boolean>;
  aac: boolean;
  opus: boolean;
}

let capsCache: Promise<Capabilities> | null = null;

/** Which codecs this PC can encode (cached). */
export function getCapabilities(): Promise<Capabilities> {
  capsCache ??= (async () => {
    const video: Record<string, boolean> = {};
    for (const codec of ['avc', 'hevc', 'vp9', 'av1'] as VideoCodec[]) {
      video[codec] = await canEncodeVideo(codec, { width: 1920, height: 1080 }).catch(() => false);
    }
    const aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE }).catch(() => false);
    const opus = await canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE }).catch(() => false);
    return { video, aac, opus };
  })();
  return capsCache;
}

// ---------------------------------------------------------------------------------------------
// Video decoding
// ---------------------------------------------------------------------------------------------

/** Sequential decoder for one video clip: hands out the frame shown at increasing source times. */
class ClipDecoder {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private exhausted = false;
  private lastTime = -Infinity;
  private width = 0;
  private height = 0;
  version = 0;

  constructor(
    private sink: CanvasSink,
    private firstTimestamp: number,
  ) {}

  private async start(time: number): Promise<void> {
    await this.iterator?.return();
    // Start slightly early so the frame covering `time` is guaranteed to be in the stream.
    this.iterator = this.sink.canvases(Math.max(this.firstTimestamp, time - 0.6));
    this.current = null;
    this.next = null;
    this.exhausted = false;
    await this.pull();
  }

  private async pull(): Promise<void> {
    if (!this.iterator || this.exhausted) {
      this.next = null;
      return;
    }
    const r = await this.iterator.next();
    if (r.done) {
      this.exhausted = true;
      this.next = null;
    } else {
      this.next = r.value;
    }
  }

  /** Position the decoder on the frame visible at `time` (seconds in the source file). */
  async seek(time: number): Promise<void> {
    if (!this.iterator || time < this.lastTime - 1e-4) await this.start(time);
    this.lastTime = time;
    while (this.next && this.next.timestamp <= time + 1e-4) {
      this.current = this.next;
      this.version++;
      await this.pull();
    }
    if (!this.current && this.next) {
      // Requested time is before the first frame: show the first frame.
      this.current = this.next;
      this.version++;
      await this.pull();
    }
    if (this.current) {
      this.width = this.current.canvas.width;
      this.height = this.current.canvas.height;
    }
  }

  frame(): FrameImage | null {
    if (!this.current) return null;
    return { source: this.current.canvas as TexImageSource, width: this.width, height: this.height, version: this.version };
  }

  async dispose(): Promise<void> {
    try {
      await this.iterator?.return();
    } catch {
      /* decoder already closed */
    }
    this.iterator = null;
    this.current = null;
    this.next = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Audio mixing
// ---------------------------------------------------------------------------------------------

interface AudioSourceEntry {
  input: Input;
  track: InputAudioTrack;
  sink: AudioBufferSink;
  sampleRate: number;
  channels: number;
}

class AudioMixer {
  private sources = new Map<ID, AudioSourceEntry | null>();
  private clips: (VideoClip | AudioClip)[];

  constructor(
    private project: Project,
    private inputFor: (asset: MediaAsset) => Input,
  ) {
    this.clips = getAudioClips(project);
  }

  get hasAudio(): boolean {
    return this.clips.length > 0;
  }

  private async source(asset: MediaAsset): Promise<AudioSourceEntry | null> {
    if (this.sources.has(asset.id)) return this.sources.get(asset.id)!;
    let entry: AudioSourceEntry | null = null;
    try {
      const input = this.inputFor(asset);
      const track = await input.getPrimaryAudioTrack();
      if (track && (await track.canDecode())) {
        entry = { input, track, sink: new AudioBufferSink(track), sampleRate: await track.getSampleRate(), channels: Math.min(2, await track.getNumberOfChannels()) };
      }
    } catch (err) {
      console.warn('[export] audio source unavailable', asset.name, err);
    }
    this.sources.set(asset.id, entry);
    return entry;
  }

  /** Decode `[s0, s1)` seconds of a source into one contiguous AudioBuffer. */
  private async decode(ctx: BaseAudioContext, src: AudioSourceEntry, s0: number, s1: number): Promise<AudioBuffer | null> {
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

  /** Mix every audible clip for the timeline window `[t0, t1)`. */
  async render(t0: number, t1: number): Promise<AudioBuffer> {
    const frames = Math.max(1, Math.round((t1 - t0) * AUDIO_SAMPLE_RATE));
    const ctx = new OfflineAudioContext(2, frames, AUDIO_SAMPLE_RATE);
    for (const clip of this.clips) {
      const a = Math.max(t0, clip.start);
      const b = Math.min(t1, clipEnd(clip));
      if (b - a <= 1e-6) continue;
      const asset = this.project.assets[clip.assetId];
      if (!asset) continue;
      const src = await this.source(asset);
      if (!src) continue;
      const s0 = sourceTimeAt(clip, a - clip.start);
      const s1 = sourceTimeAt(clip, b - clip.start);
      const buffer = await this.decode(ctx, src, s0, s1);
      if (!buffer) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = clip.speed;
      const gain = ctx.createGain();
      // Sample the clip's gain envelope (volume, keyframes, fades) at 200 Hz.
      const span = b - a;
      const steps = Math.max(2, Math.ceil(span * 200) + 1);
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = clipGainAt(clip, a - clip.start + (i / (steps - 1)) * span);
      const when = a - t0;
      gain.gain.value = curve[0];
      try {
        gain.gain.setValueCurveAtTime(curve, when, Math.max(1e-3, Math.min(span, (frames - 1) / AUDIO_SAMPLE_RATE - when)));
      } catch {
        gain.gain.setValueAtTime(curve[0], when);
      }
      const chain = buildChain(ctx, clip, 'export');
      if (chain.input && chain.output) {
        node.connect(chain.input);
        chain.output.connect(gain);
      } else {
        node.connect(gain);
      }
      gain.connect(ctx.destination);
      node.start(when);
    }
    return ctx.startRendering();
  }
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

interface DiskWriter {
  writable: WritableStream<StreamTargetChunk>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}

async function openDiskWriter(path: string): Promise<DiskWriter> {
  const handle = await api.fs.openWrite(path);
  let closed = false;
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => api.fs.write(handle, chunk.position, chunk.data),
  });
  return {
    writable,
    close: async () => {
      if (closed) return;
      closed = true;
      await api.fs.closeWrite(handle);
    },
    abort: async () => {
      if (closed) return;
      closed = true;
      await api.fs.abortWrite(handle);
    },
  };
}

const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Everything the export needs that must be loaded before the first frame. */
async function prepareResources(project: Project): Promise<void> {
  const fonts: Promise<void>[] = [];
  const images = new Set<ID>();
  for (const clip of Object.values(project.clips)) {
    if (clip.type === 'text') fonts.push(ensureFont(clip.text));
    if (clip.type === 'image') images.add(clip.assetId);
  }
  await Promise.all([...fonts, ensureFont({ fontFamily: 'Inter', fontWeight: 600, italic: false }), preloadImages([...images])]);
}

export interface ExportHandle {
  /** Canvas being rendered — the dialog mirrors it as a live preview. */
  canvas: HTMLCanvasElement;
}

/**
 * Export `project` to `path`. Resolves when the file is complete; rejects with ExportCancelled
 * when `signal` aborts (the partial file is removed).
 */
export async function exportProject(
  project: Project,
  settings: ExportSettings,
  path: string,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  onHandle?: (h: ExportHandle) => void,
): Promise<ExportResult> {
  const started = performance.now();
  const start = Math.max(0, settings.start);
  const end = Math.min(Math.max(start, settings.end), Math.max(projectDuration(project), start));
  const fps = settings.fps;
  const audioOnly = settings.container === 'mp3' || settings.container === 'wav';
  const still = settings.container === 'png';
  const totalFrames = still ? 1 : Math.max(1, Math.round((end - start) * fps));
  const checkAbort = (): void => {
    if (signal.aborted) throw new ExportCancelled();
  };
  const report = (phase: ExportProgress['phase'], frame: number): void => {
    const elapsed = (performance.now() - started) / 1000;
    const speed = frame > 0 ? frame / Math.max(0.001, elapsed) : 0;
    onProgress({ phase, ratio: Math.min(1, frame / totalFrames), frame, totalFrames, speed, eta: speed > 0 ? (totalFrames - frame) / speed : 0 });
  };

  report('preparing', 0);
  await prepareResources(project);
  checkAbort();

  // Shared Mediabunny inputs, one per asset.
  const inputs = new Map<ID, Input>();
  const inputFor = (asset: MediaAsset): Input => {
    let input = inputs.get(asset.id);
    if (!input) {
      input = openInput(asset);
      inputs.set(asset.id, input);
    }
    return input;
  };

  const canvas = document.createElement('canvas');
  canvas.width = settings.width;
  canvas.height = settings.height;
  let compositor: Compositor | null = null;
  const decoders = new Map<ID, ClipDecoder | null>();
  const mixer = new AudioMixer(project, inputFor);
  let writer: DiskWriter | null = null;
  let output: Output | null = null;

  const decoderFor = async (clip: VideoClip): Promise<ClipDecoder | null> => {
    if (decoders.has(clip.id)) return decoders.get(clip.id)!;
    let decoder: ClipDecoder | null = null;
    const asset = project.assets[clip.assetId];
    try {
      if (asset) {
        const track = await inputFor(asset).getPrimaryVideoTrack();
        if (track && (await track.canDecode())) {
          decoder = new ClipDecoder(new CanvasSink(track, { poolSize: 3 }), await track.getFirstTimestamp());
        }
      }
    } catch (err) {
      console.warn('[export] video source unavailable', clip.name, err);
    }
    decoders.set(clip.id, decoder);
    return decoder;
  };

  const provider: MediaProvider = {
    videoFrame: (clip) => decoders.get(clip.id)?.frame() ?? null,
    image: (assetId) => {
      const img = getImage(assetId);
      return img && img.bitmap ? { source: img.bitmap, width: img.width, height: img.height, version: img.version } : null;
    },
    // Background removal (vision feature): mattes computed per frame in prepareFrame.
    matte: (clip) => exportMatte(clip),
  };

  /** Decode every video frame needed at timeline time `t`, and free decoders of finished clips. */
  const prepareFrame = async (t: number): Promise<void> => {
    const active = new Set<ID>();
    for (const item of getSceneItems(project, t)) {
      const refs = item.kind === 'layer' ? [item.layer] : [item.from, item.to];
      for (const ref of refs) {
        // Background removal: stills need their (cached) matte before the frame renders.
        if (ref.clip.type === 'image' && isCutoutClip(ref.clip)) await prepareExportMatte(ref.clip, project, provider.image(ref.clip.assetId), 0);
        if (ref.clip.type !== 'video') continue;
        const asset = project.assets[ref.clip.assetId];
        if (!asset) continue;
        active.add(ref.clip.id);
        const decoder = await decoderFor(ref.clip);
        if (!decoder) continue;
        const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Infinity;
        const sourceTime = Math.min(Math.max(sourceTimeAt(ref.clip, ref.localTime), 0), maxT);
        await decoder.seek(sourceTime);
        // Background removal: segment exactly the decoded frame (deterministic per frame).
        if (isCutoutClip(ref.clip)) await prepareExportMatte(ref.clip, project, decoder.frame(), sourceTime);
      }
    }
    for (const [id, decoder] of decoders) {
      if (decoder && !active.has(id)) {
        const clip = project.clips[id];
        // Keep decoders for clips that will be needed again shortly (transition handles).
        if (!clip || clipEnd(clip) + 3 < t) {
          await decoder.dispose();
          decoders.delete(id);
        }
      }
    }
  };

  const cleanup = async (): Promise<void> => {
    endExportMattes();
    for (const d of decoders.values()) await d?.dispose();
    decoders.clear();
    for (const input of inputs.values()) {
      try {
        input.dispose();
      } catch {
        /* already disposed */
      }
    }
    inputs.clear();
    try {
      compositor?.dispose();
      // Release the GPU context right away instead of waiting for garbage collection.
      (compositor?.ctx.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    } catch {
      /* context already lost */
    }
    compositor = null;
  };

  try {
    if (!audioOnly) {
      compositor = new Compositor(canvas, { preserveDrawingBuffer: true });
      compositor.setSize(settings.width, settings.height);
      onHandle?.({ canvas });
    }

    // ---- Still image -------------------------------------------------------------------------
    if (still) {
      await prepareFrame(start);
      compositor!.render(project, start, provider);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png'));
      if (!blob) throw new Error('The frame could not be encoded.');
      await api.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      report('finalizing', 1);
      return { path, seconds: (performance.now() - started) / 1000, frames: 1 };
    }

    // ---- Animated GIF ------------------------------------------------------------------------
    if (settings.container === 'gif') {
      const gif = GIFEncoder();
      const delay = Math.round(1000 / fps);
      for (let i = 0; i < totalFrames; i++) {
        checkAbort();
        const t = start + i / fps;
        await prepareFrame(t);
        compositor!.render(project, t, provider);
        const px = compositor!.readPixels();
        if (px) {
          const palette = quantize(px.data, 256);
          gif.writeFrame(applyPalette(px.data, palette), px.width, px.height, { palette, delay });
        }
        if (i % 3 === 0) {
          report('rendering', i + 1);
          await yieldToUI();
        }
      }
      report('finalizing', totalFrames);
      gif.finish();
      await api.fs.writeFile(path, gif.bytes());
      return { path, seconds: (performance.now() - started) / 1000, frames: totalFrames };
    }

    // ---- Video / audio through Mediabunny ----------------------------------------------------
    const caps = await getCapabilities();
    const wantAudio = (audioOnly || settings.audio) && mixer.hasAudio;
    let audioCodec: AudioCodec = 'aac';
    if (settings.container === 'mp3') {
      if (!(await canEncodeAudio('mp3').catch(() => false))) registerMp3Encoder();
      audioCodec = 'mp3';
    } else if (settings.container === 'wav') {
      audioCodec = 'pcm-s16';
    } else if (settings.container === 'webm') {
      audioCodec = 'opus';
    } else {
      audioCodec = caps.aac ? 'aac' : 'opus';
    }
    if (audioOnly && !mixer.hasAudio) throw new Error('This project has no audio to export.');
    if (!audioOnly && !caps.video[settings.videoCodec]) {
      throw new Error(`This PC cannot encode ${settings.videoCodec.toUpperCase()} video. Choose a different format.`);
    }

    writer = await openDiskWriter(path);
    const format =
      settings.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: settings.fastStart ? 'in-memory' : false })
        : settings.container === 'mov'
          ? new MovOutputFormat({ fastStart: settings.fastStart ? 'in-memory' : false })
          : settings.container === 'webm'
            ? new WebMOutputFormat()
            : settings.container === 'mp3'
              ? new Mp3OutputFormat()
              : new WavOutputFormat();
    output = new Output({ format, target: new StreamTarget(writer.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });

    let videoSource: CanvasSource | null = null;
    if (!audioOnly) {
      videoSource = new CanvasSource(canvas, {
        codec: settings.videoCodec,
        quality: new Quality({ bitrate: videoBitrate(settings) }),
        keyFrameInterval: 2,
        latencyMode: 'quality',
        hardwareAcceleration: settings.hardware,
      });
      output.addVideoTrack(videoSource, { frameRate: fps });
    }
    let audioSource: AudioBufferSource | null = null;
    if (wantAudio) {
      audioSource = new AudioBufferSource(audioCodec === 'pcm-s16' ? { codec: audioCodec } : { codec: audioCodec, quality: new Quality({ bitrate: audioBitrate(settings.quality) }) });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    checkAbort();

    const duration = end - start;
    let audioDone = 0; // seconds of audio already submitted
    const feedAudio = async (upTo: number): Promise<void> => {
      if (!audioSource) return;
      while (audioDone < upTo - 1e-6) {
        checkAbort();
        const w0 = audioDone;
        const w1 = Math.min(duration, w0 + AUDIO_WINDOW);
        const buffer = await mixer.render(start + w0, start + w1);
        await audioSource.add(buffer);
        audioDone = w1;
      }
    };

    if (audioOnly) {
      const windows = Math.max(1, Math.ceil(duration / AUDIO_WINDOW));
      for (let w = 0; w < windows; w++) {
        await feedAudio(Math.min(duration, (w + 1) * AUDIO_WINDOW));
        onProgress({ phase: 'rendering', ratio: (w + 1) / windows, frame: w + 1, totalFrames: windows, speed: 0, eta: 0 });
        await yieldToUI();
      }
    } else {
      for (let i = 0; i < totalFrames; i++) {
        checkAbort();
        const rel = i / fps;
        // Keep the audio a little ahead of the picture so the muxer can interleave as it goes.
        if (audioSource && rel >= audioDone - 0.5) await feedAudio(Math.min(duration, audioDone + AUDIO_WINDOW));
        const t = start + rel;
        await prepareFrame(t);
        compositor!.render(project, t, provider);
        await videoSource!.add(rel, 1 / fps);
        if (i % 5 === 0) {
          report('rendering', i + 1);
          if (i % 30 === 0) await yieldToUI();
        }
      }
      await feedAudio(duration);
    }

    checkAbort();
    report('finalizing', totalFrames);
    await output.finalize();
    await writer.close();
    return { path, seconds: (performance.now() - started) / 1000, frames: totalFrames };
  } catch (err) {
    try {
      if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    } catch {
      /* ignore secondary failures while unwinding */
    }
    await writer?.abort().catch(() => undefined);
    throw err;
  } finally {
    await cleanup();
  }
}

/** Number of clips that would export badly: empty placeholders and offline media. */
export function exportWarnings(project: Project, missingAssets: ReadonlySet<ID>): { slots: number; missing: number } {
  let slots = 0;
  let missing = 0;
  const hidden = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  for (const clip of Object.values(project.clips)) {
    if (hidden.has(clip.trackId)) continue;
    if (clip.type === 'shape' && clip.shape.slot) slots++;
    if ('assetId' in clip && missingAssets.has(clip.assetId)) missing++;
  }
  return { slots, missing };
}

export { getIndex };
