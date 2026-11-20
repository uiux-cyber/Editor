/**
 * Animated media assets (kind 'animation') at runtime.
 *
 * - Animated GIF / WebP / APNG are decoded with WebCodecs' ImageDecoder. Every frame (with its
 *   own duration) becomes an ImageBitmap in a cache shared by all assets and capped in memory:
 *   very large pictures are downscaled, the least recently used frames are evicted and decoded
 *   again on demand.
 * - Lottie documents (.json, or .lottie archives) render with lottie-web's canvas renderer,
 *   frame-accurately (goToAndStop on fractional frames) at the size the layer needs, so they stay
 *   crisp at any export resolution.
 *
 * - Motion clips (.kmotion) are animation code rendered frame by frame in a sandboxed frame
 *   (motion.ts).
 *
 * `animationFrame()` is synchronous (preview, thumbnails); `ensureAnimationFrame()` awaits the
 * exact frame (export). Both loop the animation forever.
 */

import { buildTimeline, frameIndexAt, lottieFrameAt, normalizeFrameDelay, validateLottie, type FrameTimeline, type LottieInfo } from '@/core/animTiming';
import type { ID, MediaAsset } from '@/core/types';
import { api } from '@/platform/api';
import type { FrameImage } from '../compositor';
import { readDotLottie } from './dotlottie';
import { MotionAnimation } from './motion';
import { motionValuesKey } from '@shared/motion';

export type AnimationFormat = NonNullable<MediaAsset['format']>;

/** Desired picture size in real pixels (from the compositor), used by vector (Lottie) sources. */
export interface SizeHint {
  width: number;
  height: number;
}

/** A readable reason why an animation could not be imported. */
export class AnimationError extends Error {}

/** File extensions that may hold an animation (still GIF / WebP / PNG files stay images). */
export const ANIMATION_CANDIDATE_EXTS = ['gif', 'webp', 'png', 'apng', 'json', 'lottie', 'kmotion'];

const RASTER_MIME: Record<string, string> = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', apng: 'image/png' };

/** Total memory for decoded frames of all animated images. */
const FRAME_BUDGET = 640 * 1024 * 1024;
/** Longest cached frame edge; bigger animations are downscaled. */
const MAX_FRAME_EDGE = 2048;
/** Recently used frames are never evicted (the ones being drawn or exported right now). */
const PROTECT_RECENT = 96;
/** Largest Lottie render edge. */
const MAX_LOTTIE_EDGE = 4096;

let versionSeq = 1;
let useClock = 0;
let frameBytes = 0;
const listeners = new Set<() => void>();
let notifyQueued = false;

function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((cb) => cb());
  });
}

/** Called when new frames become available (decoded, loaded); the preview repaints. */
export function onAnimationUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------------------------
// Animated GIF / WebP / APNG
// ---------------------------------------------------------------------------------------------

interface FrameSlot {
  bitmap: ImageBitmap | null;
  pending: Promise<void> | null;
  version: number;
  lastUsed: number;
}

class RasterAnimation {
  readonly kind = 'raster' as const;
  format: AnimationFormat = 'gif';
  width = 0;
  height = 0;
  /** Cached frame size (downscaled for very large animations). */
  cacheW = 0;
  cacheH = 0;
  frameCount = 0;
  timeline: FrameTimeline | null = null;
  /** Start times known so far while the first decoding pass runs. */
  private partialStarts: number[] = [];
  private decodedUntil = 0;
  slots: FrameSlot[] = [];
  still = false;
  failed = false;
  readonly ready: Promise<void>;
  private decoder: ImageDecoder | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  readonly url: string;

  constructor(
    readonly path: string,
    ext: string,
  ) {
    this.url = api.media.toUrl(path);
    this.ready = this.open(ext).catch((err) => {
      this.failed = true;
      if (err instanceof AnimationError) throw err;
      throw new AnimationError(`The animation could not be decoded (${(err as Error).message ?? err}).`);
    });
  }

