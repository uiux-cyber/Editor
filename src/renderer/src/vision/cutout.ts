/**
 * Background removal: person mattes for video / image layers.
 *
 * - Preview: the frame on screen is segmented asynchronously in the vision worker; while a new
 *   mask is computed the previous one stays up, and during playback consecutive masks are
 *   blended (exponential smoothing) so edges do not flicker. A paused frame always shows the
 *   exact, unsmoothed mask of that frame — the same one the exporter computes.
 * - Export: the decoded frame is segmented before it is rendered (awaited, per frame, no
 *   temporal state), so exports are deterministic.
 * - Masks are cached per asset / frame in a memory-capped LRU; stills are computed once.
 *
 * The compositor reads mattes through `MediaProvider.matte` and the cutout layer extension
 * (engine/gl/ext/cutout.ts) applies feather / choke with an edge-aware filter on the GPU.
 */

import type { FrameImage } from '@/engine/compositor';
import type { ID, ImageClip, MediaAsset, Project, VideoClip, VisualClip } from '@/core/types';
import { toast } from '@/store/ui';
import { finalDelegateReady, isCancelled, onFinalDelegateReady, segmentFrame, type SegmentResult } from './client';
import { useVision, type CutoutStatus } from './store';

/** Longest side of the analysed picture (the GPU filter refines edges at full resolution). */
const MASK_SIDE = 384;
let cacheCapBytes = 192 * 1024 * 1024;

interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------------------------

const cache = new Map<string, Mask>();
let cacheBytes = 0;

function cacheGet(key: string): Mask | undefined {
  const m = cache.get(key);
  if (m) {
    cache.delete(key);
    cache.set(key, m);
  }
  return m;
}

function cacheSet(key: string, m: Mask): void {
  const old = cache.get(key);
  if (old) {
    cacheBytes -= old.data.byteLength;
    cache.delete(key);
  }
  cache.set(key, m);
  cacheBytes += m.data.byteLength;
  while (cacheBytes > cacheCapBytes && cache.size > 1) {
    const [oldest, v] = cache.entries().next().value as [string, Mask];
    cache.delete(oldest);
    cacheBytes -= v.data.byteLength;
  }
}

export function setMaskCacheLimit(mb: number): void {
  cacheCapBytes = Math.max(16, mb) * 1024 * 1024;
  while (cacheBytes > cacheCapBytes && cache.size > 1) {
    const [oldest, v] = cache.entries().next().value as [string, Mask];
    cache.delete(oldest);
    cacheBytes -= v.data.byteLength;
  }
}

export function maskCacheInfo(): { entries: number; bytes: number; limit: number } {
  return { entries: cache.size, bytes: cacheBytes, limit: cacheCapBytes };
}

export function clearMaskCache(): void {
  cache.clear();
  cacheBytes = 0;
}

const frameIndex = (asset: MediaAsset, sourceTime: number): number => Math.floor(Math.max(0, sourceTime) * (asset.fps > 0 ? asset.fps : 30) + 1e-3);
const videoKey = (assetId: ID, path: 'p' | 'f' | 'x', idx: number): string => `${assetId}|${path}|${idx}`;
const stillKey = (assetId: ID, path: 'p' | 'f' | 'x'): string => `${assetId}|still|${path}`;

function maskSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MASK_SIDE / Math.max(1, w, h));
  return { w: Math.max(16, Math.round(w * k)), h: Math.max(16, Math.round(h * k)) };
}

let versionSeq = 1;
function toFrame(data: Uint8Array | Float32Array, w: number, h: number): FrameImage {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const v = data[i];
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  return { source: img, width: w, height: h, version: versionSeq++ };
}

// ---------------------------------------------------------------------------------------------
// Status for the UI
// ---------------------------------------------------------------------------------------------

let lastStatusAt = 0;
function setStatus(clipId: ID, status: CutoutStatus, force = false): void {
  const cur = useVision.getState().cutout[clipId];
  const now = performance.now();
  if (!force && cur && cur.state === status.state && now - lastStatusAt < 600) return;
  lastStatusAt = now;
  useVision.setState((s) => ({ cutout: { ...s.cutout, [clipId]: { ...cur, ...status } } }));
}

