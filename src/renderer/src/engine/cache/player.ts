/**
 * Playback of cached segments. While the preview plays, frames of segments that are rendered
 * come from the cache files (decoded ahead with WebCodecs, uploaded straight to the preview's
 * GL context) instead of being composited live. If a cached frame is not decoded in time the
 * engine simply renders that frame live, so playback never stalls on the cache.
 *
 * Also measures playback: frames presented, distinct frames per second, and which segments
 * drop frames (those are flagged "needs render").
 */

import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { Project } from '@/core/types';
import { api } from '@/platform/api';
import type { Compositor } from '../compositor';
import { FULLSCREEN_VERT } from '../gl/shaderlib';
import { PRESENT_FRAG } from '../gl/shaders';
import { cacheFileName, isCachedKey, markSlow, useRenderCache } from './renderCache';
import { segmentFrames, type Segment } from './keys';

const AHEAD = 8;
const MAX_STREAMS = 3;

let cacheDir: string | null = null;
void api?.call<{ folder: string; path: string }[]>('x:media:usage').then(
  (list) => (cacheDir = list.find((u) => u.folder === 'cache')?.path ?? null),
  () => undefined,
);

/** Sequential decoder of one cached segment file with a small look-ahead queue. */
class SegmentStream {
  private input: Input;
  private sink: VideoSampleSink | null = null;
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private queue: VideoSample[] = [];
  private current: VideoSample | null = null;
  private pumping = false;
  private ended = false;
  private broken = false;
  lastUsed = performance.now();

  constructor(
    readonly key: string,
    path: string,
  ) {
    this.input = new Input({ source: new UrlSource(api.media.toUrl(path)), formats: ALL_FORMATS });
  }

  private async ensureSink(): Promise<VideoSampleSink | null> {
    if (this.sink || this.broken) return this.sink;
    try {
      const track = await this.input.getPrimaryVideoTrack();
      if (!track) throw new Error('no track');
      this.sink = new VideoSampleSink(track);
    } catch (err) {
      console.warn('[cache] unreadable segment', this.key, err);
      this.broken = true;
    }
    return this.sink;
  }

  private restart(from: number): void {
    void this.it?.return();
    this.it = null;
    for (const s of this.queue) s.close();
    this.queue = [];
    this.current?.close();
    this.current = null;
    this.ended = false;
    this.startAt = from;
  }

  private startAt = 0;

  /** Fill the look-ahead queue in the background. */
  pump(): void {
    if (this.pumping || this.ended || this.broken) return;
    this.pumping = true;
    void (async () => {
      try {
        const sink = await this.ensureSink();
        if (!sink) return;
        this.it ??= sink.samples(this.startAt);
        while (this.queue.length < AHEAD && this.it) {
          const it: AsyncGenerator<VideoSample, void, unknown> = this.it;
          const r: IteratorResult<VideoSample, void> = await it.next();
          if (it !== this.it) {
            if (!r.done) r.value.close();
            break;
          }
          if (r.done) {
            this.ended = true;
            break;
          }
          this.queue.push(r.value);
        }
      } catch (err) {
        console.warn('[cache] segment decode failed', this.key, err);
        this.broken = true;
      } finally {
        this.pumping = false;
      }
    })();
  }

  /** The decoded sample covering `ts` (seconds inside the segment), or null if not ready. */
  take(ts: number): VideoSample | null {
    this.lastUsed = performance.now();
    if (this.broken) return null;
    const cur = this.current;
    if (cur && ts >= cur.timestamp - 1e-4 && ts < cur.timestamp + cur.duration - 1e-4) return cur;
    if (cur && ts < cur.timestamp - 1e-4) {
      this.restart(ts);
      this.pump();
      return null;
    }
    while (this.queue.length) {
      const s = this.queue[0];
      if (s.timestamp + s.duration <= ts + 1e-4) {
        this.queue.shift()!.close();
        continue;
      }
      if (s.timestamp > ts + 1e-4) break;
      this.queue.shift();
      this.current?.close();
      this.current = s;
      this.pump();
      return s;
    }
    if (!this.it && !this.pumping) this.startAt = ts;
    this.pump();
    return null;
  }

  dispose(): void {
    void this.it?.return();
    this.it = null;
    for (const s of this.queue) s.close();
    this.queue = [];
    this.current?.close();
    this.current = null;
    try {
      this.input.dispose();
    } catch {
      /* already disposed */
    }
  }
}

const streams = new Map<string, SegmentStream>();

