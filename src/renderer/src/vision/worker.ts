/**
 * Vision worker: on-device MediaPipe models (person segmentation, face and object detection),
 * Mediabunny decoding and the pure analysis algorithms — everything heavy runs here, off the
 * UI thread.
 *
 * Loading: the worker is started from a blob URL (so it inherits the page's cross-origin
 * isolation); MediaPipe's small JS loader is bundled with the app (CSP: scripts only from the
 * app) while the WebAssembly runtime and the models are read from kinora://models.
 */

import { FaceDetector, FilesetResolver, ImageSegmenter, ObjectDetector, type Detection } from '@mediapipe/tasks-vision';
import { ALL_FORMATS, CanvasSink, Input, UrlSource, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import type { FocusSample } from './algo/camera';
import { compileGrade, gradePixels, matchColors, rgbaToRgb } from './algo/color';
import { frameDifference, frameFeatures, type FrameFeatures, type FrameStat } from './algo/scenes';
import { TemplateTracker, type GrayFrame } from './algo/tracker';
import type { ColorMatchRequest, ColorMatchResponse, FocusAnalysis, InitInfo, MainMessage, MaskResult, MediaRef, SceneAnalysis, TrackRequest, TrackResponse, VisionRequest } from './protocol';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const scope = self as unknown as WorkerScope;

// MediaPipe's runtime logs informational lines (glog format) through console.error / warn.
// They are not problems; demote them so real errors stay visible.
const NOISE = /^(?:[IWE]\d{4} \d\d:\d\d:\d\d\.\d+|INFO: |WARNING: All log messages|Graph successfully|Created TensorFlow)/;
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && NOISE.test(args[0])) console.debug(...args);
    else original(...args);
  };
}

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

// ---------------------------------------------------------------------------------------------
// MediaPipe
// ---------------------------------------------------------------------------------------------

interface Config {
  wasmBase: string;
  loaderUrl: string;
  models: Record<'segmenter' | 'face' | 'object', string>;
  gpu: boolean;
}

let config: Config | null = null;
let fileset: WasmFileset | null = null;
let moduleFactory: unknown = null;
let segmenter: ImageSegmenter | null = null;
let segmenterDelegate: 'GPU' | 'CPU' | 'none' = 'none';
let segmenterLoading: Promise<ImageSegmenter> | null = null;
let face: FaceDetector | null = null;
let objects: ObjectDetector | null = null;
let detectorsLoading: Promise<void> | null = null;

async function getFileset(): Promise<WasmFileset> {
  if (fileset) return fileset;
  if (!config) throw new Error('The vision runtime was not initialised.');
  const fs = await FilesetResolver.forVisionTasks(config.wasmBase, true);
  fs.wasmLoaderPath = config.loaderUrl;
  // The loader is an ES module: it only defines `ModuleFactory` the first time it is imported,
  // and MediaPipe clears that global after creating each task — keep it and restore it.
  await import(/* @vite-ignore */ config.loaderUrl);
  moduleFactory = (self as unknown as { ModuleFactory?: unknown }).ModuleFactory;
  fileset = fs;
  return fs;
}

function restoreFactory(): void {
  (self as unknown as { ModuleFactory?: unknown }).ModuleFactory = moduleFactory;
}

async function createSegmenter(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  const fs = await getFileset();
  restoreFactory();
  const seg = await ImageSegmenter.createFromOptions(fs, {
    baseOptions: { modelAssetPath: config!.models.segmenter, delegate },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
    canvas: new OffscreenCanvas(1, 1),
  });
  // Warm up (compiles GPU shaders) so the first real frame is not slow — and so a broken GPU
  // path fails here, where we can still fall back to the CPU.
  const probe = new OffscreenCanvas(64, 64);
  const g = probe.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 64, 64);
  const r = seg.segment(probe);
  r.confidenceMasks?.[0]?.getAsFloat32Array();
  r.close();
  return seg;
}

/**
 * Person segmenter of this worker: the GPU delegate in the `gpu` worker (a failure is reported to
 * the client, which then falls back to the CPU worker), the CPU (XNNPACK) delegate otherwise.
 */
function getSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return Promise.resolve(segmenter);
  segmenterLoading ??= (async () => {
    const delegate = config?.gpu ? 'GPU' : 'CPU';
    const seg = await createSegmenter(delegate);
    segmenterDelegate = delegate;
    segmenter = seg;
    return seg;
  })().catch((err) => {
    segmenterLoading = null;
    throw err;
  });
  return segmenterLoading;
}

