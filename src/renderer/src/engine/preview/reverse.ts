/**
 * Reverse playback for the preview. Media elements cannot play backwards, so reversed clips are
 * decoded with Mediabunny: the video in GOP-sized chunks walking backwards from the playhead into
 * a bounded frame cache, and the sound rendered once (reversed, through the clip's time mapping —
 * the same samples the export produces) and played from a Web Audio buffer.
 */

import { CanvasSink, EncodedPacketSink, type InputVideoTrack } from 'mediabunny';
import type { AudioClip, MediaAsset, VideoClip } from '@/core/types';
import { ClipAudioRenderer, RENDER_RATE, mappingKey, openAudioSource } from '../audio/render';
import type { FrameImage } from '../compositor';
import { sharedInput } from '../media/assets';

interface CachedFrame {
  t: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  version: number;
}

interface Chunk {
  from: number;
  to: number;
  frames: CachedFrame[];
}

/** Longest stretch decoded in one go (long GOPs are split, re-decoding from their key frame). */
const MAX_CHUNK = 1.0;
/** Seconds of source decoded ahead of the playhead (below it) while playing backwards. */
const AHEAD = 1.4;
/** Bound on cached frames (≈ 2 MB each at the preview size). */
const MAX_FRAMES = 84;
const PREVIEW_WIDTH = 960;

let frameVersion = 1;

/** Backwards frame cache for one reversed clip instance. */
export class ReverseFrames {
  private chunks: Chunk[] = [];
  private track: InputVideoTrack | null = null;
  private packets: EncodedPacketSink | null = null;
  private sink: CanvasSink | null = null;
  private ready: Promise<boolean>;
  private busy = false;
  private target = 0;
  private low = 0;
  private playing = false;
  private disposed = false;
  private failed = false;
  private first = 0;
  private frameDur = 1 / 30;

  constructor(
    private asset: MediaAsset,
    private onFrame: () => void,
  ) {
    this.ready = this.open();
  }

  private async open(): Promise<boolean> {
    try {
      const input = sharedInput(this.asset);
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error('no decodable video track');
      this.track = track;
      this.packets = new EncodedPacketSink(track);
      const width = Math.min(PREVIEW_WIDTH, this.asset.width || PREVIEW_WIDTH);
      this.sink = new CanvasSink(track, { width: Math.max(2, Math.round(width / 2) * 2) });
      this.first = await track.getFirstTimestamp();
      const fps = this.asset.fps > 0 ? this.asset.fps : 30;
      this.frameDur = 1 / fps;
      return true;
    } catch (err) {
      if (!this.disposed) console.warn('[preview] reverse playback unavailable for', this.asset.name, err);
      this.failed = true;
      return false;
    }
  }

