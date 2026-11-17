/**
 * Background render cache. Sections too heavy to play in real time are rendered ahead of time
 * at the cache resolution with the real compositor, encoded as one-second H.264 segments
 * (WebCodecs) and stored in userData/cache under a content key (see keys.ts). Playback shows
 * valid cached segments (player.ts) and falls back to live rendering everywhere else; the
 * timeline ruler paints the status (rendered = green, needs render = amber).
 *
 * Rendering runs on the UI thread one frame at a time, yielding between frames and pausing
 * while the preview plays or an export runs, so the editor stays responsive.
 */

import { CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, canEncodeVideo, type StreamTargetChunk } from 'mediabunny';
import { create } from 'zustand';
import { projectDuration } from '@/core/project';
import type { ID, Project } from '@/core/types';
import { api, hasBridge } from '@/platform/api';
import { getProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { useAssetRuntime } from '../media/assets';
import { hdrPassthrough } from '../media/hdr';
import { mediaPrefs, useMediaPrefs } from '../media/prefs';
import { CacheFrameRenderer } from './frameRenderer';
import { HEAVY_COST, cacheRenderSize, computeSegments, segmentFrames, type CacheSize, type Segment } from './keys';

export type SegmentStatus = 'empty' | 'cached' | 'needs-render' | 'realtime';

export interface RenderJob {
  /** Segments to render / rendered so far. */
  total: number;
  done: number;
  /** 0..1 including the segment in progress (frame granularity). */
  progress: number;
  /** Timeline range being rendered. */
  start: number;
  end: number;
  auto: boolean;
  /** Seconds of material per second of work, for the ETA. */
  startedAt: number;
}

interface CacheState {
  /** Segments of the project instance `project` at `size`. */
  segments: Segment[];
  project: Project | null;
  size: CacheSize;
  job: RenderJob | null;
  /** Bumped on every status change (cached keys, slow marks, segments). */
  version: number;
}

export const useRenderCache = create<CacheState>()(() => ({ segments: [], project: null, size: { width: 0, height: 0 }, job: null, version: 0 }));

/** Keys of segment files present on disk. */
const cached = new Set<string>();
/** Keys measured too slow for real-time playback. */
const slow = new Set<string>();

const bump = (): void => useRenderCache.setState((s) => ({ version: s.version + 1 }));

export const isCachedKey = (key: string | null | undefined): boolean => !!key && cached.has(key);
export const cacheFileName = (key: string): string => `${key}.mp4`;

export function segmentStatus(seg: Segment): SegmentStatus {
  if (!seg.key) return 'empty';
  if (cached.has(seg.key)) return 'cached';
  if (seg.cost >= HEAVY_COST || slow.has(seg.key)) return 'needs-render';
  return 'realtime';
}

/** Flag a segment as too slow for live playback (measured by the player). */
export function markSlow(key: string): void {
  if (slow.has(key)) return;
  slow.add(key);
  bump();
}

// ---------------------------------------------------------------------------------------------
// Segment computation
// ---------------------------------------------------------------------------------------------

let appVersion = '';
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

function proxiedNow(assetId: ID): boolean {
  return useMediaPrefs.getState().useProxies && !!useAssetRuntime.getState().items[assetId]?.proxyUrl;
}

function recompute(): void {
  recomputeTimer = null;
  const project = getProject();
  const size = cacheRenderSize(project.settings.width, project.settings.height, useUI.getState().previewQuality);
  const salt = `${appVersion}|hdr:${hdrPassthrough() ? 'raw' : 'sdr'}`;
  const segments = computeSegments(project, { size, salt }, projectDuration(project), proxiedNow);
  useRenderCache.setState((s) => ({ segments, project, size, version: s.version + 1 }));
}

function scheduleRecompute(delay = 120): void {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, delay);
}

