/**
 * Timing for animated media assets (kind 'animation'): animated GIF / WebP / APNG frame
 * timelines and Lottie documents. Pure functions — the decoding lives in engine/media/animated.ts.
 */

/** Seconds. Browsers show GIF frames with a delay of 10 ms or less for 100 ms; so do we. */
export function normalizeFrameDelay(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0.0105 ? seconds : 0.1;
}

export interface FrameTimeline {
  /** Start time of each frame within one loop, seconds. */
  starts: number[];
  durations: number[];
  /** Length of one loop, seconds. */
  total: number;
}

/** Build a looping timeline from per-frame durations (seconds, already normalised). */
export function buildTimeline(durations: number[]): FrameTimeline {
  const starts: number[] = [];
  let t = 0;
  for (const d of durations) {
    starts.push(t);
    t += d;
  }
  return { starts, durations: [...durations], total: t };
}

/** Index of the frame shown at `time` seconds (the animation loops forever). */
export function frameIndexAt(tl: FrameTimeline, time: number): number {
  const n = tl.starts.length;
  if (n <= 1 || !(tl.total > 0)) return 0;
  let t = Number.isFinite(time) ? time % tl.total : 0;
  if (t < 0) t += tl.total;
  // Guard against floating point drift right at the loop point.
  if (t >= tl.total - 1e-9) t = 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.starts[mid] <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Default timeline length of a clip made from an animation asset: one loop, at least 3 s. */
export function defaultAnimationClipDuration(loopSeconds: number): number {
  return Math.max(3, Number.isFinite(loopSeconds) ? loopSeconds : 0);
}

// ---------------------------------------------------------------------------------------------
// Lottie
// ---------------------------------------------------------------------------------------------

export interface LottieInfo {
  width: number;
  height: number;
  /** Frames per second. */
  fps: number;
  /** In / out point, frames. */
  ip: number;
  op: number;
  /** Frames in one loop (op - ip). */
  frames: number;
  /** Seconds in one loop. */
  duration: number;
  name?: string;
}

/** Check that a parsed JSON document is a Lottie (Bodymovin) animation. Returns its facts or a reason. */
export function validateLottie(doc: unknown): LottieInfo | string {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return 'The file is not a Lottie animation.';
  const d = doc as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const fr = n(d.fr);
  const ip = n(d.ip);
  const op = n(d.op);
  const w = n(d.w);
  const h = n(d.h);
  if (!Array.isArray(d.layers) || [fr, ip, op, w, h].some((v) => Number.isNaN(v))) return 'The JSON file is not a Lottie animation (missing frame rate, size or layers).';
  if (!(fr > 0 && fr <= 240)) return 'The Lottie animation has an invalid frame rate.';
  if (!(w >= 1 && h >= 1 && w <= 16384 && h <= 16384)) return 'The Lottie animation has an invalid size.';
  if (!(op > ip)) return 'The Lottie animation has no frames.';
  if (d.layers.length === 0) return 'The Lottie animation has no layers.';
  const frames = op - ip;
  return { width: Math.round(w), height: Math.round(h), fps: fr, ip, op, frames, duration: frames / fr, name: typeof d.nm === 'string' ? d.nm : undefined };
}

/** Lottie frame (relative to `ip`, fractional) shown at `time` seconds; loops forever. */
export function lottieFrameAt(info: Pick<LottieInfo, 'fps' | 'frames'>, time: number): number {
  if (!(info.frames > 0)) return 0;
  let f = (Number.isFinite(time) ? time : 0) * info.fps;
  f %= info.frames;
  if (f < 0) f += info.frames;
  // Stay strictly inside the range: frame `frames` is the first frame of the next loop.
  return Math.min(f, info.frames - 1e-3);
}
