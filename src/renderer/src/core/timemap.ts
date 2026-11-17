/**
 * Time remapping: how a timed-media clip maps its clip-local time to source-media time.
 *
 *  - Constant speed:  source = trimIn + t · speed
 *  - Speed ramp:      source = trimIn + s(t), s(t) = ∫₀ᵗ speed(u) du, speed() = the `speedRamp`
 *                     keyframes (clip-local seconds, values 0.1…16, eased between keyframes).
 *                     Outside the keyframes the speed is held, so s() extends linearly (transition
 *                     handles and edge trims keep working).
 *  - Reverse:         the same source range [trimIn, trimIn + span] played backwards:
 *                     source = trimIn + span − s(t), span = s(duration).
 *  - Freeze:          source = trimIn for the whole clip (picture held, sound silent).
 *
 * Pure and DOM-free: the timeline, preview, exporter and tests all use these functions so a frame
 * is always taken from the same source time everywhere.
 */

import { Ease, applyEase } from './easing';
import { splitKeyframes } from './keyframes';
import type { Clip, CompoundClip, EaseId, ID, Keyframe, MediaAsset, TimedMediaProps } from './types';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

/** The fields of a clip that take part in time mapping. */
export type TimedClip = Pick<TimedMediaProps, 'trimIn' | 'speed' | 'speedRamp' | 'reverse' | 'freeze'> & { duration: number };

/** Eases that never overshoot (speed must stay positive and inside its range). */
export const RAMP_EASES: EaseId[] = [
  'linear',
  'hold',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInQuart',
  'easeOutQuart',
  'easeInOutQuart',
  'easeInExpo',
  'easeOutExpo',
  'easeInOutExpo',
];

export const clampSpeed = (v: number): number => (Number.isFinite(v) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, v)) : 1);

const hasRamp = (clip: Pick<TimedMediaProps, 'speedRamp'>): clip is { speedRamp: Keyframe[] } => !!clip.speedRamp && clip.speedRamp.length > 0;

// ---------------------------------------------------------------------------------------------
// Ease integrals: F(x) = ∫₀ˣ ease(y) dy, tabulated once per ease and read back with cubic Hermite
// interpolation (the derivative of F is the ease itself), accurate to ~1e-10.
// ---------------------------------------------------------------------------------------------

const EASE_TABLE_N = 256;
const easeTables = new Map<EaseId, Float64Array>();

function easeTable(id: EaseId): Float64Array {
  let table = easeTables.get(id);
  if (table) return table;
  const fn = Ease[id] ?? Ease.linear;
  table = new Float64Array(EASE_TABLE_N + 1);
  const h = 1 / EASE_TABLE_N;
  const sub = 8;
  for (let i = 0; i < EASE_TABLE_N; i++) {
    // Composite Simpson over [i·h, (i+1)·h] with `sub` sub-intervals.
    const a = i * h;
    const k = h / sub;
    let sum = fn(a) + fn(Math.min(1, a + h));
    for (let j = 1; j < sub; j++) sum += (j % 2 ? 4 : 2) * fn(a + j * k);
    table[i + 1] = table[i] + (sum * k) / 3;
  }
  easeTables.set(id, table);
  return table;
}

/** ∫₀ˣ ease(y) dy for x in [0, 1]. */
export function easeIntegral(id: EaseId | undefined, x: number): number {
  const ease = id ?? 'linear';
  if (x <= 0) return 0;
  if (ease === 'linear') return 0.5 * Math.min(1, x) * Math.min(1, x);
  // 'hold' keeps the start value for the whole segment: its ease is 0 until the very end.
  if (ease === 'hold') return 0;
  const table = easeTable(ease);
  if (x >= 1) return table[EASE_TABLE_N];
  const fn = Ease[ease];
  const f = x * EASE_TABLE_N;
  const i = Math.min(EASE_TABLE_N - 1, Math.floor(f));
  const u = f - i;
  const h = 1 / EASE_TABLE_N;
  const y0 = table[i];
  const y1 = table[i + 1];
  const d0 = fn(i * h) * h;
  const d1 = fn((i + 1) * h) * h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * d0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * d1;
}