/** Segment containing a timeline time (current state). */
export function segmentAt(time: number): Segment | undefined {
  const s = useRenderCache.getState();
  const fps = s.project?.settings.fps ?? 30;
  return s.segments[Math.floor(Math.floor(time * fps + 1e-4) / segmentFrames(fps))];
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

let busyProbe: () => boolean = () => false;

/** The engine reports whether the preview is playing or an export owns the GPU. */
export function setBusyProbe(fn: () => boolean): void {
  busyProbe = fn;
}

let cancelRequested = false;
let running: Promise<void> | null = null;

const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitWhileBusy(): Promise<void> {
  while (busyProbe() && !cancelRequested) await sleep(150);
}

class RenderCanceled extends Error {}

async function renderSegment(renderer: CacheFrameRenderer, seg: Segment, project: Project, onFrame: (fraction: number) => void): Promise<void> {
  const fps = project.settings.fps;
  const { width, height } = renderer.canvas;
  const opened = await api.call<{ handle: number; path: string }>('x:media:openWrite', 'cache', cacheFileName(seg.key!));
  let output: Output | null = null;
  try {
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.call('x:media:write', opened.handle, chunk.position, chunk.data) });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 }) });
    const source = new CanvasSource(renderer.canvas, {
      codec: 'avc',
      quality: new Quality({ bitrate: Math.round(Math.min(40e6, Math.max(4e6, width * height * Math.min(60, fps) * 0.22))) }),
      keyFrameInterval: 60,
      latencyMode: 'quality',
      hardwareAcceleration: 'no-preference',
    });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    for (let f = 0; f < seg.frames; f++) {
      await waitWhileBusy();
      if (cancelRequested) throw new RenderCanceled();
      await renderer.render((seg.firstFrame + f) / fps);
      await source.add(f / fps, 1 / fps);
      onFrame((f + 1) / seg.frames);
      await yieldToUI();
    }
    await output.finalize();
    await api.call('x:media:closeWrite', opened.handle);
    cached.add(seg.key!);
  } catch (err) {
    try {
      if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    } catch {
      /* unwinding */
    }
    await api.call('x:media:abortWrite', opened.handle).catch(() => undefined);
    throw err;
  }
}

/** Default range for "Render preview": in / out points, else the selected clips, else everything. */
export function defaultRenderRange(): { start: number; end: number; source: 'in/out' | 'selection' | 'timeline' } {
  const project = getProject();
  const duration = projectDuration(project);
  if (project.inPoint !== undefined && project.outPoint !== undefined && project.outPoint > project.inPoint) {
    return { start: Math.max(0, project.inPoint), end: Math.min(duration, project.outPoint), source: 'in/out' };
  }
  const sel = useUI.getState().selection.map((id) => project.clips[id]).filter(Boolean);
  if (sel.length) {
    return { start: Math.min(...sel.map((c) => c.start)), end: Math.min(duration, Math.max(...sel.map((c) => c.start + c.duration))), source: 'selection' };
  }
  return { start: 0, end: duration, source: 'timeline' };
}

/**
 * Render every uncached, non-empty segment overlapping [start, end). `onlyHeavy` restricts it to
 * segments flagged "needs render" (used by idle rendering). Resolves when done or cancelled.
 */
export function renderPreview(range?: { start: number; end: number }, opts: { onlyHeavy?: boolean; auto?: boolean } = {}): Promise<void> {
  if (running) return running;
  if (recomputeTimer) {
    clearTimeout(recomputeTimer);
    recompute();
  }
  const r = range ?? defaultRenderRange();
  const state = useRenderCache.getState();
  const project = state.project;
  if (!project) return Promise.resolve();
  const targets = state.segments.filter((s) => s.key && !cached.has(s.key) && s.end > r.start + 1e-6 && s.start < r.end - 1e-6 && (!opts.onlyHeavy || segmentStatus(s) === 'needs-render'));
  if (targets.length === 0) {
    if (!opts.auto) toast('info', 'Nothing to render', 'This range is already rendered or empty.');
    return Promise.resolve();
  }
  cancelRequested = false;
  useRenderCache.setState({ job: { total: targets.length, done: 0, progress: 0, start: r.start, end: r.end, auto: !!opts.auto, startedAt: performance.now() } });
  const size = state.size;
  running = (async () => {
    if (!(await canEncodeVideo('avc', { width: size.width, height: size.height }).catch(() => false))) {
      toast('error', 'Cannot render previews', 'This PC has no H.264 encoder available.');
      return;
    }
    const renderer = new CacheFrameRenderer(project, size.width, size.height);
    let failed: unknown = null;
    try {
      await renderer.prepare();
      for (const seg of targets) {
        if (cancelRequested) break;
        // Skip segments that an edit made obsolete meanwhile; keys are content-addressed, so
        // a segment of the snapshot is still valid if it is unchanged in the current project.
        const live = useRenderCache.getState();
        if (live.project !== project && !live.segments.some((s) => s.key === seg.key)) {
          useRenderCache.setState((s) => (s.job ? { job: { ...s.job, done: s.job.done + 1, progress: (s.job.done + 1) / s.job.total } } : {}));
          continue;
        }
        let lastUpdate = 0;
        const onFrame = (fraction: number): void => {
          const now = performance.now();
          if (now - lastUpdate < 150) return;
          lastUpdate = now;
          useRenderCache.setState((s) => (s.job ? { job: { ...s.job, progress: (s.job.done + fraction) / s.job.total } } : {}));
        };
        if (!cached.has(seg.key!)) await renderSegment(renderer, seg, project, onFrame);
        useRenderCache.setState((s) => (s.job ? { job: { ...s.job, done: s.job.done + 1, progress: (s.job.done + 1) / s.job.total } } : {}));
        bump();
      }
    } catch (err) {
      if (!(err instanceof RenderCanceled)) failed = err;
    } finally {
      await renderer.dispose();
      running = null;
      useRenderCache.setState({ job: null });
      bump();
    }
    if (failed) {
      console.warn('[cache] render failed', failed);
      toast('error', 'Rendering the preview failed', failed instanceof Error ? failed.message : String(failed));
    }
    void prune();
  })();
  return running;
}