  /** Frame shown at source time `t`, or the nearest cached frame while it is being decoded. */
  frame(t: number): FrameImage | null {
    let best: CachedFrame | null = null;
    let nearest: CachedFrame | null = null;
    let nearestDist = Infinity;
    for (const chunk of this.chunks) {
      for (const f of chunk.frames) {
        if (t >= chunk.from - 1e-6 && t < chunk.to + 1e-6 && f.t <= t + 1e-4 && (!best || f.t > best.t)) best = f;
        const d = Math.abs(f.t - t);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = f;
        }
      }
    }
    const f = best ?? nearest;
    if (!f) return null;
    return { source: f.canvas as TexImageSource, width: f.canvas.width, height: f.canvas.height, version: f.version };
  }

  /** True when the exact frame for `t` is cached. */
  has(t: number): boolean {
    return this.chunks.some((c) => t >= c.from - 1e-6 && t < c.to + 1e-6 && c.frames.some((f) => f.t <= t + 1e-4));
  }

  /**
   * Keep frames around source time `t` decoded. While playing, the cache runs ahead towards
   * earlier source time down to `low` (the start of the clip's source range).
   */
  want(t: number, low: number, playing: boolean): void {
    if (this.failed) return;
    this.target = t;
    this.low = low;
    this.playing = playing;
    if (!this.busy) void this.pump();
  }

  private covered(t: number): Chunk | undefined {
    return this.chunks.find((c) => t >= c.from - 1e-6 && t < c.to - 1e-6);
  }

  private async pump(): Promise<void> {
    this.busy = true;
    try {
      if (!(await this.ready)) return;
      for (let guard = 0; guard < 64 && !this.disposed; guard++) {
        const t = Math.max(this.first, this.target);
        let end: number | null = null;
        if (!this.covered(t)) {
          end = t + this.frameDur * 0.5;
        } else if (this.playing) {
          // Lowest point of the contiguous cached run below the playhead.
          let lowest = t;
          for (;;) {
            const c = this.covered(lowest - 1e-4);
            if (!c) break;
            lowest = c.from;
          }
          const floor = Math.max(this.first, this.low - this.frameDur);
          if (lowest > floor + 1e-4 && t - lowest < AHEAD) end = lowest;
        }
        if (end === null) break;
        await this.decodeChunk(end);
        this.evict();
        this.onFrame();
      }
    } catch (err) {
      if (!this.disposed) console.warn('[preview] reverse decode failed', err);
    } finally {
      this.busy = false;
    }
  }

  /** Decode the chunk ending at source time `end` (exclusive), starting at the GOP's key frame. */
  private async decodeChunk(end: number): Promise<void> {
    if (!this.packets || !this.sink) return;
    const key = await this.packets.getKeyPacket(Math.max(this.first, end - 1e-4), { metadataOnly: true });
    let from = key ? key.timestamp : this.first;
    if (end - from > MAX_CHUNK) from = end - MAX_CHUNK;
    if (end - from < this.frameDur * 0.5) from = Math.max(this.first, end - this.frameDur);
    const chunk: Chunk = { from, to: end, frames: [] };
    for await (const wc of this.sink.canvases(from, end)) {
      if (this.disposed) return;
      if (wc.timestamp + wc.duration < from - 1e-6) continue;
      chunk.frames.push({ t: wc.timestamp, canvas: wc.canvas, version: frameVersion++ });
    }
    // The frame visible at `from` may start before it.
    if (chunk.frames.length && chunk.frames[0].t > from + 1e-4) chunk.from = Math.min(chunk.from, chunk.frames[0].t);
    // Replace overlapping chunks.
    this.chunks = this.chunks.filter((c) => c.to <= chunk.from + 1e-6 || c.from >= chunk.to - 1e-6);
    this.chunks.push(chunk);
    this.chunks.sort((a, b) => a.from - b.from);
  }

  private evict(): void {
    const t = this.target;
    // Frames above the playhead are behind us when playing backwards.
    this.chunks = this.chunks.filter((c) => !(this.playing && c.from > t + 0.6) && !(c.to < t - AHEAD * 2.5));
    let count = this.chunks.reduce((n, c) => n + c.frames.length, 0);
    while (count > MAX_FRAMES && this.chunks.length > 1) {
      // Drop the chunk farthest from the playhead.
      let worst = 0;
      let worstDist = -1;
      this.chunks.forEach((c, i) => {
        const d = t < c.from ? c.from - t : t > c.to ? t - c.to : 0;
        if (d > worstDist) {
          worstDist = d;
          worst = i;
        }
      });
      count -= this.chunks[worst].frames.length;
      this.chunks.splice(worst, 1);
    }
  }

  /** Source time last asked for. */
  get lastTarget(): number {
    return this.target;
  }

  /** Waiting for the frame at the playhead. */
  settling(t: number): boolean {
    return !this.failed && !this.has(t);
  }

  dispose(): void {
    this.disposed = true;
    this.chunks = [];
  }
}

// ---------------------------------------------------------------------------------------------
// Reversed sound
// ---------------------------------------------------------------------------------------------

/** Longest clip whose reversed sound is prepared for the preview (memory bound). */
const MAX_AUDIO_SECONDS = 300;

/** The sound of a reversed clip, rendered in clip-local time for playback from a buffer. */
export class ReverseAudio {
  buffer: AudioBuffer | null = null;
  key = '';
  private job = 0;

  constructor(private ctx: BaseAudioContext) {}

  /** (Re)render when the clip's mapping changed. Resolves when the buffer is ready. */
  prepare(clip: VideoClip | AudioClip, asset: MediaAsset): void {
    const key = mappingKey(clip);
    if (key === this.key) return;
    this.key = key;
    this.buffer = null;
    const job = ++this.job;
    if (!asset.hasAudio || clip.freeze || clip.duration > MAX_AUDIO_SECONDS) return;
    void (async () => {
      try {
        const src = await openAudioSource(sharedInput(asset));
        if (!src || job !== this.job) return;
        const frames = Math.max(1, Math.round(clip.duration * RENDER_RATE));
        const renderer = new ClipAudioRenderer(clip, src, RENDER_RATE);
        const buffer = this.ctx.createBuffer(2, frames, RENDER_RATE);
        // Render in blocks so long clips do not stall the UI thread for long.
        const block = RENDER_RATE * 4;
        for (let at = 0; at < frames; at += block) {
          const n = Math.min(block, frames - at);
          const data = await renderer.render(at, n);
          if (job !== this.job) return;
          buffer.copyToChannel(data[0], 0, at);
          buffer.copyToChannel(data[1], 1, at);
          await new Promise((r) => setTimeout(r, 0));
        }
        if (job === this.job) this.buffer = buffer;
      } catch (err) {
        if (job === this.job) console.warn('[preview] reversed sound unavailable', err);
      }
    })();
  }

  dispose(): void {
    this.job++;
    this.buffer = null;
  }
}