let errorShown = false;
function reportError(clipId: ID, err: unknown): void {
  if (isCancelled(err)) return;
  const message = (err as Error)?.message ?? String(err);
  setStatus(clipId, { state: 'error', message }, true);
  if (!errorShown) {
    errorShown = true;
    toast('error', 'Background removal is unavailable', message);
  }
}

/** Segment a picture at mask resolution. `final` = export (fixed delegate, see client.ts). */
function segmentSource(source: CanvasImageSource | ImageBitmap, w: number, h: number, final: boolean): Promise<SegmentResult> {
  const size = maskSize(w, h);
  return segmentFrame(() => createImageBitmap(source as ImageBitmapSource, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'medium' }), final);
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

interface Display {
  key: string;
  idx: number;
  /** Float copy of what is shown (for blending). */
  values: Float32Array;
  frame: FrameImage;
  blended: boolean;
  w: number;
  h: number;
}

const display = new Map<ID, Display>();
const inflight = new Set<ID>();
const stillsPending = new Set<ID>();

export interface PreviewMatteEnv {
  playing: boolean;
  /** The picture currently uploaded for this clip (video element or still bitmap). */
  frame: () => FrameImage | null;
  /** Ask the preview to repaint (a mask became available). */
  invalidate: () => void;
}

function show(clipId: ID, key: string, idx: number, mask: Mask, blend: boolean): FrameImage {
  const cur = display.get(clipId);
  if (cur && cur.key === key && cur.blended === blend) return cur.frame;
  if (cur && cur.key === key && blend) return cur.frame;
  const n = mask.data.length;
  const values = new Float32Array(n);
  let blended = false;
  if (blend && cur && cur.w === mask.w && cur.h === mask.h && Math.abs(cur.idx - idx) <= 3 && cur.idx !== idx) {
    // Temporal smoothing while playing: 60 % new, 40 % previous.
    for (let i = 0; i < n; i++) values[i] = mask.data[i] * 0.6 + cur.values[i] * 0.4;
    blended = true;
  } else {
    for (let i = 0; i < n; i++) values[i] = mask.data[i];
  }
  const frame = toFrame(values, mask.w, mask.h);
  display.set(clipId, { key, idx, values, frame, blended, w: mask.w, h: mask.h });
  return frame;
}

let lastInvalidate: (() => void) | null = null;
let lastProject: Project | null = null;
// When the final (export) delegate becomes ready, repaint so paused frames upgrade to it.
onFinalDelegateReady(() => lastInvalidate?.());

/**
 * Which cached mask to show and what to compute. Cache paths: `x` = export (final delegate, the
 * exporter's own decoded frame — only the exporter writes these, so exports never depend on
 * what was previewed), `f` = final delegate on the preview's picture, `p` = whatever segmenter
 * was ready. Paused frames upgrade to `f` once the final delegate is ready, so a paused preview
 * shows the same matte an export computes (up to decoder differences).
 */
function pick(keyOf: (path: 'p' | 'f' | 'x') => string, playing: boolean): { key: string; mask: Mask | undefined; compute: 'f' | 'p' | null } {
  for (const path of ['x', 'f'] as const) {
    const m = cacheGet(keyOf(path));
    if (m) return { key: keyOf(path), mask: m, compute: null };
  }
  const p = cacheGet(keyOf('p'));
  const final = finalDelegateReady();
  if (p) return { key: keyOf('p'), mask: p, compute: !playing && final ? 'f' : null };
  return { key: keyOf('p'), mask: undefined, compute: final ? 'f' : 'p' };
}

function previewStill(clip: ImageClip, asset: MediaAsset, env: PreviewMatteEnv): FrameImage | null {
  const choice = pick((path) => stillKey(asset.id, path), false);
  if (choice.compute && !stillsPending.has(asset.id)) {
    const frame = env.frame();
    if (frame) {
      const target = stillKey(asset.id, choice.compute);
      stillsPending.add(asset.id);
      if (!choice.mask) setStatus(clip.id, { state: 'loading' }, true);
      segmentSource(frame.source as CanvasImageSource, frame.width, frame.height, choice.compute === 'f')
        .then((r) => {
          cacheSet(target, { data: r.mask, w: r.w, h: r.h });
          setStatus(clip.id, { state: 'ready', ms: r.ms, delegate: r.delegate }, true);
          env.invalidate();
        })
        .catch((err) => reportError(clip.id, err))
        .finally(() => stillsPending.delete(asset.id));
    }
  }
  if (choice.mask) {
    if (useVision.getState().cutout[clip.id]?.state !== 'ready') setStatus(clip.id, { state: 'ready' }, true);
    return show(clip.id, choice.key, 0, choice.mask, false);
  }
  return display.get(clip.id)?.frame ?? null;
}