function streamFor(key: string): SegmentStream | null {
  let s = streams.get(key);
  if (s) return s;
  if (!cacheDir) return null;
  s = new SegmentStream(key, `${cacheDir}\\${cacheFileName(key)}`);
  streams.set(key, s);
  if (streams.size > MAX_STREAMS) {
    const oldest = [...streams.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    oldest.dispose();
    streams.delete(oldest.key);
  }
  return s;
}

function segmentFor(project: Project, frame: number): Segment | null {
  const st = useRenderCache.getState();
  // Never use keys computed for an older state of the project.
  if (st.project !== project) return null;
  return st.segments[Math.floor(frame / segmentFrames(project.settings.fps))] ?? null;
}

const textures = new WeakMap<Compositor, WebGLTexture>();

/**
 * Draw the cached frame for timeline time `t` into the preview canvas. Returns false when the
 * frame is not cached or not decoded yet (the caller renders it live).
 */
export function drawCachedFrame(compositor: Compositor, project: Project, t: number): boolean {
  const fps = project.settings.fps;
  const frame = Math.floor(t * fps + 1e-4);
  const seg = segmentFor(project, frame);
  if (!seg || !isCachedKey(seg.key)) return false;
  const stream = streamFor(seg.key!);
  if (!stream) return false;
  // Warm up the next segment shortly before the cut.
  if (frame - seg.firstFrame > seg.frames - Math.max(6, fps / 2)) {
    const next = useRenderCache.getState().segments[seg.index + 1];
    if (next && isCachedKey(next.key)) streamFor(next.key!)?.pump();
  }
  const sample = stream.take((frame - seg.firstFrame) / fps);
  if (!sample) return false;
  const ctx = compositor.ctx;
  const gl = ctx.gl;
  if (gl.isContextLost()) return false;
  let tex = textures.get(compositor);
  if (!tex) {
    tex = ctx.createTexture();
    textures.set(compositor, tex);
  }
  const vf = sample.toVideoFrame();
  try {
    if (!ctx.upload(tex, vf)) return false;
  } finally {
    vf.close();
  }
  const prog = ctx.program('present', FULLSCREEN_VERT, PRESENT_FRAG);
  if (!prog) return false;
  ctx.bind(null);
  gl.disable(gl.BLEND);
  gl.useProgram(prog.program);
  ctx.useTexture(prog, 'u_tex', 0, tex);
  ctx.drawQuad();
  return true;
}

/** Start decoding the cached segment at `t` before playback reaches it (call on play / seek). */
export function prefetchCached(project: Project, t: number): void {
  const seg = segmentFor(project, Math.floor(t * project.settings.fps + 1e-4));
  if (seg && isCachedKey(seg.key)) streamFor(seg.key!)?.take((Math.floor(t * project.settings.fps + 1e-4) - seg.firstFrame) / project.settings.fps);
}

// ---------------------------------------------------------------------------------------------
// Playback statistics
// ---------------------------------------------------------------------------------------------

export interface PlaybackStats {
  /** Frames drawn to the preview (render loop iterations). */
  presented: number;
  /** Distinct project frames shown (what the viewer sees advance). */
  distinct: number;
  fromCache: number;
  live: number;
  /** Wall-clock seconds covered. */
  seconds: number;
}

const stats = { presented: 0, distinct: 0, fromCache: 0, live: 0, since: performance.now(), lastFrame: -1 };
let lastWall = 0;
const segTiming = new Map<string, { frames: number; late: number }>();

/** Called by the engine after each preview frame. */
export function notePresented(project: Project, t: number, playing: boolean, fromCache: boolean): void {
  const fps = project.settings.fps;
  const frame = Math.floor(t * fps + 1e-4);
  const now = performance.now();
  stats.presented++;
  if (fromCache) stats.fromCache++;
  else stats.live++;
  if (frame !== stats.lastFrame) stats.distinct++;
  stats.lastFrame = frame;
  if (!playing) {
    lastWall = 0;
    return;
  }
  // Late frames during live playback mark the segment as needing a render.
  if (!fromCache && lastWall > 0) {
    const seg = segmentFor(project, frame);
    if (seg?.key) {
      const rec = segTiming.get(seg.key) ?? { frames: 0, late: 0 };
      rec.frames++;
      if (now - lastWall > (1000 / fps) * 1.6) rec.late++;
      segTiming.set(seg.key, rec);
      if (rec.frames >= 6 && rec.late / rec.frames > 0.3) markSlow(seg.key);
    }
  }
  lastWall = now;
}

export function resetPlaybackStats(): void {
  Object.assign(stats, { presented: 0, distinct: 0, fromCache: 0, live: 0, since: performance.now(), lastFrame: -1 });
}

export function playbackStats(): PlaybackStats {
  return { presented: stats.presented, distinct: stats.distinct, fromCache: stats.fromCache, live: stats.live, seconds: (performance.now() - stats.since) / 1000 };
}

/** Release decoders (e.g. when the cache is cleared or a project closes). */
export function releaseCachedStreams(): void {
  for (const s of streams.values()) s.dispose();
  streams.clear();
}