export function cancelRender(): void {
  if (running) cancelRequested = true;
}

/** Keep the cache folder under the configured budget (LRU), protecting the open project's files. */
async function prune(): Promise<void> {
  const keep = useRenderCache
    .getState()
    .segments.filter((s) => s.key && cached.has(s.key))
    .map((s) => cacheFileName(s.key!));
  const removed = await api.call<string[]>('x:media:prune', 'cache', mediaPrefs().cacheLimitGB * 1024 ** 3, keep).catch(() => []);
  for (const name of removed) cached.delete(name.replace(/\.mp4$/i, ''));
  if (removed.length) bump();
}

/** Delete every render file. */
export async function clearRenderCache(): Promise<number> {
  cancelRender();
  await running;
  const n = await api.call<number>('x:media:remove', 'cache');
  cached.clear();
  slow.clear();
  bump();
  return n;
}

/** Re-read the cache folder (e.g. after it was cleared from Settings). */
export async function reloadCacheIndex(): Promise<void> {
  const files = await api.call<{ name: string }[]>('x:media:list', 'cache').catch(() => []);
  cached.clear();
  for (const f of files) if (f.name.endsWith('.mp4')) cached.add(f.name.slice(0, -4));
  bump();
}

/** Ranges of the timeline by status (for the ruler and tests). */
export function statusRuns(): { start: number; end: number; status: SegmentStatus }[] {
  const runs: { start: number; end: number; status: SegmentStatus }[] = [];
  for (const seg of useRenderCache.getState().segments) {
    const status = segmentStatus(seg);
    const last = runs[runs.length - 1];
    if (last && last.status === status && Math.abs(last.end - seg.start) < 1e-6) last.end = seg.end;
    else runs.push({ start: seg.start, end: seg.end, status });
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Service: keep segments current, idle rendering
// ---------------------------------------------------------------------------------------------

let started = false;
let lastActivity = performance.now();

export function startRenderCache(): void {
  if (started || !hasBridge) return;
  started = true;
  void api.app.info().then((info) => {
    appVersion = info.version;
    scheduleRecompute(0);
  });
  void reloadCacheIndex();
  useProjectStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    lastActivity = performance.now();
    // An idle render of an older state is pointless once the user edits again.
    if (useRenderCache.getState().job?.auto) cancelRender();
    scheduleRecompute();
  });
  useUI.subscribe((s, prev) => {
    if (s.previewQuality !== prev.previewQuality) scheduleRecompute(0);
  });
  // Heuristic costs depend on which sources play through proxies.
  useAssetRuntime.subscribe(() => scheduleRecompute(300));
  useMediaPrefs.subscribe((s, prev) => {
    if (s.useProxies !== prev.useProxies) scheduleRecompute(0);
  });
  scheduleRecompute(0);

  // Idle rendering: after a few quiet seconds, render the heavy sections near the playhead.
  setInterval(() => {
    if (!mediaPrefs().cacheAuto || running || busyProbe() || useUI.getState().screen !== 'editor') {
      if (busyProbe()) lastActivity = performance.now();
      return;
    }
    if (performance.now() - lastActivity < 3000) return;
    const segs = useRenderCache.getState().segments.filter((s) => segmentStatus(s) === 'needs-render');
    if (segs.length === 0) return;
    void renderPreview({ start: segs[0].start, end: segs[segs.length - 1].end }, { onlyHeavy: true, auto: true });
  }, 1000);
}

/** Note user activity (pauses idle rendering for a few seconds). */
export function noteActivity(): void {
  lastActivity = performance.now();
}
