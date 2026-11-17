/**
 * Promise API over the DSP worker. Each job can report progress and be cancelled (the worker is
 * terminated and recreated, so a cancelled job never blocks the next one).
 */

import type { BeatOptions, BeatResult, DenoiseOptions, SilenceOptions, SpeechOptions } from '@/core/audioAnalysis';
import type { TimeRange } from '@/core/speech';
import type { DspRequest, DspResponse } from './dsp.worker';

export class DspCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (r: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module', name: 'kinora-dsp' });
  worker.onmessage = (e: MessageEvent<DspResponse>) => {
    const msg = e.data;
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') job.onProgress?.(msg.ratio);
    else {
      pending.delete(msg.id);
      if (msg.type === 'result') job.resolve(msg.result);
      else job.reject(new Error(msg.message));
    }
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Audio analysis failed.'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type Payload = DspRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function call<T>(payload: Payload, transfer: Transferable[], signal?: AbortSignal, onProgress?: (r: number) => void): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DspCancelled());
  const id = nextId++;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      pending.delete(id);
      // Stop the computation right away; other jobs (if any) fail and can be retried.
      for (const job of pending.values()) job.reject(new DspCancelled());
      pending.clear();
      worker?.terminate();
      worker = null;
      reject(new DspCancelled());
    };
    pending.set(id, {
      resolve: (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v as T);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
      onProgress,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ ...payload, id } as DspRequest, transfer);
  });
}

/** Spectral-gating noise reduction. The input arrays are copied. */
export function denoiseAudio(channels: Float32Array[], options: Partial<DenoiseOptions>, opts: { signal?: AbortSignal; onProgress?: (r: number) => void; profileFrom?: Float32Array[] } = {}): Promise<Float32Array[]> {
  return call<Float32Array[]>({ op: 'denoise', channels, options, profileFrom: opts.profileFrom }, [], opts.signal, opts.onProgress);
}

export function analyseBeats(samples: Float32Array, sampleRate: number, options: Partial<BeatOptions> = {}, signal?: AbortSignal): Promise<BeatResult> {
  return call<BeatResult>({ op: 'beats', samples, sampleRate, options }, [], signal);
}

export function analyseSilence(samples: Float32Array, sampleRate: number, options: Partial<SilenceOptions> = {}, signal?: AbortSignal): Promise<TimeRange[]> {
  return call<TimeRange[]>({ op: 'silence', samples, sampleRate, options }, [], signal);
}

export function analyseSpeech(samples: Float32Array, sampleRate: number, options: Partial<SpeechOptions> = {}, signal?: AbortSignal): Promise<TimeRange[]> {
  return call<TimeRange[]>({ op: 'speech', samples, sampleRate, options }, [], signal);
}
