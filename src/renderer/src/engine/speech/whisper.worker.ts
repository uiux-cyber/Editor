/// <reference lib="webworker" />
/**
 * Speech recognition worker: Whisper base (int8, word timestamps) through transformers.js and
 * ONNX Runtime. Runs entirely on-device from the bundled model files; WebGPU is preferred and
 * multi-threaded WebAssembly is the fallback.
 *
 * Protocol (main → worker):
 *   { type: 'load', device }                          → 'loading' / 'loaded' | 'error'
 *   { type: 'transcribe', id, audio, language, device } → 'progress'* then 'result' | 'error'
 *   { type: 'cancel', id }                            → the job stops after the current window
 */

import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;

const MODEL = 'onnx-community/whisper-base_timestamped';
const SR = 16000;
/** Whisper sees 30 s windows; we cut a little earlier at the quietest moment. */
const MAX_WINDOW = 29.5;
const MIN_WINDOW = 20;

/** 'hybrid' = encoder on the GPU, decoder on the CPU. */
export type Device = 'webgpu' | 'wasm' | 'hybrid';

export interface WorkerWord {
  text: string;
  start: number;
  end: number;
}

export type WorkerRequest =
  | { type: 'load'; device: Device | 'auto' }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null; device: Device | 'auto' }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'loading'; ratio: number; file?: string }
  | { type: 'loaded'; device: Device; ms: number }
  | { type: 'progress'; id: number; ratio: number; words: WorkerWord[] }
  | { type: 'result'; id: number; words: WorkerWord[]; language: string; device: Device; ms: number; audioSeconds: number }
  | { type: 'error'; id?: number; message: string };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = 'kinora://models/';
