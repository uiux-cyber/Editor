/**
 * Scene evaluation: which clips are visible / audible at a given time and what their animated
 * properties resolve to. Pure and GL-free so the preview, the exporter and the UI all agree.
 */

import { getAnimation } from '@/library';
import type { AnimMod } from '@/library/types';
import { propAt } from './keyframes';
import { instanceView, MAX_NESTING } from './compound';
import { getIndex } from './project';
import { clipEnd } from './time';
import type { AudioClip, Clip, ClipAnimations, CompoundClip, Project, Transition, VideoClip, VisualClip } from './types';

export interface LayerRef {
  clip: VisualClip;
  /** Seconds from the clip start. Can fall outside 0..duration inside a transition window. */
  localTime: number;
}

export type SceneItem =
  | { kind: 'layer'; layer: LayerRef }
  | { kind: 'transition'; transition: Transition; from: LayerRef; to: LayerRef; progress: number };

/** Index of the clip containing `time` in a start-sorted, non-overlapping list (or -1). */
export function findClipAt(clips: Clip[], time: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  return time < clipEnd(clips[found]) ? found : -1;
}

/** Visible items at `time`, ordered bottom → top. */
export function getSceneItems(project: Project, time: number): SceneItem[] {
  const idx = getIndex(project);
  const items: SceneItem[] = [];
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i];
    if (track.kind !== 'visual' || track.hidden) continue;
    const clips = idx.byTrack.get(track.id);
    if (!clips || clips.length === 0) continue;
    const at = findClipAt(clips, time);
    if (at < 0) continue;
    const clip = clips[at] as VisualClip;

    const trIn = idx.transIn.get(clip.id);
    if (trIn && time < clip.start + trIn.duration / 2) {
      const from = project.clips[trIn.fromId] as VisualClip | undefined;
      if (from) {
        const windowStart = clip.start - trIn.duration / 2;
        items.push({
          kind: 'transition',
          transition: trIn,
          from: { clip: from, localTime: time - from.start },
          to: { clip, localTime: time - clip.start },
          progress: (time - windowStart) / trIn.duration,
        });
        continue;
      }
    }
    const trOut = idx.transOut.get(clip.id);
    if (trOut && time >= clipEnd(clip) - trOut.duration / 2) {
      const to = project.clips[trOut.toId] as VisualClip | undefined;
      if (to) {
        const windowStart = clipEnd(clip) - trOut.duration / 2;
        items.push({
          kind: 'transition',
          transition: trOut,
          from: { clip, localTime: time - clip.start },
          to: { clip: to, localTime: time - to.start },
          progress: (time - windowStart) / trOut.duration,
        });
        continue;
      }
    }
    items.push({ kind: 'layer', layer: { clip, localTime: time - clip.start } });
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Layer resolution (keyframes + preset animations)
// ---------------------------------------------------------------------------------------------

export interface ResolvedLayer {
  /** Centre offset from the composition centre, design px. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees */
  rotation: number;
  opacity: number;
  /** Extra gaussian blur from animations, design px. */
  blur: number;
  /** Reveal insets, 0..1 of the layer hidden from each side. */
  clipL: number;
  clipR: number;
  clipT: number;
  clipB: number;
}

export interface AnimWindows {
  inDur: number;
  outDur: number;
}

/** Entrance / exit durations clamped so they never overlap inside a short clip. */
export function animWindows(anim: ClipAnimations | undefined, duration: number): AnimWindows {
  let inDur = anim?.in ? Math.max(0, anim.in.duration) : 0;
  let outDur = anim?.out ? Math.max(0, anim.out.duration) : 0;
  const total = inDur + outDur;
  if (total > duration && total > 0) {
    const k = duration / total;
    inDur *= k;
    outDur *= k;
  }
  return { inDur, outDur };
}

function applyMod(r: ResolvedLayer, m: AnimMod): void {
  if (m.x) r.x += m.x;
  if (m.y) r.y += m.y;
  const s = m.scale ?? 1;
  r.scaleX *= s * (m.scaleX ?? 1);
  r.scaleY *= s * (m.scaleY ?? 1);
  if (m.rotation) r.rotation += m.rotation;
  if (m.opacity !== undefined) r.opacity *= Math.min(1, Math.max(0, m.opacity));
  if (m.blur) r.blur += Math.max(0, m.blur);
  if (m.clipL) r.clipL = Math.max(r.clipL, Math.min(1, m.clipL));
  if (m.clipR) r.clipR = Math.max(r.clipR, Math.min(1, m.clipR));
  if (m.clipT) r.clipT = Math.max(r.clipT, Math.min(1, m.clipT));
  if (m.clipB) r.clipB = Math.max(r.clipB, Math.min(1, m.clipB));
}

