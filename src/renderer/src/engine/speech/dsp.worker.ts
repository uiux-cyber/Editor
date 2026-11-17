/// <reference lib="webworker" />
/**
 * Off-thread audio analysis: noise reduction, beat tracking, silence and voice detection.
 * The heavy lifting lives in core/audioAnalysis.ts (pure functions, unit tested).
 */

import { DEFAULT_DENOISE, detectBeats, detectSilences, detectSpeech, learnNoiseProfile, spectralGate, toMono, type BeatOptions, type DenoiseOptions, type SilenceOptions, type SpeechOptions } from '@/core/audioAnalysis';

declare const self: DedicatedWorkerGlobalScope;

export type DspRequest =
  | { id: number; op: 'denoise'; channels: Float32Array[]; options: Partial<DenoiseOptions>; profileFrom?: Float32Array[] }
  | { id: number; op: 'beats'; samples: Float32Array; sampleRate: number; options: Partial<BeatOptions> }
  | { id: number; op: 'silence'; samples: Float32Array; sampleRate: number; options: Partial<SilenceOptions> }
  | { id: number; op: 'speech'; samples: Float32Array; sampleRate: number; options: Partial<SpeechOptions> };

export type DspResponse = { id: number; type: 'progress'; ratio: number } | { id: number; type: 'result'; result: unknown } | { id: number; type: 'error'; message: string };

self.onmessage = (e: MessageEvent<DspRequest>) => {
  const req = e.data;
  const progress = (ratio: number): void => self.postMessage({ id: req.id, type: 'progress', ratio } satisfies DspResponse);
  try {
    if (req.op === 'denoise') {
      // The profile can come from a longer stretch than the part being processed (A/B preview).
      const profile = learnNoiseProfile(toMono(req.profileFrom ?? req.channels));
      const n = req.channels.length;
      const out = req.channels.map((ch, i) => spectralGate(ch, profile, { ...DEFAULT_DENOISE, ...req.options }, (r) => progress((i + r) / n)));
      self.postMessage({ id: req.id, type: 'result', result: out } satisfies DspResponse, out.map((c) => c.buffer as ArrayBuffer));
    } else if (req.op === 'beats') {
      self.postMessage({ id: req.id, type: 'result', result: detectBeats(req.samples, req.sampleRate, req.options) } satisfies DspResponse);
    } else if (req.op === 'silence') {
      self.postMessage({ id: req.id, type: 'result', result: detectSilences(req.samples, req.sampleRate, req.options) } satisfies DspResponse);
    } else if (req.op === 'speech') {
      self.postMessage({ id: req.id, type: 'result', result: detectSpeech(req.samples, req.sampleRate, req.options) } satisfies DspResponse);
    }
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies DspResponse);
  }
};