/** Face + object detectors (CPU: results are steadier and there is no shader warm-up). */
function getDetectors(): Promise<void> {
  if (face && objects) return Promise.resolve();
  detectorsLoading ??= (async () => {
    const fs = await getFileset();
    restoreFactory();
    face = await FaceDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: config!.models.face, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.45,
      canvas: new OffscreenCanvas(1, 1),
    });
    restoreFactory();
    objects = await ObjectDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: config!.models.object, delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: 0.3,
      maxResults: 6,
      canvas: new OffscreenCanvas(1, 1),
    });
  })().catch((err) => {
    detectorsLoading = null;
    throw err;
  });
  return detectorsLoading;
}

function segment(seg: ImageSegmenter, image: TexImageSource): MaskResult {
  const t0 = performance.now();
  const result = seg.segment(image);
  try {
    const masks = result.confidenceMasks ?? [];
    const m = masks[masks.length - 1];
    if (!m) throw new Error('The segmentation model returned no mask.');
    const f = m.getAsFloat32Array();
    const out = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = f[i] <= 0 ? 0 : f[i] >= 1 ? 255 : (f[i] * 255 + 0.5) | 0;
    return { mask: out, w: m.width, h: m.height, ms: performance.now() - t0 };
  } finally {
    result.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

interface Source {
  input: Input;
  track: InputVideoTrack;
  width: number;
  height: number;
  duration: number;
  fps: number;
}

const sources = new Map<string, Promise<Source>>();
const stills = new Map<string, Promise<ImageBitmap>>();

function videoSource(url: string): Promise<Source> {
  let s = sources.get(url);
  if (!s) {
    s = (async () => {
      const input = new Input({ source: new UrlSource(url, { maxCacheSize: 16 * 1024 * 1024 }), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The file has no video track.');
      if (!(await track.canDecode())) throw new Error('This video cannot be decoded on this PC.');
      let fps = 30;
      try {
        const stats = await track.computePacketStats(90);
        if (stats.averagePacketRate > 0) fps = stats.averagePacketRate;
      } catch {
        /* keep default */
      }
      return { input, track, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), duration: await input.computeDuration([track]), fps };
    })();
    sources.set(url, s);
    s.catch(() => sources.delete(url));
    // Keep a handful of inputs open.
    while (sources.size > 4) {
      const [oldest] = sources.keys();
      void sources.get(oldest)?.then((src) => src.input.dispose()).catch(() => undefined);
      sources.delete(oldest);
    }
  }
  return s;
}

function stillImage(url: string): Promise<ImageBitmap> {
  let s = stills.get(url);
  if (!s) {
    s = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The image could not be read (HTTP ${res.status}).`);
      return createImageBitmap(await res.blob());
    })();
    stills.set(url, s);
    s.catch(() => stills.delete(url));
    while (stills.size > 4) {
      const [oldest] = stills.keys();
      void stills.get(oldest)?.then((b) => b.close()).catch(() => undefined);
      stills.delete(oldest);
    }
  }
  return s;
}

const scratch = new OffscreenCanvas(2, 2);
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;

/** RGBA pixels of an image source drawn at w×h. */
function pixels(src: CanvasImageSource, w: number, h: number): ImageData {
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  scratchCtx.clearRect(0, 0, w, h);
  scratchCtx.drawImage(src, 0, 0, w, h);
  return scratchCtx.getImageData(0, 0, w, h);
}

function gray(img: ImageData): GrayFrame {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (d[p] * 54 + d[p + 1] * 183 + d[p + 2] * 19) >> 8;
  return { data: out, w: img.width, h: img.height };
}

const fitWidth = (srcW: number, srcH: number, width: number): { w: number; h: number } => {
  const w = Math.max(8, Math.min(width, srcW || width));
  return { w, h: Math.max(8, Math.round((w * (srcH || w)) / Math.max(1, srcW || w))) };
};

/** Frames of a source at the given times (videos), or the still repeated. */
async function* framesAt(media: MediaRef, times: number[], width: number, isCancelled: () => boolean): AsyncGenerator<{ t: number; canvas: CanvasImageSource; w: number; h: number }> {
  if (media.kind === 'image') {
    const bmp = await stillImage(media.url);
    const { w, h } = fitWidth(bmp.width, bmp.height, width);
    for (const t of times) yield { t, canvas: bmp, w, h };
    return;
  }
  const src = await videoSource(media.url);
  const { w, h } = fitWidth(src.width, src.height, width);
  const sink = new CanvasSink(src.track, { width: w, height: h, fit: 'fill', poolSize: 2 });
  const first = await src.track.getFirstTimestamp();
  const sorted = times.map((t) => Math.max(first, t)).sort((a, b) => a - b);
  for await (const c of sink.canvasesAtTimestamps(sorted)) {
    if (isCancelled()) throw new Cancelled();
    if (!c) continue;
    yield { t: c.timestamp, canvas: c.canvas as CanvasImageSource, w, h };
  }
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

type Progress = (value: number, label?: string) => void;
interface JobCtx {
  progress: Progress;
  cancelled: () => boolean;
}

const OBJECT_WEIGHT: Record<string, number> = {
  person: 1,
  dog: 0.85,
  cat: 0.85,
  horse: 0.8,
  bird: 0.75,
  sheep: 0.7,
  cow: 0.7,
  elephant: 0.7,
  bear: 0.7,
  zebra: 0.7,
  giraffe: 0.7,
  car: 0.6,
  motorcycle: 0.6,
  bicycle: 0.6,
  bus: 0.55,
  truck: 0.55,
  boat: 0.55,
  airplane: 0.55,
  train: 0.5,
  'sports ball': 0.6,
};

interface Subject {
  x: number;
  y: number;
  conf: number;
  kind: 'face' | 'object' | 'saliency' | 'centre';
}

function pickFaces(dets: Detection[], w: number, h: number): Subject | null {
  const faces = dets.filter((d) => d.boundingBox && (d.categories[0]?.score ?? 0) >= 0.5);
  if (!faces.length) return null;
  const area = (d: Detection): number => d.boundingBox!.width * d.boundingBox!.height;
  const largest = Math.max(...faces.map(area));
  const main = faces.filter((d) => area(d) >= largest * 0.3);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let score = 0;
  for (const d of main) {
    const b = d.boundingBox!;
    const wgt = area(d);
    sx += (b.originX + b.width / 2) * wgt;
    // Aim a little below the face so the shoulders stay in the frame.
    sy += (b.originY + b.height * 0.75) * wgt;
    sw += wgt;
    score = Math.max(score, d.categories[0]?.score ?? 0);
  }
  return { x: sx / sw / w, y: sy / sw / h, conf: score, kind: 'face' };
}

function pickObject(dets: Detection[], w: number, h: number): Subject | null {
  let best: Subject | null = null;
  let bestRank = 0;
  for (const d of dets) {
    const b = d.boundingBox;
    const cat = d.categories[0];
    if (!b || !cat) continue;
    const weight = OBJECT_WEIGHT[cat.categoryName] ?? 0.35;
    const rank = cat.score * weight * Math.sqrt((b.width * b.height) / (w * h));
    if (rank > bestRank) {
      bestRank = rank;
      const headY = cat.categoryName === 'person' ? b.originY + b.height * 0.3 : b.originY + b.height / 2;
      best = { x: (b.originX + b.width / 2) / w, y: headY / h, conf: Math.min(0.9, cat.score * weight), kind: 'object' };
    }
  }
  return best;
}

/** Colour-contrast + motion saliency with a centre prior, on a tiny copy of the frame. */
function saliency(img: ImageData, prev: Float32Array | null): { subject: Subject | null; luma: Float32Array } {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const L = new Float32Array(n);
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    mr += data[i * 4];
    mg += data[i * 4 + 1];
    mb += data[i * 4 + 2];
    L[i] = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
  }
  mr /= n;
  mg /= n;
  mb /= n;
  const s = new Float32Array(n);
  let max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dc = Math.hypot(data[i * 4] - mr, data[i * 4 + 1] - mg, data[i * 4 + 2] - mb) / 255;
      const motion = prev ? Math.abs(L[i] - prev[i]) * 3 : 0;
      const px = (x + 0.5) / w - 0.5;
      const py = (y + 0.5) / h - 0.5;
      const prior = Math.exp(-(px * px + py * py) / (2 * 0.3 * 0.3));
      const v = (dc + motion) * prior;
      s[i] = v;
      if (v > max) max = v;
    }
  }
  if (max < 0.05) return { subject: null, luma: L };
  const thr = max * 0.6;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < n; i++) {
    if (s[i] < thr) continue;
    const wgt = s[i] - thr;
    sx += ((i % w) + 0.5) * wgt;
    sy += (Math.floor(i / w) + 0.5) * wgt;
    sw += wgt;
  }
  if (sw <= 0) return { subject: null, luma: L };
  return { subject: { x: sx / sw / w, y: sy / sw / h, conf: 0.12, kind: 'saliency' }, luma: L };
}

async function focusJob(media: MediaRef, fps: number, start: number, end: number, ctx: JobCtx): Promise<FocusAnalysis> {
  const t0 = performance.now();
  ctx.progress(0, 'Loading models');
  await getDetectors();
  let width = 0;
  let height = 0;
  let times: number[];
  if (media.kind === 'image') {
    const bmp = await stillImage(media.url);
    width = bmp.width;
    height = bmp.height;
    times = [0];
  } else {
    const src = await videoSource(media.url);
    width = src.width;
    height = src.height;
    const a = Math.max(0, start);
    const b = Math.min(src.duration, end);
    times = [];
    for (let t = a; t < b - 1e-6; t += 1 / fps) times.push(t);
    if (!times.length) times.push(a);
  }
  const out: FocusAnalysis['samples'] = [];
  let prev: Float32Array | null = null;
  let i = 0;
  ctx.progress(0, 'Finding the subject');
  for await (const f of framesAt(media, times, 480, ctx.cancelled)) {
    const det = face!.detect(f.canvas as TexImageSource);
    let subject = pickFaces(det.detections, f.w, f.h);
    if (!subject) subject = pickObject(objects!.detect(f.canvas as TexImageSource).detections, f.w, f.h);
    const small = pixels(f.canvas, 64, Math.max(8, Math.round((64 * f.h) / f.w)));
    const sal = saliency(small, prev);
    prev = sal.luma;
    subject ??= sal.subject ?? { x: 0.5, y: 0.5, conf: 0, kind: 'centre' };
    out.push({ t: f.t, ...subject });
    i++;
    if (i % 3 === 0) ctx.progress(i / times.length, 'Finding the subject');
  }
  return { samples: out, width, height, ms: performance.now() - t0 };
}

async function scenesJob(media: MediaRef, start: number, end: number, width: number, ctx: JobCtx): Promise<SceneAnalysis> {
  const t0 = performance.now();
  if (media.kind !== 'video') throw new Error('Scene detection needs a video clip.');
  const src = await videoSource(media.url);
  const { w, h } = fitWidth(src.width, src.height, width);
  const sink = new CanvasSink(src.track, { width: w, height: h, fit: 'fill', poolSize: 2 });
  const a = Math.max(0, start);
  const b = Math.min(src.duration, end);
  const total = Math.max(1, Math.round((b - a) * src.fps));
  const stats: FrameStat[] = [];
  let prev: FrameFeatures | null = null;
  for await (const c of sink.canvases(a, b)) {
    if (ctx.cancelled()) throw new Cancelled();
    const feat = frameFeatures(pixels(c.canvas as CanvasImageSource, w, h).data, w, h);
    const d = prev ? frameDifference(prev, feat) : { hist: 0, edge: 0 };
    stats.push({ t: c.timestamp, hist: d.hist, edge: d.edge, luma: feat.luma });
    prev = feat;
    if (stats.length % 15 === 0) ctx.progress(Math.min(1, stats.length / total), 'Comparing frames');
  }
  return { stats, fps: src.fps, ms: performance.now() - t0 };
}

async function thumbsJob(media: MediaRef, times: number[], width: number, ctx: JobCtx): Promise<Blob[]> {
  const out: Blob[] = [];
  const canvas = new OffscreenCanvas(2, 2);
  const g = canvas.getContext('2d')!;
  const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const byIndex: Blob[] = new Array(times.length);
  let k = 0;
  for await (const f of framesAt(media, order.map((o) => o.t), width, ctx.cancelled)) {
    canvas.width = f.w;
    canvas.height = f.h;
    g.drawImage(f.canvas, 0, 0, f.w, f.h);
    byIndex[order[k].i] = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    k++;
    if (k >= order.length) break;
  }
  for (let i = 0; i < times.length; i++) out.push(byIndex[i] ?? new Blob());
  return out;
}

async function sampleRgb(media: MediaRef & { times: number[] }, ctx: JobCtx): Promise<{ rgb: Float32Array; preview: ImageData | null }> {
  const chunks: Float32Array[] = [];
  let preview: ImageData | null = null;
  for await (const f of framesAt(media, media.times, 160, ctx.cancelled)) {
    const img = pixels(f.canvas, f.w, f.h);
    chunks.push(rgbaToRgb(img.data, 2400));
  }
  // Preview: the middle sample at a larger size.
  const mid = media.times[Math.floor(media.times.length / 2)] ?? 0;
  for await (const f of framesAt(media, [mid], 240, ctx.cancelled)) preview = pixels(f.canvas, f.w, f.h);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const rgb = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    rgb.set(c, o);
    o += c.length;
  }
  return { rgb, preview };
}

function toRgba(rgb: Float32Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = rgb[i * 3] * 255 + 0.5;
    out[i * 4 + 1] = rgb[i * 3 + 1] * 255 + 0.5;
    out[i * 4 + 2] = rgb[i * 3 + 2] * 255 + 0.5;
    out[i * 4 + 3] = 255;
  }
  return out;
}

async function colorMatchJob(req: ColorMatchRequest, ctx: JobCtx): Promise<ColorMatchResponse> {
  const t0 = performance.now();
  ctx.progress(0.1, 'Sampling the reference');
  const ref = await sampleRgb(req.reference, ctx);
  ctx.progress(0.4, 'Sampling the clip');
  const src = await sampleRgb(req.source, ctx);
  ctx.progress(0.6, 'Matching colours');
  const refGrades = req.referenceGrades.map((g) => compileGrade(g));
  const target = gradePixels(ref.rgb, refGrades);
  const result = matchColors({ source: src.rgb, target, baseAdjust: req.baseAdjust, filter: req.filter, strength: req.strength });
  ctx.progress(0.95, 'Rendering previews');
  // Previews at a common size (the clip's aspect).
  const pw = src.preview?.width ?? req.previewWidth;
  const ph = src.preview?.height ?? Math.round(req.previewWidth * 0.5625);
  const resize = (img: ImageData | null): Float32Array => {
    if (!img) return new Float32Array(pw * ph * 3);
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return rgbaToRgb(pixels(c, pw, ph).data);
  };
  const srcPx = resize(src.preview);
  const refPx = resize(ref.preview);
  const filter = compileGrade(req.filter);
  return {
    ...result,
    previews: {
      w: pw,
      h: ph,
      reference: toRgba(gradePixels(refPx, refGrades), pw, ph),
      before: toRgba(gradePixels(srcPx, [compileGrade(req.baseAdjust), filter]), pw, ph),
      after: toRgba(gradePixels(srcPx, [compileGrade(result.adjust), filter]), pw, ph),
    },
    ms: performance.now() - t0,
  };
}

async function trackJob(req: TrackRequest, ctx: JobCtx): Promise<TrackResponse> {
  const t0 = performance.now();
  if (req.media.kind !== 'video') throw new Error('Motion tracking needs a video clip.');
  const src = await videoSource(req.media.url);
  // Work at up to 640 px wide, but keep the tracked region at least ~24 px.
  const want = Math.max(320, Math.min(960, Math.ceil(24 / Math.max(0.01, req.box.w))));
  const { w, h } = fitWidth(src.width, src.height, Math.min(want, 640));
  const sink = new CanvasSink(src.track, { width: w, height: h, fit: 'fill', poolSize: 3 });
  const grayOf = (c: WrappedCanvas): GrayFrame => gray(pixels(c.canvas as CanvasImageSource, w, h));
  const start = Math.max(0, req.start);
  const end = Math.min(src.duration, req.end);
  const total = Math.max(1, Math.round((end - start) * src.fps));
  let done = 0;
  const report = (): void => {
    done++;
    if (done % 6 === 0) ctx.progress(Math.min(1, done / total), 'Tracking');
  };

  const first = await sink.getCanvas(Math.max(start, Math.min(end - 1e-3, req.t0)));
  if (!first) throw new Error('The frame at the playhead could not be decoded.');
  const tf0 = first.timestamp;
  const box = { cx: req.box.cx * w, cy: req.box.cy * h, w: Math.max(6, req.box.w * w), h: Math.max(6, req.box.h * h) };
  const firstGray = grayOf(first);
  const samples: TrackResponse['samples'] = [{ t: tf0, x: req.box.cx, y: req.box.cy, w: req.box.w, h: req.box.h, conf: 1 }];
  const push = (t: number, r: { cx: number; cy: number; w: number; h: number; conf: number }): void => {
    samples.push({ t, x: r.cx / w, y: r.cy / h, w: r.w / w, h: r.h / h, conf: r.conf });
  };

  // Forward from the playhead.
  ctx.progress(0, 'Tracking forward');
  let tracker = new TemplateTracker(firstGray, box);
  for await (const c of sink.canvases(tf0, end)) {
    if (ctx.cancelled()) throw new Cancelled();
    if (c.timestamp <= tf0 + 1e-6) continue;
    push(c.timestamp, tracker.update(grayOf(c)));
    report();
  }

  // Backward from the playhead, decoding short chunks forward and processing them in reverse.
  tracker = new TemplateTracker(firstGray, box);
  let hi = tf0;
  while (hi > start + 1e-6) {
    const lo = Math.max(start, hi - 2);
    const chunk: { t: number; f: GrayFrame }[] = [];
    for await (const c of sink.canvases(lo, hi)) {
      if (ctx.cancelled()) throw new Cancelled();
      if (c.timestamp >= hi - 1e-6) break;
      if (c.timestamp < lo - 1e-6 && lo > start + 1e-6) continue;
      chunk.push({ t: c.timestamp, f: grayOf(c) });
    }
    if (!chunk.length) break;
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (ctx.cancelled()) throw new Cancelled();
      push(chunk[i].t, tracker.update(chunk[i].f));
      report();
    }
    hi = Math.min(lo, chunk[0].t);
    if (lo <= start + 1e-6) break;
  }
  samples.sort((a, b) => a.t - b.t);
  return { samples, frames: samples.length, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------

const cancelled = new Set<number>();

async function handle(msg: VisionRequest, ctx: JobCtx): Promise<{ data: unknown; transfer?: Transferable[] }> {
  switch (msg.type) {
    case 'init': {
      const t0 = performance.now();
      config = { wasmBase: msg.wasmBase, loaderUrl: msg.loaderUrl, models: msg.models, gpu: msg.gpu };
      await getFileset();
      const info: InitInfo = { segmenter: segmenterDelegate, detectors: face ? 'CPU' : 'none', ms: performance.now() - t0 };
      return { data: info };
    }
    case 'segment': {
      const seg = await getSegmenter();
      try {
        const r = segment(seg, msg.bitmap);
        return { data: { ...r, delegate: segmenterDelegate }, transfer: [r.mask.buffer] };
      } finally {
        msg.bitmap.close();
      }
    }
    case 'focus':
      return { data: await focusJob(msg.media, msg.fps, msg.start, msg.end, ctx) };
    case 'scenes':
      return { data: await scenesJob(msg.media, msg.start, msg.end, msg.width, ctx) };
    case 'thumbs':
      return { data: await thumbsJob(msg.media, msg.times, msg.width, ctx) };
    case 'colorMatch': {
      const r = await colorMatchJob(msg.req, ctx);
      return { data: r, transfer: [r.previews.reference.buffer, r.previews.before.buffer, r.previews.after.buffer] };
    }
    case 'track':
      return { data: await trackJob(msg.req, ctx) };
    default:
      throw new Error(`Unknown vision request ${(msg as { type: string }).type}`);
  }
}

scope.onmessage = (e: MessageEvent<MainMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.target);
    return;
  }
  const id = msg.id;
  const ctx: JobCtx = {
    progress: (value, label) => scope.postMessage({ id, type: 'progress', value, label }),
    cancelled: () => cancelled.has(id),
  };
  handle(msg, ctx).then(
    ({ data, transfer }) => {
      cancelled.delete(id);
      scope.postMessage({ id, type: 'result', data }, transfer ?? []);
    },
    (err: unknown) => {
      cancelled.delete(id);
      const message = err instanceof Cancelled ? 'cancelled' : err instanceof Error ? err.message : String(err);
      scope.postMessage({ id, type: 'error', message });
    },
  );
};