  private async open(ext: string): Promise<void> {
    if (typeof ImageDecoder === 'undefined') throw new AnimationError('Animated images are not supported on this PC.');
    const type = RASTER_MIME[ext] ?? 'image/gif';
    if (!(await ImageDecoder.isTypeSupported(type))) throw new AnimationError(`${ext.toUpperCase()} animations cannot be decoded on this PC.`);
    const res = await fetch(this.url);
    if (!res.ok) throw new AnimationError('The file could not be read.');
    const data = await res.arrayBuffer();
    const decoder = new ImageDecoder({ data, type, preferAnimation: true });
    this.decoder = decoder;
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated) {
      this.still = true;
      return;
    }
    await decoder.completed;
    const count = track.frameCount;
    if (count <= 1) {
      this.still = true;
      return;
    }
    this.frameCount = count;
    this.format = ext === 'gif' ? 'gif' : ext === 'webp' ? 'webp' : 'apng';
    this.slots = Array.from({ length: count }, () => ({ bitmap: null, pending: null, version: 0, lastUsed: 0 }));
    // First pass, in order (the fast path for these decoders): frame durations + the cache.
    const durations: number[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      if (this.disposed) return;
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        if (i === 0) this.setSize(image.displayWidth, image.displayHeight);
        const d = normalizeFrameDelay((image.duration ?? 0) / 1e6);
        durations.push(d);
        this.partialStarts.push(t);
        t += d;
        if (frameBytes + this.cacheW * this.cacheH * 4 <= FRAME_BUDGET || i < 2) await this.store(i, image);
      } finally {
        image.close();
      }
      this.decodedUntil = t;
      if (i % 6 === 5) notify();
    }
    this.timeline = buildTimeline(durations);
    notify();
  }

  private setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const k = Math.min(1, MAX_FRAME_EDGE / Math.max(1, w, h));
    this.cacheW = Math.max(1, Math.round(w * k));
    this.cacheH = Math.max(1, Math.round(h * k));
  }

  private async store(i: number, image: VideoFrame): Promise<void> {
    const bitmap = await createImageBitmap(image, { resizeWidth: this.cacheW, resizeHeight: this.cacheH, resizeQuality: 'high', premultiplyAlpha: 'premultiply' });
    const slot = this.slots[i];
    if (this.disposed || !slot) {
      bitmap.close();
      return;
    }
    if (slot.bitmap) {
      bitmap.close();
      return;
    }
    slot.bitmap = bitmap;
    slot.version = versionSeq++;
    slot.lastUsed = ++useClock;
    frameBytes += bitmap.width * bitmap.height * 4;
    evictFrames();
  }

  /** Frame index shown at `time` (during the first pass: the latest decoded frame up to then). */
  indexAt(time: number, loop: number): number {
    if (this.timeline) return frameIndexAt(this.timeline, time);
    const starts = this.partialStarts;
    if (starts.length === 0) return -1;
    let t = loop > 0 ? time % loop : time;
    if (t < 0) t += loop;
    let i = starts.length - 1;
    while (i > 0 && starts[i] > t + 1e-9) i--;
    return i;
  }

  /** Decode frame `i` into the cache (serialised; random access is supported by ImageDecoder). */
  decode(i: number): Promise<void> {
    const slot = this.slots[i];
    if (!slot || slot.bitmap || !this.decoder) return Promise.resolve();
    if (slot.pending) return slot.pending;
    const job = this.chain.then(async () => {
      if (slot.bitmap || this.disposed || !this.decoder) return;
      const { image } = await this.decoder.decode({ frameIndex: i });
      try {
        await this.store(i, image);
      } finally {
        image.close();
      }
    });
    slot.pending = job
      .catch(() => undefined)
      .finally(() => {
        slot.pending = null;
        notify();
      });
    this.chain = slot.pending;
    return slot.pending;
  }

  frame(i: number): FrameImage | null {
    const slot = this.slots[i];
    if (!slot?.bitmap) return null;
    slot.lastUsed = ++useClock;
    return { source: slot.bitmap, width: slot.bitmap.width, height: slot.bitmap.height, version: slot.version, animated: true };
  }

  /** Synchronous lookup for the preview: the frame, or the nearest earlier decoded one while it loads. */
  frameAt(time: number, loop: number): FrameImage | null {
    if (this.still || this.failed) return null;
    const i = this.indexAt(time, loop);
    if (i < 0) return null;
    const hit = this.frame(i);
    if (this.timeline) {
      // Keep a few frames ahead decoded for smooth playback.
      for (let k = hit ? 1 : 0; k <= 3; k++) void this.decode((i + k) % this.frameCount);
    }
    if (hit) return hit;
    for (let j = 1; j < Math.min(this.frameCount, 60); j++) {
      const prev = this.slots[(i - j + this.frameCount) % this.frameCount];
      if (prev?.bitmap) return this.frame((i - j + this.frameCount) % this.frameCount);
    }
    return null;
  }

  async ensure(time: number, loop: number): Promise<void> {
    await this.ready;
    if (this.still) return;
    const i = this.indexAt(time, loop);
    if (i < 0) return;
    await this.decode(i);
    const slot = this.slots[i];
    if (slot) slot.lastUsed = ++useClock;
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots) {
      if (s.bitmap) {
        frameBytes -= s.bitmap.width * s.bitmap.height * 4;
        s.bitmap.close();
        s.bitmap = null;
      }
    }
    try {
      this.decoder?.close();
    } catch {
      /* already closed */
    }
    this.decoder = null;
  }
}