env.useBrowserCache = false;
env.useWasmCache = false;
const ort = env.backends.onnx as { wasm?: Record<string, unknown>; webgpu?: Record<string, unknown>; logLevel?: string };
if (ort.wasm) {
  ort.wasm.wasmPaths = { mjs: 'kinora://models/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: 'kinora://models/ort/ort-wasm-simd-threaded.asyncify.wasm' };
  ort.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
  ort.wasm.proxy = false;
}
ort.logLevel = 'error';

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
let pipeDevice: Device | null = null;
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const cancelled = new Set<number>();

const post = (msg: WorkerResponse): void => self.postMessage(msg);

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * 'auto': the bundled model is int8-quantised, and ONNX Runtime's WebGPU backend runs its
 * dynamic-quantisation operators on the CPU with a transfer per layer — measured 2–3× slower
 * than multi-threaded WebAssembly. So multi-threaded WASM is preferred whenever the page is
 * cross-origin isolated; WebGPU is used when only single-threaded WASM would be available.
 */
async function pickDevice(want: Device | 'auto'): Promise<Device> {
  if (want !== 'auto') return want === 'webgpu' && !(await hasWebGpu()) ? 'wasm' : want;
  if (self.crossOriginIsolated) return 'wasm';
  return (await hasWebGpu()) ? 'webgpu' : 'wasm';
}

async function load(want: Device | 'auto'): Promise<AutomaticSpeechRecognitionPipeline> {
  const device = await pickDevice(want);
  if (pipe && pipeDevice === device) return pipe;
  if (loading && pipeDevice === device) return loading;
  if (pipe) {
    await pipe.dispose().catch(() => undefined);
    pipe = null;
  }
  pipeDevice = device;
  const started = performance.now();
  const sizes = new Map<string, { loaded: number; total: number }>();
  loading = (async () => {
    try {
      const p = (await pipeline('automatic-speech-recognition', MODEL, {
        device: device === 'hybrid' ? { encoder_model: 'webgpu', decoder_model_merged: 'wasm' } : device,
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
        progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (info.status === 'progress' && info.file && info.total) {
            sizes.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
            let a = 0;
            let b = 0;
            for (const s of sizes.values()) {
              a += s.loaded;
              b += s.total;
            }
            post({ type: 'loading', ratio: b > 0 ? a / b : 0, file: info.file });
          }
        },
      })) as AutomaticSpeechRecognitionPipeline;
      pipe = p;
      post({ type: 'loaded', device, ms: performance.now() - started });
      return p;
    } catch (err) {
      pipeDevice = null;
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Windows of at most ~30 s, cut at the quietest 0.2 s in the last part of each window. */
export function planWindows(audio: Float32Array): { start: number; end: number }[] {
  const total = audio.length;
  const out: { start: number; end: number }[] = [];
  const hop = Math.round(SR * 0.05);
  let start = 0;
  while (start < total) {
    if (total - start <= MAX_WINDOW * SR) {
      out.push({ start, end: total });
      break;
    }
    let best = start + Math.round(MAX_WINDOW * SR);
    let bestE = Infinity;
    const win = Math.round(SR * 0.2);
    for (let s = start + Math.round(MIN_WINDOW * SR); s + win <= start + Math.round(MAX_WINDOW * SR); s += hop) {
      let e = 0;
      for (let i = s; i < s + win; i += 4) e += audio[i] * audio[i];
      if (e < bestE) {
        bestE = e;
        best = s + Math.round(win / 2);
      }
    }
    out.push({ start, end: best });
    start = best;
  }
  return out;
}

function rmsDb(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 2) s += a[i] * a[i];
  return 10 * Math.log10(Math.max(1e-12, s / Math.max(1, a.length / 2)));
}

/** Most likely spoken language of a window (Whisper's language token probabilities). */
async function detectLanguage(p: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string> {
  const model = p.model as unknown as { generation_config?: { lang_to_id?: Record<string, number>; decoder_start_token_id?: number }; config: Record<string, unknown> } & ((inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>);
  const gen = model.generation_config;
  const langToId = gen?.lang_to_id;
  if (!langToId) return 'en';
  const features = (await (p.processor as unknown as (a: Float32Array) => Promise<{ input_features: Tensor }>)(audio)).input_features;
  const sot = BigInt(gen?.decoder_start_token_id ?? 50258);
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from([sot]), [1, 1]);
  const out = await (p.model as unknown as (inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>)({ input_features: features, decoder_input_ids });
  const logits = out.logits.data as Float32Array;
  const vocab = out.logits.dims[out.logits.dims.length - 1];
  const row = logits.subarray(logits.length - vocab);
  let best = 'en';
  let bestV = -Infinity;
  for (const [tok, id] of Object.entries(langToId)) {
    if (row[id] > bestV) {
      bestV = row[id];
      best = tok.replace(/[<|>]/g, '');
    }
  }
  return best;
}

interface AsrChunk {
  text: string;
  timestamp: [number, number | null];
}

async function transcribe(id: number, audio: Float32Array, language: string | null, device: Device | 'auto'): Promise<void> {
  const started = performance.now();
  const p = await load(device);
  const windows = planWindows(audio);
  const total = audio.length;
  const words: WorkerWord[] = [];
  let lang = language && language !== 'auto' ? language : '';
  let done = 0;
  for (const w of windows) {
    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ type: 'error', id, message: 'cancelled' });
      return;
    }
    const slice = audio.subarray(w.start, w.end);
    // Silent windows make Whisper hallucinate ("Thank you."): skip them.
    if (rmsDb(slice) > -52) {
      if (!lang) lang = await detectLanguage(p, slice);
      const res = (await p(slice, { return_timestamps: 'word', language: lang, task: 'transcribe' } as Record<string, unknown>)) as { text: string; chunks?: AsrChunk[] };
      const offset = w.start / SR;
      const maxT = (w.end - w.start) / SR;
      for (const c of res.chunks ?? []) {
        const s = Math.min(maxT, Math.max(0, c.timestamp[0] ?? 0));
        const e = Math.min(maxT, Math.max(s, c.timestamp[1] ?? s + 0.2));
        words.push({ text: c.text, start: offset + s, end: offset + e });
      }
    }
    done += w.end - w.start;
    post({ type: 'progress', id, ratio: done / total, words: words.slice() });
  }
  post({ type: 'result', id, words, language: lang || 'en', device: pipeDevice ?? 'wasm', ms: performance.now() - started, audioSeconds: total / SR });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    load(msg.device).catch((err: unknown) => post({ type: 'error', message: errorText(err) }));
  } else if (msg.type === 'transcribe') {
    transcribe(msg.id, msg.audio, msg.language, msg.device).catch((err: unknown) => post({ type: 'error', id: msg.id, message: errorText(err) }));
  } else if (msg.type === 'cancel') {
    cancelled.add(msg.id);
  }
};

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'number') return `ONNX Runtime error ${err}`;
  return String(err);
}
