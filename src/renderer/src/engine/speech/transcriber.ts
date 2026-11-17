/**
 * Main-thread client for the speech recognition worker. One worker is shared by every speech
 * feature; it keeps the model loaded between jobs. WebGPU is tried first and the client falls
 * back to WebAssembly automatically (and remembers it for the session) when the GPU path fails.
 */

import type { TranscriptWord } from '@/core/speech';
import type { Device, WorkerRequest, WorkerResponse, WorkerWord } from './whisper.worker';

export type DevicePref = 'auto' | Device;

export interface TranscribeOptions {
  /** ISO code such as 'en', or 'auto' to detect. */
  language?: string;
  device?: DevicePref;
  onProgress?: (ratio: number, words: TranscriptWord[]) => void;
  onLoading?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  words: TranscriptWord[];
  language: string;
  device: Device;
  /** Wall time of the job, ms. */
  ms: number;
  audioSeconds: number;
}

export class TranscriptionCancelled extends Error {
  constructor() {
    super('Transcription cancelled');
  }
}

let worker: Worker | null = null;
let nextId = 1;
let gpuBroken = false;
const listeners = new Set<(msg: WorkerResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'kinora-speech' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => listeners.forEach((cb) => cb(e.data));
  worker.onerror = (e) => {
    const msg: WorkerResponse = { type: 'error', message: e.message || 'The speech engine stopped unexpectedly.' };
    listeners.forEach((cb) => cb(msg));
  };
  return worker;
}

/** Stop the worker (frees the model); the next job starts a new one. */
export function disposeTranscriber(): void {
  worker?.terminate();
  worker = null;
}

const toWords = (ws: WorkerWord[]): TranscriptWord[] => ws.map((w) => ({ text: w.text, start: w.start, end: w.end }));

function run(audio: Float32Array, language: string | null, device: DevicePref, opts: TranscribeOptions): Promise<TranscribeResult> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<TranscribeResult>((resolve, reject) => {
    let killTimer = 0;
    const cleanup = (): void => {
      listeners.delete(onMsg);
      opts.signal?.removeEventListener('abort', onAbort);
      window.clearTimeout(killTimer);
    };
    const onAbort = (): void => {
      w.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
      // A window can take a few seconds; if the worker does not stop soon, end it.
      killTimer = window.setTimeout(() => {
        cleanup();
        disposeTranscriber();
        reject(new TranscriptionCancelled());
      }, 2500);
    };
    const onMsg = (msg: WorkerResponse): void => {
      if (msg.type === 'loading') opts.onLoading?.(msg.ratio);
      else if (msg.type === 'progress' && msg.id === id) opts.onProgress?.(msg.ratio, toWords(msg.words));
      else if (msg.type === 'result' && msg.id === id) {
        cleanup();
        resolve({ words: toWords(msg.words), language: msg.language, device: msg.device, ms: msg.ms, audioSeconds: msg.audioSeconds });
      } else if (msg.type === 'error' && (msg.id === id || msg.id === undefined)) {
        cleanup();
        reject(msg.message === 'cancelled' ? new TranscriptionCancelled() : new Error(msg.message));
      }
    };
    listeners.add(onMsg);
    if (opts.signal?.aborted) {
      cleanup();
      reject(new TranscriptionCancelled());
      return;
    }
    opts.signal?.addEventListener('abort', onAbort);
    // The audio is copied (not transferred) so callers can keep using their buffer.
    w.postMessage({ type: 'transcribe', id, audio, language, device: device === 'auto' && gpuBroken ? 'wasm' : device } satisfies WorkerRequest);
  });
}

/** Transcribe 16 kHz mono audio. Word times are seconds from the start of `audio`. */
export async function transcribe(audio16k: Float32Array, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
  const language = opts.language && opts.language !== 'auto' ? opts.language : null;
  const device = opts.device ?? 'auto';
  try {
    return await run(audio16k, language, device, opts);
  } catch (err) {
    if (err instanceof TranscriptionCancelled || device === 'wasm' || gpuBroken) throw err;
    // The GPU path failed (driver, unsupported operator…): fall back to the CPU for the session.
    console.warn('[speech] WebGPU transcription failed, using WebAssembly', err);
    gpuBroken = true;
    disposeTranscriber();
    return run(audio16k, language, 'wasm', opts);
  }
}

/** Load the model ahead of time (e.g. when a speech tool opens). */
export function warmUpTranscriber(device: DevicePref = 'auto'): void {
  getWorker().postMessage({ type: 'load', device: device === 'auto' && gpuBroken ? 'wasm' : device } satisfies WorkerRequest);
}

/** Languages offered in the UI (Whisper supports ~100; these cover most users). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'cs', label: 'Czech' },
  { code: 'el', label: 'Greek' },
  { code: 'ro', label: 'Romanian' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
];

export const languageName = (code: string): string => LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
