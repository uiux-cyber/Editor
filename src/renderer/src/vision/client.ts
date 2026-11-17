/**
 * Main-thread side of the vision workers: starts them lazily, sends requests and routes
 * progress, results, errors and cancellation.
 *
 * Two workers run the same module:
 *   - `main`: analysis jobs (decoding, detectors, scene / colour / tracking maths) and CPU
 *     person segmentation, which is ready within about a second;
 *   - `gpu`: person segmentation with MediaPipe's GPU delegate (≈2× faster per frame, but its
 *     first use compiles shaders for several seconds). It warms up in the background; until it is
 *     ready the preview is served by the CPU segmenter. Exports wait for the final delegate so
 *     every export of a project is computed the same way.
 */

import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import { modelUrl } from '@shared/ipc';
import workerUrl from './worker.ts?worker&url';
import type { InitInfo, MainMessage, MaskResult, VisionRequest, WorkerMessage } from './protocol';

export class VisionCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  onProgress?: (value: number, label?: string) => void;
  transfer?: Transferable[];
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (value: number, label?: string) => void;
}

type Role = 'main' | 'gpu';

interface Slot {
  worker: Worker | null;
  ready: Promise<InitInfo> | null;
  pending: Map<number, Pending>;
}

const slots: Record<Role, Slot> = {
  main: { worker: null, ready: null, pending: new Map() },
  gpu: { worker: null, ready: null, pending: new Map() },
};
let nextId = 1;
let gpuPreference = true;
let gpuState: 'idle' | 'warming' | 'ready' | 'failed' = 'idle';
let gpuWarm: Promise<boolean> | null = null;

/** Absolute URL of a bundled app asset. */
const abs = (u: string): string => new URL(u, location.href).href;