/** Matte for a layer in the live preview (null = not available yet). */
export function previewMatte(clip: VisualClip, project: Project, env: PreviewMatteEnv): FrameImage | null {
  if ((clip.type !== 'video' && clip.type !== 'image') || !clip.cutout?.enabled) return null;
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  lastInvalidate = env.invalidate;
  if (project !== lastProject) {
    lastProject = project;
    pruneCutoutState(project);
  }
  if (clip.type === 'image') return previewStill(clip, asset, env);

  const frame = env.frame();
  const el = frame?.source;
  if (!frame || !(el instanceof HTMLVideoElement)) return display.get(clip.id)?.frame ?? null;
  const idx = frameIndex(asset, el.currentTime);
  const choice = pick((path) => videoKey(asset.id, path, idx), env.playing);

  if (choice.compute && !inflight.has(clip.id)) {
    const target = videoKey(asset.id, choice.compute, idx);
    inflight.add(clip.id);
    if (!display.has(clip.id)) setStatus(clip.id, { state: 'loading' }, true);
    segmentSource(el, frame.width, frame.height, choice.compute === 'f')
      .then((r) => {
        cacheSet(target, { data: r.mask, w: r.w, h: r.h });
        setStatus(clip.id, { state: 'ready', ms: r.ms, delegate: r.delegate });
        env.invalidate();
      })
      .catch((err) => reportError(clip.id, err))
      .finally(() => inflight.delete(clip.id));
  }
  if (choice.mask) return show(clip.id, choice.key, idx, choice.mask, env.playing);
  return display.get(clip.id)?.frame ?? null;
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

const exportFrames = new Map<ID, FrameImage>();
const exportKeys = new Map<ID, string>();

/**
 * Compute (or fetch from the cache) the matte of the frame the exporter is about to render.
 * Call after the clip's frame has been decoded; `exportMatte` then returns it synchronously.
 */
export async function prepareExportMatte(clip: VisualClip, project: Project, frame: FrameImage | null, sourceTime: number): Promise<void> {
  if ((clip.type !== 'video' && clip.type !== 'image') || !clip.cutout?.enabled || !frame) return;
  const asset = project.assets[clip.assetId];
  if (!asset) return;
  const key = clip.type === 'image' ? stillKey(asset.id, 'x') : videoKey(asset.id, 'x', frameIndex(asset, sourceTime));
  if (exportKeys.get(clip.id) === key && exportFrames.has(clip.id)) return;
  let mask = cacheGet(key);
  if (!mask) {
    const r = await segmentSource(frame.source as CanvasImageSource, frame.width, frame.height, true);
    mask = { data: r.mask, w: r.w, h: r.h };
    cacheSet(key, mask);
  }
  exportFrames.set(clip.id, toFrame(mask.data, mask.w, mask.h));
  exportKeys.set(clip.id, key);
}

/** Matte prepared for the current export frame. */
export function exportMatte(clip: VisualClip): FrameImage | null {
  return exportFrames.get(clip.id) ?? null;
}

/** Release per-export state. */
export function endExportMattes(): void {
  exportFrames.clear();
  exportKeys.clear();
}

/** Forget preview state of clips that no longer exist / no longer use a cutout. */
export function pruneCutoutState(project: Project): void {
  for (const id of [...display.keys()]) {
    const c = project.clips[id] as VideoClip | ImageClip | undefined;
    if (!c || !c.cutout?.enabled) display.delete(id);
  }
}

export const isCutoutClip = (clip: VisualClip): boolean => (clip.type === 'video' || clip.type === 'image') && !!clip.cutout?.enabled;
