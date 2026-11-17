import { applyEase, lerp } from './easing';
import type { Clip, EaseId, Keyframe, KeyframeProp, VisualClip } from './types';

/** Two keyframes closer than this (seconds) are considered the same keyframe. */
export const KF_TOLERANCE = 1 / 240;

/** Evaluate a sorted keyframe track at `t` (seconds from clip start). */
export function evalKeyframes(frames: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!frames || frames.length === 0) return fallback;
  if (t <= frames[0].t) return frames[0].v;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.v;
  // Binary search for the segment containing t.
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  return lerp(a.v, b.v, applyEase(a.ease, (t - a.t) / span));
}

/** The static (non-keyframed) value of a property. */
export function baseProp(clip: Clip, prop: KeyframeProp): number {
  if (prop === 'volume') return clip.type === 'video' || clip.type === 'audio' || clip.type === 'compound' ? clip.volume : 1;
  if (clip.type === 'audio') return 0;
  return (clip as VisualClip).transform[prop];
}

/** Value of a property at a clip-local time, honouring keyframes. */
export function propAt(clip: Clip, prop: KeyframeProp, localTime: number): number {
  const frames = clip.keyframes?.[prop];
  const base = baseProp(clip, prop);
  return frames && frames.length ? evalKeyframes(frames, localTime, base) : base;
}

export function findKeyframeIndex(frames: Keyframe[] | undefined, t: number, tolerance = KF_TOLERANCE): number {
  if (!frames) return -1;
  for (let i = 0; i < frames.length; i++) if (Math.abs(frames[i].t - t) <= tolerance) return i;
  return -1;
}

/** Returns a new sorted track with a keyframe set at `t`. */
export function withKeyframe(frames: Keyframe[] | undefined, t: number, v: number, ease?: EaseId): Keyframe[] {
  const list = frames ? frames.slice() : [];
  const idx = findKeyframeIndex(list, t);
  if (idx >= 0) {
    list[idx] = { ...list[idx], v, ease: ease ?? list[idx].ease };
  } else {
    list.push({ t, v, ease: ease ?? 'easeInOut' });
    list.sort((a, b) => a.t - b.t);
  }
  return list;
}

export function withoutKeyframe(frames: Keyframe[] | undefined, t: number): Keyframe[] {
  if (!frames) return [];
  const idx = findKeyframeIndex(frames, t);
  if (idx < 0) return frames;
  const list = frames.slice();
  list.splice(idx, 1);
  return list;
}

export function hasKeyframes(clip: Clip, prop: KeyframeProp): boolean {
  const f = clip.keyframes?.[prop];
  return !!f && f.length > 0;
}

/** All distinct keyframe times of a clip (sorted), across every property. */
export function allKeyframeTimes(clip: Clip): number[] {
  const out: number[] = [];
  for (const frames of Object.values(clip.keyframes ?? {})) {
    for (const f of frames ?? []) {
      if (!out.some((t) => Math.abs(t - f.t) <= KF_TOLERANCE)) out.push(f.t);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Split a keyframe track at local time `s`. The left part keeps times ≤ s, the right part is
 * re-based to start at 0. A keyframe holding the interpolated value is added at the cut so both
 * halves keep animating exactly as before.
 */
export function splitKeyframes(frames: Keyframe[] | undefined, s: number, fallback: number): { left: Keyframe[]; right: Keyframe[] } {
  if (!frames || frames.length === 0) return { left: [], right: [] };
  const atCut = evalKeyframes(frames, s, fallback);
  const before = frames.filter((f) => f.t < s - KF_TOLERANCE);
  const after = frames.filter((f) => f.t > s + KF_TOLERANCE);
  const exact = frames.find((f) => Math.abs(f.t - s) <= KF_TOLERANCE);
  const prev = before[before.length - 1];
  const left = [...before];
  const right: Keyframe[] = [];
  if (after.length > 0 || exact) left.push({ t: s, v: atCut, ease: exact?.ease ?? 'linear' });
  if (before.length > 0 || exact) {
    // Carry the easing of the segment we cut through so the right half continues smoothly.
    right.push({ t: 0, v: atCut, ease: exact?.ease ?? prev?.ease ?? 'linear' });
  }
  for (const f of after) right.push({ ...f, t: f.t - s });
  // A single keyframe is equivalent to a constant; keep it so the value is preserved.
  return { left, right };
}
