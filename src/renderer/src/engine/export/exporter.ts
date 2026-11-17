/**
 * Export pipeline. Renders the project frame by frame with a dedicated compositor (exactly the
 * same code path as the preview), decodes source video with WebCodecs through Mediabunny, mixes
 * audio offline with Web Audio, and encodes + muxes straight to disk.
 *
 * v1.1 additions (all optional settings, so existing callers keep working): exact bitrates for
 * platform presets, transparent output (WebM VP9 with alpha, PNG still / PNG sequence), caption
 * handling (burn-in on / off, SRT / VTT sidecars, embedded WebVTT track).
 */

import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  AudioBufferSource,
  CanvasSource,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  TextSubtitleSource,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type Input,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import { toSrt, toVtt, type CaptionCue } from '@/core/captions';
import { mediaInstances, parentGainAt, type MediaInstance } from '@/core/nested';
import { getIndex, projectDuration } from '@/core/project';
import { clipGainAt } from '@/core/scene';
import type { ID, MediaAsset, Project } from '@/core/types';
import { api } from '@/platform/api';
import { buildChain } from '../audio/chain';
import { ClipAudioRenderer, openAudioSource, type AudioSource } from '../audio/render';
import { exportCaptionCues, withoutBurnedCaptions } from './captions';
import { FrameRenderer, prepareResources } from './frameRenderer';

/** `png-sequence` writes one PNG per frame into the folder given as the export path. */
export type ExportContainer = 'mp4' | 'webm' | 'mov' | 'gif' | 'mp3' | 'wav' | 'png' | 'png-sequence';
export type QualityLevel = 'low' | 'medium' | 'high' | 'best';
export type SubtitleFormat = 'srt' | 'vtt';

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
  /** Exact video bitrate (bits / s), e.g. from a platform preset. Default: derived from `quality`. */
  videoBitrate?: number;
  /** Exact audio bitrate (bits / s). Default: derived from `quality`. */
  audioBitrate?: number;
  /**
   * Transparent background. Honoured by WebM (VP9 / VP8 with alpha), PNG and PNG sequences; other
   * containers render opaque as usual.
   */
  transparent?: boolean;
  /** Draw caption tracks into the picture (default true). False hides them for this export. */
  burnInCaptions?: boolean;
  /** Subtitle files written next to the output, re-based on the exported range. */
  sidecars?: SubtitleFormat[];
  /** Add a WebVTT subtitle track inside MP4 / WebM outputs. */
  embedSubtitles?: boolean;
  /** File name prefix of the frames of a PNG sequence (default: the folder name). */
  sequenceName?: string;
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
  /** Subtitle sidecars written next to the output. */
  extraFiles?: string[];
  /** Total bytes written (image sequences; files are measured by the caller). */
  bytes?: number;
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
export function videoBitrate(s: Pick<ExportSettings, 'width' | 'height' | 'fps' | 'quality' | 'videoCodec'> & { videoBitrate?: number }): number {
  if (s.videoBitrate && s.videoBitrate > 0) return Math.round(s.videoBitrate);
  const raw = s.width * s.height * Math.min(60, s.fps) * BPP[s.quality] * (CODEC_EFFICIENCY[s.videoCodec] ?? 1);
  return Math.round(Math.min(120e6, Math.max(300e3, raw)));
}

export const audioBitrate = (q: QualityLevel): number => (q === 'low' ? 128000 : q === 'best' ? 256000 : 192000);

const audioRate = (s: Pick<ExportSettings, 'quality' | 'audioBitrate'>): number => (s.audioBitrate && s.audioBitrate > 0 ? s.audioBitrate : audioBitrate(s.quality));

/** Containers that can carry a transparent picture. */
export const supportsAlpha = (s: Pick<ExportSettings, 'container' | 'videoCodec'>): boolean =>
  s.container === 'png' || s.container === 'png-sequence' || (s.container === 'webm' && (s.videoCodec === 'vp9' || s.videoCodec === 'vp8'));

/** Containers that can carry an embedded WebVTT subtitle track. */
export const supportsEmbeddedSubtitles = (container: ExportContainer): boolean => container === 'mp4' || container === 'webm';

/** Containers next to which subtitle sidecar files make sense. */
export const supportsSidecars = (container: ExportContainer): boolean => container !== 'gif' && container !== 'png';

export { exportCaptionCues, withoutBurnedCaptions };

