/**
 * Motion clips at runtime (editor side). Each clip runs in its own sandboxed frame
 * (kinora://motion/frame.html, see src/motion/runtime.ts): Kinora sends the code once, then asks
 * for frames by time and gets ImageBitmaps back. Frames are cached (recent ones), prefetched
 * ahead of the playhead, and can be awaited exactly for export.
 *
 * Used by animated.ts as the 'motion' animation format, so a Motion clip behaves like any other
 * animated image on the timeline (and in exports, thumbnails and the render cache).
 */

import type { MediaAsset } from '@/core/types';
import { api } from '@/platform/api';
import { getRootProject } from '@/store/project';
import { MOTION_FRAME_URL, motionParamValues, normalizeMotionMeta, parseMotionFile, type MotionMeta, type MotionValue } from '@shared/motion';
import type { FrameImage } from '../compositor';

export class MotionError extends Error {}

/** A clip that takes longer than this for one frame (or to start) is stopped. */
const FRAME_TIMEOUT_MS = 15000;
const INIT_TIMEOUT_MS = 30000;
/** Frames kept per clip. */
const CACHE_FRAMES = 18;
/** Frames rendered ahead of the playhead. */
const PREFETCH = 3;

type Reply = { id: number; type: string; ok?: boolean; error?: string; bitmap?: ImageBitmap };

const runtimes = new Map<MessageEventSource, MotionRuntime>();
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const rt = e.source ? runtimes.get(e.source) : undefined;
    const d = e.data as (Reply & { __kinoraMotion?: boolean; level?: string; text?: string }) | null;
    if (!rt || !d || d.__kinoraMotion !== true) return;
    rt.onMessage(d);
  });
}

/** One sandboxed frame running one clip. */
export class MotionRuntime {
  private readonly iframe: HTMLIFrameElement;
  private readonly started: Promise<void>;
  private startedOk!: () => void;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly logs: string[] = [];
  disposed = false;

  constructor() {
    listen();
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.title = 'Motion clip renderer';
    Object.assign(f.style, { position: 'fixed', left: '-30000px', top: '0', width: '8px', height: '8px', border: '0', opacity: '0', pointerEvents: 'none' });
    this.started = new Promise<void>((resolve, reject) => {
      this.startedOk = resolve;
      setTimeout(() => reject(new MotionError('The motion runtime did not start.')), INIT_TIMEOUT_MS);
    });
    this.started.catch(() => undefined);
    f.src = MOTION_FRAME_URL;
    document.body.appendChild(f);
    this.iframe = f;
    runtimes.set(f.contentWindow!, this);
  }

  onMessage(d: Reply & { level?: string; text?: string }): void {
    if (d.type === 'ready') this.startedOk();
    else if (d.type === 'log') {
      this.logs.push(`[${d.level}] ${d.text}`);
      if (this.logs.length > 60) this.logs.shift();
    } else if (typeof d.id === 'number') {
      const w = this.waiting.get(d.id);
      if (!w) return;
      this.waiting.delete(d.id);
      clearTimeout(w.timer);
      w.resolve(d);
    }
  }