/**
 * Resolve the placement of a layer at a clip-local time.
 * @param baseW natural (scale = 1) width of the layer in design px
 * @param cw composition width in design px
 */
export function resolveLayer(clip: VisualClip, localTime: number, baseW: number, baseH: number, cw: number, ch: number): ResolvedLayer {
  const t = Math.min(Math.max(localTime, 0), clip.duration);
  const r: ResolvedLayer = {
    x: propAt(clip, 'x', t),
    y: propAt(clip, 'y', t),
    scaleX: propAt(clip, 'scaleX', t),
    scaleY: propAt(clip, 'scaleY', t),
    rotation: propAt(clip, 'rotation', t),
    opacity: Math.min(1, Math.max(0, propAt(clip, 'opacity', t))),
    blur: 0,
    clipL: 0,
    clipR: 0,
    clipT: 0,
    clipB: 0,
  };
  const anim = clip.anim;
  if (!anim) return r;
  const env = { w: Math.abs(baseW * r.scaleX), h: Math.abs(baseH * r.scaleY), cw, ch };
  const { inDur, outDur } = animWindows(anim, clip.duration);
  if (anim.loop) {
    const def = getAnimation(anim.loop.id);
    const period = Math.max(0.05, anim.loop.duration);
    if (def && def.kind === 'loop') applyMod(r, def.apply((t / period) % 1, env));
  }
  if (anim.in && inDur > 0 && t < inDur) {
    const def = getAnimation(anim.in.id);
    if (def && def.kind === 'in') applyMod(r, def.apply(t / inDur, env));
  }
  if (anim.out && outDur > 0 && t > clip.duration - outDur) {
    const def = getAnimation(anim.out.id);
    if (def && def.kind === 'out') applyMod(r, def.apply((t - (clip.duration - outDur)) / outDur, env));
  }
  return r;
}

/** True while any preset or keyframe animation is changing the layer at this time. */
export function isAnimatingAt(clip: VisualClip, localTime: number): boolean {
  if (clip.anim?.loop) return true;
  const { inDur, outDur } = animWindows(clip.anim, clip.duration);
  if (localTime < inDur || localTime > clip.duration - outDur) return true;
  return !!clip.keyframes && Object.values(clip.keyframes).some((f) => f && f.length > 1);
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

/** Linear gain of an audio-bearing clip at a clip-local time (volume × keyframes × fades). */
export function clipGainAt(clip: VideoClip | AudioClip | CompoundClip, localTime: number): number {
  if (localTime < 0 || localTime > clip.duration) return 0;
  let g = propAt(clip, 'volume', localTime);
  if (clip.fadeIn > 0 && localTime < clip.fadeIn) g *= localTime / clip.fadeIn;
  const remaining = clip.duration - localTime;
  if (clip.fadeOut > 0 && remaining < clip.fadeOut) g *= remaining / clip.fadeOut;
  return Math.min(4, Math.max(0, g));
}

export interface AudibleClip {
  clip: VideoClip | AudioClip;
  localTime: number;
  gain: number;
}

/** Every clip that should currently be heard. */
export function getAudibleClips(project: Project, time: number): AudibleClip[] {
  const idx = getIndex(project);
  const out: AudibleClip[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    const clips = idx.byTrack.get(track.id);
    if (!clips || clips.length === 0) continue;
    const at = findClipAt(clips, time);
    if (at < 0) continue;
    const clip = clips[at];
    // Freeze frames are silent.
    if ((clip.type !== 'video' && clip.type !== 'audio') || clip.muted || clip.freeze) continue;
    const asset = project.assets[clip.assetId];
    if (!asset || !asset.hasAudio) continue;
    const localTime = time - clip.start;
    out.push({ clip, localTime, gain: clipGainAt(clip, localTime) });
  }
  return out;
}

/**
 * All audio-bearing clips that are not silenced by their clip or track mute. Clips inside
 * compound clips are included (as instance clips, in nested time).
 */
export function getAudioClips(project: Project, depth = 0): (VideoClip | AudioClip)[] {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const out: (VideoClip | AudioClip)[] = [];
  for (const clip of Object.values(project.clips)) {
    if (clip.type === 'compound') {
      if (!clip.muted && !muted.has(clip.trackId) && depth < MAX_NESTING) out.push(...getAudioClips(instanceView(project, clip), depth + 1));
      continue;
    }
    if ((clip.type !== 'video' && clip.type !== 'audio') || clip.muted || clip.freeze || muted.has(clip.trackId)) continue;
    const asset = project.assets[clip.assetId];
    if (asset && asset.hasAudio) out.push(clip);
  }
  return out;
}