function spawn(role: Role): Worker {
  const slot = slots[role];
  // A blob-URL worker inherits the page's cross-origin isolation (a worker loaded from its own
  // URL would need its own COEP header). It simply imports the bundled worker module.
  const src = `import ${JSON.stringify(abs(workerUrl))};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module', name: `kinora-vision-${role}` });
  URL.revokeObjectURL(url);
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    const p = slot.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') p.onProgress?.(msg.value, msg.label);
    else {
      slot.pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.data);
      else p.reject(msg.message === 'cancelled' ? new VisionCancelled() : new Error(msg.message));
    }
  };
  w.onerror = (e) => {
    const err = new Error(e.message || 'The vision engine stopped unexpectedly.');
    for (const p of slot.pending.values()) p.reject(err);
    slot.pending.clear();
    slot.worker = null;
    slot.ready = null;
    if (role === 'gpu') gpuState = 'failed';
  };
  return w;
}

function post<T>(role: Role, req: VisionRequest, opts: RequestOptions = {}): Promise<T> {
  const slot = slots[role];
  if (!slot.worker) slot.worker = spawn(role);
  const id = nextId++;
  const w = slot.worker;
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new VisionCancelled());
      return;
    }
    slot.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts.onProgress });
    opts.signal?.addEventListener(
      'abort',
      () => {
        if (!slot.pending.has(id)) return;
        w.postMessage({ id: nextId++, type: 'cancel', target: id } satisfies MainMessage);
        slot.pending.get(id)?.reject(new VisionCancelled());
        slot.pending.delete(id);
      },
      { once: true },
    );
    w.postMessage({ id, ...req } as MainMessage, opts.transfer ?? []);
  });
}

function init(role: Role): Promise<InitInfo> {
  const slot = slots[role];
  slot.ready ??= post<InitInfo>(role, {
    type: 'init',
    wasmBase: modelUrl('mediapipe/wasm'),
    loaderUrl: abs(loaderUrl),
    models: {
      segmenter: modelUrl('mediapipe/selfie_segmenter.tflite'),
      face: modelUrl('mediapipe/blaze_face_short_range.tflite'),
      object: modelUrl('mediapipe/efficientdet_lite0.tflite'),
    },
    gpu: role === 'gpu',
  }).catch((err) => {
    slot.ready = null;
    throw err;
  });
  return slot.ready;
}

/** Start the analysis runtime (idempotent). */
export function initVision(): Promise<InitInfo> {
  return init('main');
}

/** Send an analysis request once the runtime is initialised. */
export async function visionRequest<T>(req: VisionRequest, opts: RequestOptions = {}): Promise<T> {
  await init('main');
  return post<T>('main', req, opts);
}

/** Start (once) the GPU segmenter in the background. Resolves true when it is usable. */
export function warmGpuSegmenter(): Promise<boolean> {
  if (!gpuPreference) return Promise.resolve(false);
  gpuWarm ??= (async () => {
    gpuState = 'warming';
    try {
      await init('gpu');
      const probe = new OffscreenCanvas(64, 64);
      probe.getContext('2d')!.fillRect(0, 0, 64, 64);
      const bmp = await createImageBitmap(probe);
      await post<MaskResult>('gpu', { type: 'segment', bitmap: bmp }, { transfer: [bmp] });
      gpuState = 'ready';
      finalListeners.forEach((cb) => cb());
      return true;
    } catch (err) {
      console.debug('[vision] GPU segmentation unavailable; using the CPU', err);
      gpuState = 'failed';
      slots.gpu.worker?.terminate();
      slots.gpu.worker = null;
      finalListeners.forEach((cb) => cb());
      return false;
    }
  })();
  return gpuWarm;
}

export interface SegmentResult extends MaskResult {
  delegate: 'GPU' | 'CPU';
}

/**
 * Segment a picture. `final` requests (exports) always use the final delegate — the GPU once it
 * has warmed up, or the CPU when the GPU is disabled / unusable — so exports are reproducible.
 * Preview requests use whatever is ready now.
 */
export async function segmentFrame(makeBitmap: () => Promise<ImageBitmap>, final: boolean): Promise<SegmentResult> {
  if (gpuPreference) {
    if (gpuState === 'idle') void warmGpuSegmenter();
    if (final && gpuState === 'warming') await gpuWarm;
    if (gpuState === 'ready') {
      try {
        const bmp = await makeBitmap();
        const r = await post<MaskResult>('gpu', { type: 'segment', bitmap: bmp }, { transfer: [bmp] });
        return { ...r, delegate: 'GPU' };
      } catch (err) {
        if (err instanceof VisionCancelled) throw err;
        console.debug('[vision] GPU segmentation failed; falling back to the CPU', err);
        gpuState = 'failed';
      }
    }
  }
  await init('main');
  const bmp = await makeBitmap();
  const r = await post<MaskResult>('main', { type: 'segment', bitmap: bmp }, { transfer: [bmp] });
  return { ...r, delegate: 'CPU' };
}

const finalListeners = new Set<() => void>();

/** True when final (export-grade) segmentation can run without waiting for a warm-up. */
export const finalDelegateReady = (): boolean => !gpuPreference || gpuState === 'ready' || gpuState === 'failed';

/** Called when the final delegate becomes ready (GPU warmed up, or found unusable). */
export function onFinalDelegateReady(cb: () => void): () => void {
  finalListeners.add(cb);
  return () => finalListeners.delete(cb);
}

/** State of the GPU segmenter: idle / warming / ready / failed, or cpu-only when disabled. */
export const segmentationDelegate = (): string => (gpuPreference ? gpuState : 'cpu-only');

/** Use the GPU delegate for segmentation (takes effect after `resetVision`). */
export function setVisionGpu(on: boolean): void {
  gpuPreference = on;
}

/** Stop the workers (e.g. after changing the delegate). Pending requests are rejected. */
export function resetVision(): void {
  for (const slot of Object.values(slots)) {
    slot.worker?.terminate();
    slot.worker = null;
    slot.ready = null;
    for (const p of slot.pending.values()) p.reject(new VisionCancelled());
    slot.pending.clear();
  }
  gpuState = 'idle';
  gpuWarm = null;
}

export const isCancelled = (err: unknown): boolean => err instanceof VisionCancelled;