  private async send(msg: Record<string, unknown>, transfer: Transferable[], timeout: number, what: string): Promise<Reply> {
    if (this.disposed) throw new MotionError('The clip was closed.');
    // A message posted before the sandbox page has loaded is lost: wait for its "ready".
    await this.started;
    if (this.disposed) throw new MotionError('The clip was closed.');
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        const why = `${what} took longer than ${timeout / 1000} s.`;
        reject(new MotionError(why));
        // A clip that hangs is stopped: its frame (and process) go away.
        this.dispose(why);
      }, timeout);
      this.waiting.set(id, { resolve, timer });
      const trace = (globalThis as { __kinoraTraceMotion?: boolean }).__kinoraTraceMotion === true;
      this.iframe.contentWindow!.postMessage({ __kinoraMotion: true, id, ...msg, ...(trace ? { trace } : {}) }, '*', transfer);
    });
  }

  async init(code: string, meta: MotionMeta, images: Record<string, ImageBitmap>, params: Record<string, MotionValue | ImageBitmap | null> = {}): Promise<void> {
    const transfer = [...Object.values(images), ...Object.values(params).filter((v): v is ImageBitmap => v instanceof ImageBitmap)];
    const r = await this.send({ type: 'init', code, meta, images, params }, transfer, INIT_TIMEOUT_MS, 'Starting the clip');
    if (!r.ok) throw new MotionError(r.error ?? 'The clip could not be started.');
  }

  async render(t: number): Promise<ImageBitmap> {
    const r = await this.send({ type: 'render', t }, [], FRAME_TIMEOUT_MS, 'Rendering a frame');
    if (r.error || !r.bitmap) throw new MotionError(r.error ?? 'The clip returned no picture.');
    return r.bitmap;
  }

  dispose(why = 'The clip was closed.'): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.resolve({ id: -1, type: 'frame', error: why === 'The clip was closed.' ? why : `The clip was stopped: ${why}` });
    }
    this.waiting.clear();
    if (this.iframe.contentWindow) runtimes.delete(this.iframe.contentWindow);
    this.iframe.remove();
  }
}