/** Rough output size in bytes. */
export function estimateSize(s: ExportSettings, hasAudio: boolean): number {
  const seconds = Math.max(0, s.end - s.start);
  if (s.container === 'wav') return seconds * AUDIO_SAMPLE_RATE * 4;
  if (s.container === 'mp3') return (seconds * audioRate(s)) / 8;
  if (s.container === 'gif') return seconds * s.fps * s.width * s.height * 0.22;
  if (s.container === 'png') return s.width * s.height * (s.transparent ? 1.6 : 1.2);
  if (s.container === 'png-sequence') return Math.max(1, Math.round(seconds * s.fps)) * s.width * s.height * (s.transparent ? 1.6 : 1.2);
  return (seconds * (videoBitrate(s) * (s.transparent && supportsAlpha(s) ? 1.35 : 1) + (hasAudio && s.audio ? audioRate(s) : 0))) / 8;
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

const sizeCaps = new Map<string, Promise<boolean>>();

/** Whether this PC can encode `codec` at the given frame size (e.g. H.264 at 4K). Cached. */
export function canEncodeSize(codec: VideoCodec, width: number, height: number, bitrate?: number): Promise<boolean> {
  const key = `${codec}:${width}x${height}:${bitrate ?? 0}`;
  let p = sizeCaps.get(key);
  if (!p) {
    p = canEncodeVideo(codec, { width, height, ...(bitrate ? { bitrate } : {}) }).catch(() => false);
    sizeCaps.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Audio mixing
// ---------------------------------------------------------------------------------------------

/**
 * Offline mix. Every media clip — including clips inside compound clips — is rendered through
 * its time mapping (speed, ramps, reverse, freeze, preserve pitch: see engine/audio/render.ts)
 * at the output rate, then gained (clip × enclosing compounds) and processed by its chain.
 */
class AudioMixer {
  private sources = new Map<ID, AudioSource | null>();
  private renderers = new Map<ID, ClipAudioRenderer>();
  private instances: MediaInstance[];

  constructor(
    private project: Project,
    private inputFor: (asset: MediaAsset) => Input,
  ) {
    this.instances = mediaInstances(project).filter((i) => i.audible && !!project.assets[i.clip.assetId]?.hasAudio);
  }

  get hasAudio(): boolean {
    return this.instances.length > 0;
  }

  private async source(asset: MediaAsset): Promise<AudioSource | null> {
    if (this.sources.has(asset.id)) return this.sources.get(asset.id)!;
    let entry: AudioSource | null = null;
    try {
      entry = await openAudioSource(this.inputFor(asset));
    } catch (err) {
      console.warn('[export] audio source unavailable', asset.name, err);
    }
    this.sources.set(asset.id, entry);
    return entry;
  }

  /** Mix every audible clip for the timeline window `[t0, t1)`. */
  async render(t0: number, t1: number): Promise<AudioBuffer> {
    const SR = AUDIO_SAMPLE_RATE;
    const s0 = Math.round(t0 * SR);
    const frames = Math.max(1, Math.round(t1 * SR) - s0);
    const ctx = new OfflineAudioContext(2, frames, SR);
    for (const inst of this.instances) {
      const clip = inst.clip;
      const a = Math.max(t0, inst.from);
      const b = Math.min(t1, inst.to);
      if (b - a <= 1e-6) {
        if (inst.to <= t0) this.renderers.delete(clip.id);
        continue;
      }
      const asset = this.project.assets[clip.assetId];
      if (!asset) continue;
      const src = await this.source(asset);
      if (!src) continue;
      // Sample-exact placement: contiguous windows continue each clip seamlessly.
      const sa = Math.round(a * SR);
      const n = Math.round(b * SR) - sa;
      if (n <= 0) continue;
      let renderer = this.renderers.get(clip.id);
      if (!renderer) this.renderers.set(clip.id, (renderer = new ClipAudioRenderer(clip, src, SR)));
      const data = await renderer.render(sa - Math.round(inst.origin * SR), n);
      const buffer = ctx.createBuffer(2, n, SR);
      buffer.copyToChannel(data[0], 0);
      buffer.copyToChannel(data[1], 1);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      const gain = ctx.createGain();
      // Sample the gain envelope (volume, keyframes, fades, enclosing compounds) at 200 Hz.
      const span = b - a;
      const steps = Math.max(2, Math.ceil(span * 200) + 1);
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const t = a + (i / (steps - 1)) * span;
        curve[i] = clipGainAt(clip, t - inst.origin) * parentGainAt(inst, t);
      }
      const when = (sa - s0) / SR;
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

export interface ExportHandle {
  /** Canvas being rendered — the dialog mirrors it as a live preview. */
  canvas: HTMLCanvasElement;
}

const pngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => new Promise((r) => canvas.toBlob((b) => r(b), 'image/png'));

/** Write the subtitle sidecars of an export (SRT / VTT next to the file, or inside a sequence folder). */
async function writeSidecars(path: string, folder: boolean, cues: CaptionCue[], formats: SubtitleFormat[]): Promise<string[]> {
  const out: string[] = [];
  for (const fmt of [...new Set(formats)]) {
    const text = fmt === 'srt' ? toSrt(cues) : toVtt(cues);
    out.push(await api.call<string>('x:export:writeSidecar', path, fmt, text, folder));
  }
  return out;
}

/**
 * Export `project` to `path`. Resolves when the file is complete; rejects with ExportCancelled
 * when `signal` aborts (the partial file is removed). For `png-sequence`, `path` is a folder the
 * user picked (see `x:export:pickFolder`).
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
  const container = settings.container;
  const audioOnly = container === 'mp3' || container === 'wav';
  const still = container === 'png';
  const sequence = container === 'png-sequence';
  const transparent = !!settings.transparent && supportsAlpha(settings);
  const totalFrames = still ? 1 : Math.max(1, Math.round((end - start) * fps));
  const checkAbort = (): void => {
    if (signal.aborted) throw new ExportCancelled();
  };
  const report = (phase: ExportProgress['phase'], frame: number): void => {
    const elapsed = (performance.now() - started) / 1000;
    const speed = frame > 0 ? frame / Math.max(0.001, elapsed) : 0;
    onProgress({ phase, ratio: Math.min(1, frame / totalFrames), frame, totalFrames, speed, eta: speed > 0 ? (totalFrames - frame) / speed : 0 });
  };

  // Captions: cues come from the project as edited; the picture hides caption tracks when they
  // are not burned in.
  const wantSidecars = (settings.sidecars?.length ?? 0) > 0 && supportsSidecars(container);
  const wantEmbedded = !!settings.embedSubtitles && supportsEmbeddedSubtitles(container);
  const cues = wantSidecars || wantEmbedded ? exportCaptionCues(project, { start, end }) : [];
  const scene = settings.burnInCaptions === false ? withoutBurnedCaptions(project) : project;

  report('preparing', 0);
  await prepareResources(scene);
  checkAbort();

  const renderer = new FrameRenderer({ width: settings.width, height: settings.height, transparent, noVideo: audioOnly });
  const canvas = renderer.canvas;
  const mixer = new AudioMixer(scene, renderer.inputFor);
  let writer: DiskWriter | null = null;
  let output: Output | null = null;
  const frame = async (t: number): Promise<void> => {
    await renderer.prepare(scene, t);
    renderer.render(scene, t);
  };

  try {
    if (!audioOnly) onHandle?.({ canvas });

    // ---- Still image -------------------------------------------------------------------------
    if (still) {
      await frame(start);
      const blob = await pngBlob(canvas);
      if (!blob) throw new Error('The frame could not be encoded.');
      await api.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      report('finalizing', 1);
      return { path, seconds: (performance.now() - started) / 1000, frames: 1 };
    }

    // ---- PNG image sequence (into a folder) ------------------------------------------------
    if (sequence) {
      const prefix = (settings.sequenceName || path.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '') || 'frame').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
      const digits = Math.max(5, String(totalFrames).length);
      const written: string[] = [];
      const pending = new Set<Promise<void>>();
      let bytes = 0;
      let failure: unknown = null;
      try {
        for (let i = 0; i < totalFrames; i++) {
          checkAbort();
          if (failure) throw failure;
          await frame(start + i / fps);
          // toBlob snapshots the canvas immediately, so the next frame can render while this one
          // is encoded and written; keep a few in flight.
          const name = `${prefix}_${String(i).padStart(digits, '0')}.png`;
          const job = pngBlob(canvas)
            .then(async (blob) => {
              if (!blob) throw new Error('A frame could not be encoded.');
              const data = new Uint8Array(await blob.arrayBuffer());
              await api.call('x:export:writeFrame', path, name, data);
              written.push(name);
              bytes += data.byteLength;
            })
            .catch((err) => {
              failure ??= err;
            });
          pending.add(job);
          void job.finally(() => pending.delete(job));
          if (pending.size >= 4) await Promise.race(pending);
          report('rendering', i + 1);
          if (i % 10 === 0) await yieldToUI();
        }
        await Promise.all(pending);
        if (failure) throw failure;
        checkAbort();
      } catch (err) {
        await Promise.all(pending);
        // Leave nothing half-written behind.
        if (written.length) await api.call('x:export:deleteFrames', path, written).catch(() => undefined);
        throw err;
      }
      report('finalizing', totalFrames);
      const extraFiles = wantSidecars && cues.length ? await writeSidecars(path, true, cues, settings.sidecars!) : [];
      return { path, seconds: (performance.now() - started) / 1000, frames: totalFrames, extraFiles, bytes };
    }

    // ---- Animated GIF ------------------------------------------------------------------------
    if (container === 'gif') {
      const gif = GIFEncoder();
      const delay = Math.round(1000 / fps);
      for (let i = 0; i < totalFrames; i++) {
        checkAbort();
        await frame(start + i / fps);
        const px = renderer.compositor!.readPixels();
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
    if (container === 'mp3') {
      if (!(await canEncodeAudio('mp3').catch(() => false))) registerMp3Encoder();
      audioCodec = 'mp3';
    } else if (container === 'wav') {
      audioCodec = 'pcm-s16';
    } else if (container === 'webm') {
      audioCodec = 'opus';
    } else {
      audioCodec = caps.aac ? 'aac' : 'opus';
    }
    if (audioOnly && !mixer.hasAudio) throw new Error('This project has no audio to export.');
    if (!audioOnly) {
      if (!caps.video[settings.videoCodec]) throw new Error(`This PC cannot encode ${settings.videoCodec.toUpperCase()} video. Choose a different format.`);
      if (!(await canEncodeSize(settings.videoCodec, settings.width, settings.height))) {
        throw new Error(`This PC cannot encode ${settings.videoCodec.toUpperCase()} video at ${settings.width} × ${settings.height}. Choose a lower resolution or another codec.`);
      }
    }

    writer = await openDiskWriter(path);
    // Fast start reserves room for the index at the front of the file (sized from the packet
    // counts below) instead of buffering the whole movie in memory.
    const fastStart = settings.fastStart ? ('reserve' as const) : false;
    const duration = end - start;
    // Packet maxima are only needed (and only enforced) when space is reserved for the index.
    const packetLimit = (n: number): number | undefined => (fastStart ? Math.ceil(n * 1.35) + 16 : undefined);
    const format =
      container === 'mp4'
        ? new Mp4OutputFormat({ fastStart })
        : container === 'mov'
          ? new MovOutputFormat({ fastStart })
          : container === 'webm'
            ? new WebMOutputFormat()
            : container === 'mp3'
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
        // VP9 with alpha: Mediabunny encodes the alpha plane as WebM BlockAdditional side data.
        ...(transparent ? { alpha: 'keep' as const } : {}),
      });
      output.addVideoTrack(videoSource, { frameRate: fps, maximumPacketCount: packetLimit(totalFrames) });
    }
    let audioSource: AudioBufferSource | null = null;
    if (wantAudio) {
      audioSource = new AudioBufferSource(audioCodec === 'pcm-s16' ? { codec: audioCodec } : { codec: audioCodec, quality: new Quality({ bitrate: audioRate(settings) }) });
      // Audio packets are at most ~10 ms long.
      output.addAudioTrack(audioSource, { maximumPacketCount: packetLimit(duration * 100) });
    }
    let subtitleSource: TextSubtitleSource | null = null;
    if (wantEmbedded && cues.length > 0) {
      subtitleSource = new TextSubtitleSource('webvtt');
      // Every cue and every gap is one packet.
      output.addSubtitleTrack(subtitleSource, { name: 'Captions', languageCode: 'und', maximumPacketCount: packetLimit(cues.length * 2 + 2) });
    }
    await output.start();
    checkAbort();
    if (subtitleSource) {
      await subtitleSource.add(toVtt(cues));
      subtitleSource.close();
    }

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
        await frame(start + rel);
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
    const extraFiles = wantSidecars && cues.length ? await writeSidecars(path, false, cues, settings.sidecars!) : [];
    return { path, seconds: (performance.now() - started) / 1000, frames: totalFrames, extraFiles };
  } catch (err) {
    try {
      if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    } catch {
      /* ignore secondary failures while unwinding */
    }
    await writer?.abort().catch(() => undefined);
    throw err;
  } finally {
    await renderer.dispose();
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