// ---------------------------------------------------------------------------------------------
// Ramp integral and inverse
// ---------------------------------------------------------------------------------------------

interface RampTable {
  /** s() at each keyframe time. */
  cum: Float64Array;
}

const rampTables = new WeakMap<Keyframe[], RampTable>();

function segmentIntegral(a: Keyframe, b: Keyframe, x: number): number {
  // ∫ over the first x (0..1) of the segment of lerp(a.v, b.v, ease(y)), times the segment length.
  const span = b.t - a.t;
  if (span <= 0) return 0;
  return span * (a.v * x + (b.v - a.v) * easeIntegral(a.ease, x));
}

function rampTable(frames: Keyframe[]): RampTable {
  let table = rampTables.get(frames);
  if (table) return table;
  const cum = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) cum[i] = cum[i - 1] + segmentIntegral(frames[i - 1], frames[i], 1);
  table = { cum };
  rampTables.set(frames, table);
  return table;
}

/** Speed of a ramp at clip-local time t (held before the first / after the last keyframe). */
export function rampSpeedAt(frames: Keyframe[], t: number): number {
  const n = frames.length;
  if (t <= frames[0].t) return frames[0].v;
  if (t >= frames[n - 1].t) return frames[n - 1].v;
  const i = segmentIndex(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  return span > 0 ? a.v + (b.v - a.v) * applyEase(a.ease, (t - a.t) / span) : b.v;
}

function segmentIndex(frames: Keyframe[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** ∫ speed from the first keyframe's time to x (negative before it). */
function absIntegral(frames: Keyframe[], x: number): number {
  const n = frames.length;
  const { cum } = rampTable(frames);
  if (x <= frames[0].t) return (x - frames[0].t) * frames[0].v;
  if (x >= frames[n - 1].t) return cum[n - 1] + (x - frames[n - 1].t) * frames[n - 1].v;
  const i = segmentIndex(frames, x);
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  return cum[i] + (span > 0 ? segmentIntegral(a, b, (x - a.t) / span) : 0);
}

/** s(t) = ∫₀ᵗ speed(u) du for a ramp (negative for t < 0). */
export function rampIntegral(frames: Keyframe[], t: number): number {
  return absIntegral(frames, t) - absIntegral(frames, 0);
}

/** Inverse of rampIntegral: the local time t at which s(t) = s. */
export function rampInverse(frames: Keyframe[], s: number): number {
  const n = frames.length;
  const { cum } = rampTable(frames);
  const target = s + absIntegral(frames, 0);
  if (target <= 0) return frames[0].t + target / frames[0].v;
  if (target >= cum[n - 1]) return frames[n - 1].t + (target - cum[n - 1]) / frames[n - 1].v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[lo + 1];
  const span = b.t - a.t;
  if (span <= 0) return a.t;
  const want = target - cum[lo];
  // Bisection on a strictly increasing function (speeds are always ≥ MIN_SPEED).
  let x0 = 0;
  let x1 = 1;
  for (let k = 0; k < 52; k++) {
    const xm = 0.5 * (x0 + x1);
    if (segmentIntegral(a, b, xm) < want) x0 = xm;
    else x1 = xm;
  }
  return a.t + 0.5 * (x0 + x1) * span;
}

// ---------------------------------------------------------------------------------------------
// Clip mapping
// ---------------------------------------------------------------------------------------------

/** Playback rate (source seconds per timeline second) at a clip-local time. 0 for freeze frames. */
export function speedAt(clip: TimedClip, t: number): number {
  if (clip.freeze) return 0;
  return hasRamp(clip) ? rampSpeedAt(clip.speedRamp, t) : clip.speed;
}

/** Source seconds consumed from the clip start up to local time t (s(t)). */
export function consumedAt(clip: TimedClip, t: number): number {
  if (clip.freeze) return 0;
  return hasRamp(clip) ? rampIntegral(clip.speedRamp, t) : t * clip.speed;
}

/** Local time at which `s` source seconds have been consumed (inverse of consumedAt). */
export function localForConsumed(clip: TimedClip, s: number): number {
  if (clip.freeze) return Infinity;
  return hasRamp(clip) ? rampInverse(clip.speedRamp, s) : s / clip.speed;
}

/** Source seconds covered by the whole clip. */
export function sourceSpan(clip: TimedClip): number {
  return consumedAt(clip, clip.duration);
}

/** Source media time shown at a clip-local time. */
export function sourceTimeAt(clip: TimedClip, localTime: number): number {
  if (clip.freeze) return clip.trimIn;
  const s = consumedAt(clip, localTime);
  return clip.reverse ? clip.trimIn + sourceSpan(clip) - s : clip.trimIn + s;
}

/** Inverse of sourceTimeAt: the local time at which `source` is shown (may fall outside the clip). */
export function localTimeAtSource(clip: TimedClip, source: number): number {
  if (clip.freeze) return 0;
  const s = clip.reverse ? clip.trimIn + sourceSpan(clip) - source : source - clip.trimIn;
  return localForConsumed(clip, s);
}

/** Lowest and highest source time used by the clip. */
export function sourceRange(clip: TimedClip): { from: number; to: number } {
  if (clip.freeze) return { from: clip.trimIn, to: clip.trimIn };
  return { from: clip.trimIn, to: clip.trimIn + sourceSpan(clip) };
}

/** Average playback rate over the clip (1 for freeze frames, which have no rate). */
export function averageSpeed(clip: TimedClip): number {
  if (clip.freeze) return 1;
  return clip.duration > 0 ? sourceSpan(clip) / clip.duration : speedAt(clip, 0);
}

export const isRamped = (clip: Clip): boolean => (clip.type === 'video' || clip.type === 'audio') && hasRamp(clip) && !clip.freeze;

// ---------------------------------------------------------------------------------------------
// Limits (media available around the clip)
// ---------------------------------------------------------------------------------------------

/** Natural end of a compound clip's nested sequence. */
export function sequenceEnd(clip: CompoundClip): number {
  let end = 0;
  for (const c of Object.values(clip.sequence.clips)) end = Math.max(end, c.start + c.duration);
  return end;
}

/**
 * Longest timeline duration the clip can have while its start keeps showing the same content
 * (Infinity when unlimited). Reversed clips grow towards earlier source time.
 */
export function maxDurationFor(clip: Clip, assets: Record<ID, MediaAsset>): number {
  if (clip.type === 'compound') return Math.max(0, sequenceEnd(clip) - clip.trimIn);
  if (clip.type !== 'video' && clip.type !== 'audio') return Infinity;
  if (clip.freeze) return Infinity;
  const asset = assets[clip.assetId];
  if (!asset || !(asset.duration > 0)) return Infinity;
  if (clip.reverse) {
    // The start shows trimIn + span; the end may run down to source time 0.
    return Math.max(0, localForConsumed(clip, clip.trimIn + sourceSpan(clip)));
  }
  return Math.max(0, localForConsumed(clip, Math.max(0, asset.duration - clip.trimIn)));
}

/** How far (timeline seconds) the clip's start can move earlier while its end stays put. */
export function maxStartExtension(clip: Clip, assets: Record<ID, MediaAsset>): number {
  if (clip.type === 'compound') return Math.max(0, clip.trimIn);
  if (clip.type !== 'video' && clip.type !== 'audio') return Infinity;
  if (clip.freeze) return Infinity;
  const v0 = speedAt(clip, 0);
  if (clip.reverse) {
    const asset = assets[clip.assetId];
    if (!asset || !(asset.duration > 0)) return Infinity;
    return Math.max(0, (asset.duration - clip.trimIn - sourceSpan(clip)) / v0);
  }
  return Math.max(0, clip.trimIn / v0);
}

// ---------------------------------------------------------------------------------------------
// Retiming edits
// ---------------------------------------------------------------------------------------------

/**
 * Mutates `clip` (a draft) so that it shows exactly what `orig` showed from local time `cut`
 * onwards, for `duration` seconds: the new clip's local time t shows orig's local time t + cut.
 * Handles trimIn for every mapping (constant, ramp, reverse, freeze, compound) and re-bases the
 * speed ramp. `cut` > 0 trims the start, < 0 extends it; it may be 0 for an end trim.
 * Keyframes of other properties are left to the caller.
 */
export function retimeClip(clip: Clip, orig: Clip, cut: number, duration: number): void {
  clip.duration = duration;
  if (clip.type === 'compound' && orig.type === 'compound') {
    clip.trimIn = Math.max(0, orig.trimIn + cut);
    return;
  }
  if ((clip.type !== 'video' && clip.type !== 'audio') || (orig.type !== 'video' && orig.type !== 'audio')) return;
  if (orig.freeze) {
    clip.trimIn = orig.trimIn;
    return;
  }
  // Source shown at the new start and at the new end, in orig's mapping.
  const a = sourceTimeAt(orig, cut);
  const b = sourceTimeAt(orig, cut + duration);
  clip.trimIn = Math.max(0, Math.min(a, b));
  if (orig.speedRamp && orig.speedRamp.length) clip.speedRamp = shiftRamp(orig.speedRamp, cut);
}

/** Ramp keyframes re-based so that local time `cut` becomes 0. */
export function shiftRamp(frames: Keyframe[], cut: number): Keyframe[] {
  if (Math.abs(cut) < 1e-9) return frames.map((k) => ({ ...k }));
  if (cut < 0) return frames.map((k) => ({ ...k, t: k.t - cut }));
  const { right } = splitKeyframes(frames, cut, frames[0].v);
  if (right.length) return right;
  // Every keyframe was before the cut: the held last value applies.
  return [{ t: 0, v: frames[frames.length - 1].v, ease: 'linear' }];
}

// ---------------------------------------------------------------------------------------------
// Speed curves (normalised over the clip)
// ---------------------------------------------------------------------------------------------

/** A curve point: `u` = position in the clip (0…1), `v` = speed. */
export interface CurvePoint {
  u: number;
  v: number;
}

export interface RampPreset {
  id: string;
  name: string;
  points: CurvePoint[];
}

/** Classic speed-ramp shapes, defined over the clip (0…1) so they fit any length. */
export const RAMP_PRESETS: RampPreset[] = [
  { id: 'montage', name: 'Montage', points: [{ u: 0, v: 1 }, { u: 0.17, v: 3.2 }, { u: 0.36, v: 0.55 }, { u: 0.56, v: 0.55 }, { u: 0.76, v: 3.2 }, { u: 1, v: 1 }] },
  { id: 'hero', name: 'Hero time', points: [{ u: 0, v: 1.6 }, { u: 0.3, v: 1.6 }, { u: 0.44, v: 0.25 }, { u: 0.6, v: 0.25 }, { u: 0.74, v: 1.6 }, { u: 1, v: 1.6 }] },
  { id: 'bullet', name: 'Bullet', points: [{ u: 0, v: 3 }, { u: 0.38, v: 3 }, { u: 0.5, v: 0.15 }, { u: 0.62, v: 3 }, { u: 1, v: 3 }] },
  { id: 'jump-cut', name: 'Jump cut', points: [{ u: 0, v: 1 }, { u: 0.36, v: 1 }, { u: 0.44, v: 8 }, { u: 0.56, v: 8 }, { u: 0.64, v: 1 }, { u: 1, v: 1 }] },
  { id: 'flash-in', name: 'Flash in', points: [{ u: 0, v: 8 }, { u: 0.32, v: 1 }, { u: 1, v: 1 }] },
  { id: 'flash-out', name: 'Flash out', points: [{ u: 0, v: 1 }, { u: 0.68, v: 1 }, { u: 1, v: 8 }] },
  { id: 'ramp-up', name: 'Ramp up', points: [{ u: 0, v: 0.5 }, { u: 1, v: 3 }] },
  { id: 'ramp-down', name: 'Ramp down', points: [{ u: 0, v: 3 }, { u: 1, v: 0.5 }] },
];

export const RAMP_EASE: EaseId = 'easeInOut';

/** Normalised points → keyframes for a clip of `duration` seconds. */
export function curveToRamp(points: CurvePoint[], duration: number, ease: EaseId = RAMP_EASE): Keyframe[] {
  const sorted = [...points].sort((a, b) => a.u - b.u);
  return sorted.map((p) => ({ t: Math.min(1, Math.max(0, p.u)) * duration, v: clampSpeed(p.v), ease }));
}

/** Keyframes → normalised points (only the part inside the clip). */
export function rampToCurve(frames: Keyframe[], duration: number): CurvePoint[] {
  const d = Math.max(1e-6, duration);
  const inside = frames.filter((k) => k.t >= -1e-6 && k.t <= d + 1e-6).map((k) => ({ u: Math.min(1, Math.max(0, k.t / d)), v: k.v }));
  // Make sure both ends exist so the curve covers the whole clip.
  if (!inside.length || inside[0].u > 1e-6) inside.unshift({ u: 0, v: rampSpeedAt(frames, 0) });
  if (inside[inside.length - 1].u < 1 - 1e-6) inside.push({ u: 1, v: rampSpeedAt(frames, d) });
  return inside;
}

/** Mean speed of a normalised curve: ∫₀¹ v(u) du. */
export function curveAverage(points: CurvePoint[], ease: EaseId = RAMP_EASE): number {
  const frames = curveToRamp(points, 1, ease);
  return frames.length === 1 ? frames[0].v : rampIntegral(frames, 1);
}

export interface RetimeLimits {
  /** Media duration (seconds) of the clip's asset, if known. */
  assetDuration?: number;
  /** Most timeline time the clip may occupy (e.g. up to the next clip on the track). */
  room?: number;
  fps: number;
}

/**
 * Mutates a timed-media draft: applies a speed curve (or a constant speed when `points` is null)
 * while keeping the source content of the clip, so the duration follows the speed. The duration
 * is limited by the media available and by `room`; when it has to be shortened the clip keeps
 * its start content.
 */
export function applySpeed(clip: TimedClip & { speedRamp?: Keyframe[] }, points: CurvePoint[] | number, limits: RetimeLimits): void {
  const f = Math.max(1, limits.fps);
  const span = clip.freeze ? clip.duration : sourceSpan(clip);
  const top = clip.trimIn + span;
  const avg = typeof points === 'number' ? clampSpeed(points) : curveAverage(points);
  let duration = span / avg;
  // Media available: forward clips grow towards the end of the asset, reversed ones towards 0.
  const available = clip.reverse ? top : limits.assetDuration && limits.assetDuration > 0 ? limits.assetDuration - clip.trimIn : Infinity;
  if (Number.isFinite(available)) duration = Math.min(duration, Math.max(0, available) / avg);
  if (limits.room !== undefined) duration = Math.min(duration, limits.room);
  duration = Math.max(1 / f, Math.round(duration * f + 1e-7) / f);
  if (typeof points === 'number') {
    clip.speed = avg;
    delete clip.speedRamp;
  } else {
    clip.speedRamp = curveToRamp(points, duration);
    // Keep `speed` meaningful for older readers: the average rate.
    clip.speed = Math.round(avg * 1000) / 1000;
  }
  clip.duration = duration;
  if (clip.reverse) {
    // Keep the first frame: the top of the range stays where it was.
    clip.trimIn = Math.max(0, top - sourceSpan(clip));
  }
}

/** Sanitise loaded ramp keyframes; returns undefined when unusable. */
export function sanitizeRamp(raw: unknown): Keyframe[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const frames: Keyframe[] = [];
  for (const k of raw) {
    if (!k || typeof k !== 'object') continue;
    const { t, v, ease } = k as Partial<Keyframe>;
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    frames.push({ t, v: clampSpeed(v), ease: ease && RAMP_EASES.includes(ease) ? ease : RAMP_EASE });
  }
  frames.sort((a, b) => a.t - b.t);
  return frames.length ? frames : undefined;
}
