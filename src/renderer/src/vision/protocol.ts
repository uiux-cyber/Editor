/**
 * Messages between the main thread (vision/client.ts) and the vision worker (vision/worker.ts).
 * Every request carries an id; the worker answers with progress messages and one result or
 * error. Long jobs check a cancellation flag between frames.
 */

import type { FocusSample } from './algo/camera';
import type { GradeInput, MatchResult } from './algo/color';
import type { FrameStat } from './algo/scenes';
import type { PathSample } from './algo/tracker';

/** Where pixels come from: a streamable media URL (video or image file). */
export interface MediaRef {
  url: string;
  kind: 'video' | 'image';
}

export interface InitInfo {
  segmenter: 'GPU' | 'CPU' | 'none';
  detectors: 'GPU' | 'CPU' | 'none';
  /** Milliseconds spent loading. */
  ms: number;
}

export interface MaskResult {
  mask: Uint8Array;
  w: number;
  h: number;
  /** Inference time, ms. */
  ms: number;
}

export interface FocusAnalysis {
  samples: (FocusSample & { kind: 'face' | 'object' | 'saliency' | 'centre' })[];
  /** Picture size of the analysed source. */
  width: number;
  height: number;
  ms: number;
}

export interface SceneAnalysis {
  stats: FrameStat[];
  fps: number;
  ms: number;
}

export interface ColorMatchRequest {
  source: MediaRef & { times: number[] };
  reference: MediaRef & { times: number[] };
  /** Grades applied to the reference as displayed (its Adjust then its Filter). */
  referenceGrades: (GradeInput | null)[];
  /** The clip's current Adjust (kept for the fields that are not solved) and its Filter. */
  baseAdjust: GradeInput;
  filter: GradeInput | null;
  strength: number;
  /** Size of the before / after / reference preview images. */
  previewWidth: number;
}

export interface ColorMatchResponse extends MatchResult {
  /** RGBA previews (same size) of the reference, the clip before and after the match. */
  previews: { w: number; h: number; reference: Uint8ClampedArray; before: Uint8ClampedArray; after: Uint8ClampedArray };
  ms: number;
}

export interface TrackRequest {
  media: MediaRef;
  /** Source time of the frame the box was drawn on. */
  t0: number;
  /** Source range to track (inclusive start, exclusive end). */
  start: number;
  end: number;
  /** Box in normalised source coordinates (0..1), centre + size. */
  box: { cx: number; cy: number; w: number; h: number };
}

export interface TrackResponse {
  /** One sample per source frame, normalised coordinates; sorted by time. */
  samples: (PathSample & { w: number; h: number })[];
  frames: number;
  ms: number;
}

export type VisionRequest =
  | { type: 'init'; wasmBase: string; loaderUrl: string; models: Record<'segmenter' | 'face' | 'object', string>; gpu: boolean }
  | { type: 'segment'; bitmap: ImageBitmap }
  | { type: 'focus'; media: MediaRef; fps: number; start: number; end: number }
  | { type: 'scenes'; media: MediaRef; start: number; end: number; width: number }
  | { type: 'thumbs'; media: MediaRef; times: number[]; width: number }
  | { type: 'colorMatch'; req: ColorMatchRequest }
  | { type: 'track'; req: TrackRequest };

export type WorkerMessage =
  | { id: number; type: 'progress'; value: number; label?: string }
  | { id: number; type: 'result'; data: unknown }
  | { id: number; type: 'error'; message: string };

export type MainMessage = ({ id: number } & VisionRequest) | { id: number; type: 'cancel'; target: number };