/** A project picture as an ImageBitmap (null when it is not an image or cannot be read). */
async function loadImage(id: string): Promise<ImageBitmap | null> {
  const a: MediaAsset | undefined = id ? getRootProject().assets[id] : undefined;
  if (!a || a.source.type !== 'file' || (a.kind !== 'image' && a.kind !== 'animation') || a.format === 'motion') return null;
  try {
    const res = await fetch(api.media.toUrl(a.source.path));
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/** Project images a clip asked for (meta.images: name → asset id), as ImageBitmaps. */
async function loadImages(map: Record<string, string> | undefined): Promise<Record<string, ImageBitmap>> {
  const out: Record<string, ImageBitmap> = {};
  if (!map) return out;
  await Promise.all(
    Object.entries(map).map(async ([name, id]) => {
      const bmp = await loadImage(id);
      if (bmp) out[name] = bmp; // missing image: the clip sees undefined
    }),
  );
  return out;
}

/** The clip's settings with the chosen values; image settings become pictures (or null). */
async function resolveParams(meta: MotionMeta, chosen: Record<string, unknown> | undefined): Promise<Record<string, MotionValue | ImageBitmap | null>> {
  const values: Record<string, MotionValue | ImageBitmap | null> = motionParamValues(meta.params, chosen);
  await Promise.all(
    (meta.params ?? [])
      .filter((p) => p.type === 'image')
      .map(async (p) => {
        values[p.id] = await loadImage(String(values[p.id] ?? ''));
      }),
  );
  return values;
}

const DEFAULTS = { width: 1920, height: 1080, fps: 30 };
const live = new Set<MotionAnimation>();

/** Recently closed clips and where they were closed from (diagnostics). */
const closed: { path: string; values: string; at: number; from: string }[] = [];

/** State of every open Motion clip, and the last ones closed (diagnostics, tests). */
export function motionDebug(): { path: string; failed: boolean; error: string | null; cached: number[]; ready: boolean }[] & { closed?: typeof closed } {
  return Object.assign([...live].map((m) => m.debug()), { closed: closed.slice() });
}
let versionSeq = 1;
let useClock = 0;

/** A Motion clip as an animation source (animated.ts). */
export class MotionAnimation {
  readonly kind = 'motion' as const;
  readonly format = 'motion' as const;
  info: MotionMeta | null = null;
  failed = false;
  /** Why the clip failed to load, or the last frame error. */
  error: string | null = null;
  readonly ready: Promise<void>;
  private rt: MotionRuntime | null = null;
  private readonly cache = new Map<number, { bitmap: ImageBitmap; version: number; used: number }>();
  /** Frames waiting to be rendered, most wanted first, and who waits for each. */
  private queue: number[] = [];
  private readonly waiters = new Map<number, Array<() => void>>();
  private readonly rendering = new Set<number>();
  /** Frames something awaits exactly (export, previews): never dropped from the queue. */
  private readonly urgent = new Set<number>();
  private latest = 0;

  /**
   * From a .kmotion file, or (validation) from code and meta directly. `values` are the settings
   * chosen for this clip in the project (MediaAsset.motionValues); missing ones use the defaults.
   */
  constructor(
    readonly path: string,
    private readonly onFrame: () => void,
    direct?: { code: string; meta: MotionMeta },
    readonly values?: Record<string, MotionValue>,
  ) {
    live.add(this);
    this.ready = this.open(direct).catch((err) => {
      this.failed = true;
      this.error = err instanceof Error ? err.message : String(err);
      this.rt?.dispose();
      throw err instanceof MotionError ? err : new MotionError(this.error);
    });
  }

  private loaded = false;

  private readonly born = Math.round(performance.now());

  debug(): { path: string; failed: boolean; error: string | null; cached: number[]; ready: boolean; values: string; born: number; queue: number[]; rendering: number[]; waiting: number; latest: number; logs?: string[] } {
    return {
      path: this.path,
      failed: this.failed,
      error: this.error,
      cached: [...this.cache.keys()].sort((a, b) => a - b),
      ready: this.loaded,
      values: JSON.stringify(this.values ?? {}),
      born: this.born,
      queue: this.queue.slice(),
      rendering: [...this.rendering],
      waiting: this.waiters.size,
      latest: this.latest,
      logs: this.logs.slice(-10),
    } as ReturnType<MotionAnimation['debug']>;
  }

  get logs(): string[] {
    return this.rt?.logs ?? [];
  }

  /** Starting, rendering, or awaited by someone (an export): not to be closed. */
  get busy(): boolean {
    return (!this.loaded && !this.failed) || this.rendering.size > 0 || this.waiters.size > 0 || this.urgent.size > 0;
  }

  private async open(direct?: { code: string; meta: MotionMeta }): Promise<void> {
    let code: string;
    let meta: MotionMeta;
    if (direct) {
      code = direct.code;
      meta = direct.meta;
    } else {
      const res = await fetch(api.media.toUrl(this.path));
      if (!res.ok) throw new MotionError('The motion clip could not be read.');
      const parsed = parseMotionFile(await res.text());
      code = parsed.code;
      meta = normalizeMotionMeta(parsed.meta, DEFAULTS);
    }
    this.info = meta;
    this.rt = new MotionRuntime();
    const [images, params] = await Promise.all([loadImages(meta.images), resolveParams(meta, this.values)]);
    await this.rt.init(code, meta, images, params);
    this.loaded = true;
    // Frames asked for while the clip was starting.
    this.pump();
    this.onFrame();
  }

  private frameCount(): number {
    return Math.max(1, Math.round(this.info!.duration * this.info!.fps));
  }

  /** Frame index shown at `time` (loops like other animations). */
  indexAt(time: number): number {
    const { duration, fps } = this.info!;
    const local = ((time % duration) + duration) % duration;
    return Math.min(this.frameCount() - 1, Math.floor(local * fps + 1e-6));
  }

  private image(idx: number): FrameImage | null {
    const hit = this.cache.get(idx);
    if (!hit) return null;
    hit.used = ++useClock;
    return { source: hit.bitmap, width: hit.bitmap.width, height: hit.bitmap.height, version: hit.version, animated: true };
  }

  private request(idx: number, urgent = false): Promise<void> {
    if (this.cache.has(idx)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const list = this.waiters.get(idx);
      if (list) list.push(resolve);
      else this.waiters.set(idx, [resolve]);
      if (!this.rendering.has(idx)) {
        const at = this.queue.indexOf(idx);
        if (at >= 0 && urgent) this.queue.splice(at, 1);
        if (at < 0 || urgent) {
          if (urgent) this.queue.unshift(idx);
          else this.queue.push(idx);
        }
      }
      this.pump();
    });
  }

  private settle(idx: number): void {
    const list = this.waiters.get(idx);
    this.waiters.delete(idx);
    list?.forEach((r) => r());
  }

  private pump(): void {
    // Frames far from the playhead (it moved on) are dropped; whoever waited for them is released.
    this.queue = this.queue.filter((i) => {
      if (Math.abs(i - this.latest) <= PREFETCH + 4 || this.urgent.has(i)) return true;
      this.settle(i);
      return false;
    });
    while (this.loaded && this.rendering.size < 2 && this.queue.length && this.rt && !this.rt.disposed) {
      const idx = this.queue.shift()!;
      this.rendering.add(idx);
      void this.rt
        .render(idx / this.info!.fps)
        .then((bitmap) => this.store(idx, bitmap))
        .catch((err: unknown) => {
          this.error = err instanceof Error ? err.message : String(err);
          if (this.rt?.disposed) this.failed = true;
        })
        .finally(() => {
          this.rendering.delete(idx);
          this.settle(idx);
          this.onFrame();
          this.pump();
        });
    }
    // A stopped clip renders nothing more: release everyone.
    if (this.failed || (this.rt?.disposed ?? false)) for (const i of [...this.waiters.keys()]) if (!this.rendering.has(i)) this.settle(i);
  }

  private store(idx: number, bitmap: ImageBitmap): void {
    this.cache.get(idx)?.bitmap.close();
    this.cache.set(idx, { bitmap, version: versionSeq++, used: ++useClock });
    if (this.cache.size > CACHE_FRAMES) {
      let oldest = -1;
      let at = Infinity;
      for (const [k, v] of this.cache) if (v.used < at && k !== this.latest) [oldest, at] = [k, v.used];
      if (oldest >= 0) {
        this.cache.get(oldest)!.bitmap.close();
        this.cache.delete(oldest);
      }
    }
  }

  /** Synchronous frame for the preview: the exact one when ready, else the nearest earlier one. */
  frameAt(time: number): FrameImage | null {
    if (!this.info || this.failed || !this.rt || !this.loaded) return null;
    const idx = this.indexAt(time);
    this.latest = idx;
    const exact = this.image(idx);
    void this.request(idx);
    const n = this.frameCount();
    for (let k = 1; k <= PREFETCH; k++) void this.request((idx + k) % n);
    if (exact) return exact;
    let best = -1;
    for (const k of this.cache.keys()) if (k <= idx && k > best) best = k;
    return best >= 0 ? this.image(best) : null;
  }

  /** Wait for the exact frame at `time` (export, thumbnails, Claude's previews). */
  async ensure(time: number): Promise<void> {
    await this.ready;
    const idx = this.indexAt(time);
    this.latest = idx;
    this.urgent.add(idx);
    try {
      await this.request(idx, true);
    } finally {
      this.urgent.delete(idx);
    }
    // Exports must not silently leave the clip out: report why the frame is missing.
    if (!this.cache.has(idx)) throw new MotionError(this.error ?? 'The clip could not render this frame.');
  }

  dispose(): void {
    if (live.has(this)) {
      closed.push({ path: this.path, values: JSON.stringify(this.values ?? {}), at: Math.round(performance.now()), from: (new Error().stack ?? '').split('\n').slice(2, 6).join(' < ') });
      if (closed.length > 12) closed.shift();
    }
    live.delete(this);
    this.rt?.dispose();
    this.rt = null;
    for (const v of this.cache.values()) v.bitmap.close();
    this.cache.clear();
    this.queue = [];
    for (const i of [...this.waiters.keys()]) this.settle(i);
  }
}

/**
 * Load a clip from code (not yet saved), render frames at `times` and report what happened:
 * Claude's create_motion / update_motion check a clip this way before it reaches the project.
 */
export async function testMotion(code: string, meta: MotionMeta, times: number[], values?: Record<string, MotionValue>): Promise<{ ok: boolean; error?: string; logs: string[]; frames: ImageBitmap[]; ms: number[] }> {
  const anim = new MotionAnimation('', () => undefined, { code, meta }, values);
  const frames: ImageBitmap[] = [];
  const ms: number[] = [];
  try {
    await anim.ready;
    for (const t of times) {
      const rt = (anim as unknown as { rt: MotionRuntime }).rt;
      const start = performance.now();
      frames.push(await rt.render(t));
      ms.push(Math.round(performance.now() - start));
    }
    return { ok: true, logs: anim.logs.slice(), frames, ms };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), logs: anim.logs.slice(), frames, ms };
  } finally {
    anim.dispose();
  }
}