/** Drop the least recently used frames (of any asset) until the cache fits its budget again. */
function evictFrames(): void {
  if (frameBytes <= FRAME_BUDGET) return;
  const candidates: { slot: FrameSlot }[] = [];
  for (const src of sources.values()) {
    if (src.kind !== 'raster') continue;
    for (const slot of src.slots) if (slot.bitmap && slot.lastUsed < useClock - PROTECT_RECENT) candidates.push({ slot });
  }
  candidates.sort((a, b) => a.slot.lastUsed - b.slot.lastUsed);
  const target = FRAME_BUDGET * 0.85;
  for (const { slot } of candidates) {
    if (frameBytes <= target) break;
    const bmp = slot.bitmap!;
    frameBytes -= bmp.width * bmp.height * 4;
    bmp.close();
    slot.bitmap = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Lottie
// ---------------------------------------------------------------------------------------------

type LottieItem = import('lottie-web').AnimationItem;

let lottieModule: Promise<typeof import('lottie-web').default> | null = null;
const loadLottieLib = (): Promise<typeof import('lottie-web').default> =>
  (lottieModule ??= import('lottie-web/build/player/lottie_light_canvas').then((m) => (m as unknown as { default: typeof import('lottie-web').default }).default));

interface LottieCanvasRenderer {
  renderFrame(frame: number, force?: boolean): void;
  contextData?: Record<string, unknown>;
}
const lottieRenderer = (anim: LottieItem): LottieCanvasRenderer | null => (anim as unknown as { renderer?: LottieCanvasRenderer }).renderer ?? null;

/**
 * lottie-web's canvas renderer remembers the fill / stroke / line / alpha state it last applied
 * to the 2D context and skips setting it again. Resizing the canvas resets the real context
 * state, so that memory must be cleared too — otherwise fills come out black after a resize.
 */
function forgetAppliedCanvasState(anim: LottieItem): void {
  const cd = lottieRenderer(anim)?.contextData;
  if (!cd) return;
  for (const k of ['FillStyle', 'StrokeStyle', 'LineWidth', 'LineCap', 'LineJoin', 'MiterLimit']) cd[`applied${k}`] = '';
  cd.currentOpacity = 1;
}

class LottieAnimation {
  readonly kind = 'lottie' as const;
  readonly format: AnimationFormat = 'lottie';
  info: LottieInfo | null = null;
  failed = false;
  readonly ready: Promise<void>;
  private anim: LottieItem | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private key = '';
  private version = 0;

  readonly url: string;

  constructor(
    readonly path: string,
    ext: string,
  ) {
    this.url = api.media.toUrl(path);
    this.ready = this.open(ext).catch((err) => {
      this.failed = true;
      if (err instanceof AnimationError) throw err;
      throw new AnimationError(`The Lottie animation could not be loaded (${(err as Error).message ?? err}).`);
    });
  }

  private async open(ext: string): Promise<void> {
    // The main process only serves JSON / .lottie files that are Lottie animations; ask first so
    // other JSON files are refused without a failed request.
    if (!(await api.call<boolean>('x:graphics:isLottie', this.path))) {
      throw new AnimationError(ext === 'json' ? 'This JSON file is not a Lottie animation.' : 'This file is not a Lottie animation.');
    }
    const res = await fetch(this.url);
    if (!res.ok) throw new AnimationError('The file could not be read.');
    let doc: unknown;
    try {
      doc = ext === 'lottie' ? await readDotLottie(await res.arrayBuffer()) : JSON.parse(await res.text());
    } catch (err) {
      throw new AnimationError(ext === 'lottie' ? `The .lottie archive could not be read (${(err as Error).message}).` : 'The JSON file could not be parsed.');
    }
    const info = validateLottie(doc);
    if (typeof info === 'string') throw new AnimationError(info);
    this.info = info;
    const lottie = await loadLottieLib();
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AnimationError('2D canvas is unavailable.');
    this.canvas = canvas;
    const anim = lottie.loadAnimation({
      container: undefined as unknown as Element,
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: doc,
      rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet', dpr: 1 },
    });
    this.anim = anim;
    await new Promise<void>((resolve, reject) => {
      if (anim.isLoaded) return resolve();
      const timer = setTimeout(() => reject(new Error('timed out')), 15000);
      anim.addEventListener('DOMLoaded', () => {
        clearTimeout(timer);
        resolve();
      });
      anim.addEventListener('data_failed', () => {
        clearTimeout(timer);
        reject(new Error('invalid animation data'));
      });
    });
    // Embedded images load asynchronously; wait so every frame (and the export) is complete.
    const preloader = (anim as unknown as { imagePreloader?: { loadedImages(): boolean } }).imagePreloader;
    for (let i = 0; i < 200 && preloader && !preloader.loadedImages(); i++) await new Promise((r) => setTimeout(r, 25));
    notify();
  }

  private sizeFor(hint?: SizeHint): { w: number; h: number } {
    const info = this.info!;
    let k: number;
    if (hint && hint.width > 0 && hint.height > 0) k = Math.min(hint.width / info.width, hint.height / info.height);
    else k = Math.min(1, 1024 / Math.max(info.width, info.height));
    k = Math.min(k, MAX_LOTTIE_EDGE / Math.max(info.width, info.height));
    return { w: Math.max(8, Math.round(info.width * k)), h: Math.max(8, Math.round(info.height * k)) };
  }

  frameAt(time: number, hint?: SizeHint): FrameImage | null {
    if (!this.anim || !this.canvas || !this.info) return null;
    const { w, h } = this.sizeFor(hint);
    const f = lottieFrameAt(this.info, time);
    const key = `${w}x${h}@${f.toFixed(4)}`;
    if (key !== this.key) {
      try {
        const resized = this.canvas.width !== w || this.canvas.height !== h;
        if (resized) {
          this.anim.resize(w, h);
          forgetAppliedCanvasState(this.anim);
        }
        this.anim.goToAndStop(f, true);
        // After a resize every layer must be drawn again, changed or not.
        if (resized) lottieRenderer(this.anim)?.renderFrame(this.anim.currentFrame + this.anim.firstFrame, true);
      } catch (err) {
        if (!this.failed) console.warn('[animation] Lottie frame failed', err);
        this.failed = true;
        return null;
      }
      this.key = key;
      this.version = versionSeq++;
    }
    return { source: this.canvas, width: w, height: h, version: this.version, animated: true };
  }

  dispose(): void {
    try {
      this.anim?.destroy();
    } catch {
      /* already destroyed */
    }
    this.anim = null;
    this.canvas = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

type AnimationSource = RasterAnimation | LottieAnimation | MotionAnimation;

const sources = new Map<ID, AnimationSource>();

/**
 * Motion clips run one version per set of settings in use, so the preview, an export of an older
 * snapshot and a thumbnail can ask for different settings at once without restarting each other.
 * A version nobody has asked for in a while is closed (the latest one per clip always stays).
 */
interface MotionEntry {
  src: MotionAnimation;
  key: string;
  used: number;
}
const motionSources = new Map<ID, MotionEntry[]>();
/** Settings still being edited (typing, dragging a slider): the latest version stays until they settle. */
const SETTLE_MS = 250;
const IDLE_MS = 15000;
const settling = new Map<ID, { key: string; since: number }>();

const extOfPath = (p: string): string => {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i + 1).toLowerCase();
};

function createSource(path: string, ext: string): AnimationSource {
  if (ext === 'kmotion') return new MotionAnimation(path, notify);
  return ext === 'json' || ext === 'lottie' ? new LottieAnimation(path, ext) : new RasterAnimation(path, ext);
}

let usable: (assetId: ID) => boolean = () => true;
/** assets.ts reports which assets are online, so missing (or still checking) files are never requested. */
export function setAnimationAvailability(fn: (assetId: ID) => boolean): void {
  usable = fn;
}

const motionKey = (path: string, values: Record<string, unknown> | undefined): string => `${path}|${motionValuesKey(values)}`;

const newest = (list: MotionEntry[], except?: MotionEntry): MotionEntry | undefined =>
  list.filter((e) => e !== except && !e.src.failed).sort((a, b) => b.used - a.used)[0];

/** Close the versions of a clip nobody has used for a while. */
function pruneMotion(assetId: ID): void {
  const list = motionSources.get(assetId);
  if (!list || list.length < 2) return;
  const now = performance.now();
  const latest = list.reduce((a, b) => (b.used > a.used ? b : a));
  const keep = list.filter((e) => e === latest || e.src.busy || now - e.used < IDLE_MS);
  for (const e of list) if (!keep.includes(e)) e.src.dispose();
  motionSources.set(assetId, keep);
}

/**
 * The running version of a Motion clip with this asset's settings. `exact` (export, posters):
 * always those settings. Otherwise, while the settings are still being edited, the latest
 * running version is returned until the edit settles.
 */
function motionSourceFor(asset: MediaAsset, exact: boolean): MotionAnimation | null {
  if (asset.source.type !== 'file') return null;
  const path = asset.source.path;
  const key = motionKey(path, asset.motionValues);
  const list = motionSources.get(asset.id) ?? [];
  if (!list.length && !usable(asset.id)) return null;
  const now = performance.now();
  let entry = list.find((e) => e.key === key);
  if (!entry) {
    const latest = newest(list);
    if (!exact && latest) {
      let s = settling.get(asset.id);
      if (!s || s.key !== key) settling.set(asset.id, (s = { key, since: now }));
      const wait = SETTLE_MS - (now - s.since);
      if (wait > 0) {
        setTimeout(notify, wait + 5);
        latest.used = now;
        return latest.src;
      }
    }
    settling.delete(asset.id);
    const src = new MotionAnimation(path, notify, undefined, asset.motionValues);
    src.ready.catch(() => undefined).finally(notify);
    entry = { src, key, used: now };
    list.push(entry);
    motionSources.set(asset.id, list);
  }
  entry.used = now;
  pruneMotion(asset.id);
  return entry.src;
}

function sourceFor(asset: MediaAsset, exact = false): AnimationSource | null {
  if (asset.kind !== 'animation' || asset.source.type !== 'file') return null;
  const filePath = asset.source.path;
  const ext = asset.format === 'lottie' ? extOfPath(filePath) || 'json' : extOfPath(filePath) || asset.format || 'gif';
  if (ext === 'kmotion' || asset.format === 'motion') return motionSourceFor(asset, exact);
  let src = sources.get(asset.id);
  if (!src && !usable(asset.id)) return null;
  if (src && src.path !== filePath) {
    src.dispose();
    src = undefined;
  }
  if (!src) {
    src = createSource(filePath, ext);
    sources.set(asset.id, src);
    src.ready.catch(() => undefined).finally(notify);
  }
  return src;
}

/** Frame of a Motion clip; while a new version starts, the frame of another running version. */
function motionFrame(assetId: ID, src: MotionAnimation, time: number): FrameImage | null {
  const frame = src.frameAt(time);
  if (frame || src.failed) return frame;
  const list = motionSources.get(assetId) ?? [];
  const self = list.find((e) => e.src === src);
  const other = newest(list, self);
  return other ? other.src.frameAt(time) : null;
}

export interface ProbedAnimation {
  format: AnimationFormat;
  /** Display name stored in the file (Motion clips), instead of the file name. */
  name?: string;
  width: number;
  height: number;
  /** Seconds in one loop. */
  duration: number;
  fps: number;
  frames: number;
  /** A representative frame for the media bin poster. */
  poster: CanvasImageSource | null;
  posterW: number;
  posterH: number;
  /** The loaded source; hand it to `adoptAnimation` once the asset exists. */
  handle: unknown;
}

/**
 * Open a file as an animation. Resolves null for still images (a GIF / WebP / PNG with a
 * single frame), throws AnimationError for unusable files (e.g. a JSON that is not a Lottie).
 */
export async function probeAnimation(path: string, ext: string): Promise<ProbedAnimation | null> {
  const src = createSource(path, ext);
  try {
    await src.ready;
  } catch (err) {
    src.dispose();
    // A broken GIF / WebP / PNG falls back to the plain image importer.
    if (src.kind === 'raster') return null;
    if (src.kind === 'motion') throw new AnimationError(`The Motion clip could not run: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  if (src.kind === 'raster') {
    if (src.still || !src.timeline) {
      src.dispose();
      return null;
    }
    const first = src.frame(0);
    return {
      format: src.format,
      width: src.width,
      height: src.height,
      duration: src.timeline.total,
      fps: src.timeline.total > 0 ? src.frameCount / src.timeline.total : 0,
      frames: src.frameCount,
      poster: (first?.source as CanvasImageSource) ?? null,
      posterW: first?.width ?? 0,
      posterH: first?.height ?? 0,
      handle: src,
    };
  }
  if (src.kind === 'motion') {
    const meta = src.info!;
    try {
      await src.ensure(meta.duration * 0.4);
    } catch (err) {
      src.dispose();
      throw new AnimationError(`The Motion clip could not run: ${err instanceof Error ? err.message : String(err)}`);
    }
    const frame = src.frameAt(meta.duration * 0.4);
    return {
      format: 'motion',
      name: meta.name,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      fps: meta.fps,
      frames: Math.round(meta.duration * meta.fps),
      poster: (frame?.source as CanvasImageSource) ?? null,
      posterW: frame?.width ?? 0,
      posterH: frame?.height ?? 0,
      handle: src,
    };
  }
  const info = src.info!;
  const posterFrame = src.frameAt(info.duration * 0.4, { width: 640, height: 640 });
  return {
    format: 'lottie',
    width: info.width,
    height: info.height,
    duration: info.duration,
    fps: info.fps,
    frames: Math.round(info.frames),
    poster: (posterFrame?.source as CanvasImageSource) ?? null,
    posterW: posterFrame?.width ?? 0,
    posterH: posterFrame?.height ?? 0,
    handle: src,
  };
}

/** Keep the source opened by `probeAnimation` for the imported asset (no second decode). */
export function adoptAnimation(assetId: ID, probed: ProbedAnimation): void {
  const src = probed.handle as AnimationSource;
  if (src.kind === 'motion') {
    for (const e of motionSources.get(assetId) ?? []) e.src.dispose();
    motionSources.set(assetId, [{ src, key: motionKey(src.path, src.values), used: performance.now() }]);
    return;
  }
  sources.get(assetId)?.dispose();
  sources.set(assetId, src);
}

/** Release a probe that was not imported (duplicate, failure). */
export function discardProbe(probed: ProbedAnimation): void {
  (probed.handle as AnimationSource).dispose();
}

/** Frame of an animated asset at `time` seconds (loops). Null while it is still loading. */
export function animationFrame(asset: MediaAsset, time: number, hint?: SizeHint): FrameImage | null {
  const src = sourceFor(asset);
  if (!src || src.failed) return null;
  if (src.kind === 'raster') return src.frameAt(time, asset.duration);
  if (src.kind === 'motion') return motionFrame(asset.id, src, time);
  return src.frameAt(time, hint);
}

/** Wait until the exact frame at `time` is available (export). */
export async function ensureAnimationFrame(asset: MediaAsset, time: number): Promise<void> {
  const src = sourceFor(asset, true);
  if (!src) return;
  try {
    if (src.kind === 'raster') await src.ensure(time, asset.duration);
    else if (src.kind === 'motion') await src.ensure(time);
    else await src.ready;
  } catch (err) {
    // A Motion clip that fails stops the export with its reason (it is content, not decoration).
    if (src.kind === 'motion') throw new Error(`Motion clip “${asset.name}”: ${err instanceof Error ? err.message : String(err)}`);
    /* a broken animation renders as nothing, like a missing image */
  }
}

/** Open every animated asset before an export starts. */
export async function preloadAnimations(assets: MediaAsset[]): Promise<void> {
  await Promise.all(assets.map((a) => sourceFor(a, true)?.ready.catch(() => undefined)));
}

/** A poster frame of an animated asset (media bin thumbnails when a project is reopened). */
export async function animationPoster(asset: MediaAsset): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  const src = sourceFor(asset, true);
  if (!src) return null;
  await src.ready;
  if (src.kind === 'raster') {
    await src.ensure(0, asset.duration);
    const f = src.frame(0);
    return f ? { source: f.source as CanvasImageSource, width: f.width, height: f.height } : null;
  }
  if (src.kind === 'motion') {
    // A clip that fails shows no poster (it is not a missing file).
    const ok = await src.ensure(asset.duration * 0.4).then(() => true, () => false);
    const m = ok ? src.frameAt(asset.duration * 0.4) : null;
    return m ? { source: m.source as CanvasImageSource, width: m.width, height: m.height } : null;
  }
  const f = src.frameAt(asset.duration * 0.4, { width: 640, height: 640 });
  return f ? { source: f.source as CanvasImageSource, width: f.width, height: f.height } : null;
}

/** Free the decoded frames / renderer of an asset (removed from the project). */
export function forgetAnimation(assetId: ID): void {
  sources.get(assetId)?.dispose();
  sources.delete(assetId);
  for (const e of motionSources.get(assetId) ?? []) e.src.dispose();
  motionSources.delete(assetId);
  settling.delete(assetId);
}

/** Memory currently used by decoded animation frames, bytes (diagnostics). */
export const animationCacheBytes = (): number => frameBytes;

/** Drop every source (a different project was opened). */
export function resetAnimations(): void {
  for (const src of sources.values()) src.dispose();
  sources.clear();
  for (const list of motionSources.values()) for (const e of list) e.src.dispose();
  motionSources.clear();
  settling.clear();
}
