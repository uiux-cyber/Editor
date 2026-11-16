/**
 * Recursive evaluation of compound clips for playback: which media clips (at any nesting depth)
 * need a picture or are heard at a time, and the whole-timeline list of media instances used to
 * mix audio and to warm decoders ahead of the playhead.
 *
 * Nested clips are reported as instance clips (ids prefixed with their compound ids, see
 * core/compound.ts) with times in their own clip-local time base.
 */

import { MAX_NESTING, instanceView } from './compound';
import { getIndex } from './project';
import { clipGainAt, findClipAt, getAudibleClips, getSceneItems } from './scene';
import { clipEnd } from './time';
import type { AudioClip, CompoundClip, Project, VideoClip } from './types';

export interface PictureRef {
  clip: VideoClip;
  /** Clip-local time (may fall outside the clip inside a transition window). */
  localTime: number;
}

/** Video clips whose picture is on screen at `time`, including inside compound clips. */
export function pictureRefsAt(project: Project, time: number, depth = 0, out: PictureRef[] = []): PictureRef[] {
  for (const item of getSceneItems(project, time)) {
    const refs = item.kind === 'layer' ? [item.layer] : [item.from, item.to];
    for (const ref of refs) {
      if (ref.clip.type === 'video') out.push({ clip: ref.clip, localTime: ref.localTime });
      else if (ref.clip.type === 'compound' && depth < MAX_NESTING) pictureRefsAt(instanceView(project, ref.clip), ref.clip.trimIn + ref.localTime, depth + 1, out);
    }
  }
  return out;
}

export interface SoundRef {
  clip: VideoClip | AudioClip;
  localTime: number;
  /** Clip gain × the gain of every enclosing compound clip. */
  gain: number;
}

/** Every media clip heard at `time`, including the sound of compound clips. */
export function soundsAt(project: Project, time: number, gainMul = 1, depth = 0, out: SoundRef[] = []): SoundRef[] {
  for (const a of getAudibleClips(project, time)) out.push({ clip: a.clip, localTime: a.localTime, gain: a.gain * gainMul });
  if (depth >= MAX_NESTING) return out;
  const idx = getIndex(project);
  for (const track of project.tracks) {
    if (track.muted || track.kind !== 'visual') continue;
    const clips = idx.byTrack.get(track.id);
    if (!clips?.length) continue;
    const at = findClipAt(clips, time);
    if (at < 0) continue;
    const clip = clips[at];
    if (clip.type !== 'compound' || clip.muted) continue;
    const local = time - clip.start;
    soundsAt(instanceView(project, clip), clip.trimIn + local, gainMul * clipGainAt(clip, local), depth + 1, out);
  }
  return out;
}

export interface MediaInstance {
  clip: VideoClip | AudioClip;
  /** Top-level timeline time of the clip's local time 0. */
  origin: number;
  /** Top-level window in which the instance plays (cut by every enclosing compound clip). */
  from: number;
  to: number;
  /** Enclosing compound clips, outermost first, with the top-level time of their local 0. */
  parents: { clip: CompoundClip; origin: number }[];
  /** False when muted by the clip, its track or an enclosing compound / track. */
  audible: boolean;
}

const instanceCache = new WeakMap<Project, MediaInstance[]>();

/** Every video / audio clip of the timeline, flattened through compound clips (memoised). */
export function mediaInstances(project: Project): MediaInstance[] {
  let list = instanceCache.get(project);
  if (list) return list;
  list = [];
  collect(project, 0, -Infinity, Infinity, [], true, 0, list);
  list.sort((a, b) => a.from - b.from);
  instanceCache.set(project, list);
  return list;
}

function collect(view: Project, origin: number, from: number, to: number, parents: MediaInstance['parents'], audible: boolean, depth: number, out: MediaInstance[]): void {
  const muted = new Set(view.tracks.filter((t) => t.muted).map((t) => t.id));
  for (const clip of Object.values(view.clips)) {
    const a = Math.max(from, origin + clip.start);
    const b = Math.min(to, origin + clipEnd(clip));
    if (b - a <= 1e-9) continue;
    const heard = audible && !muted.has(clip.trackId);
    if (clip.type === 'video' || clip.type === 'audio') {
      out.push({ clip, origin: origin + clip.start, from: a, to: b, parents, audible: heard && !clip.muted && !clip.freeze });
    } else if (clip.type === 'compound' && depth < MAX_NESTING) {
      const start = origin + clip.start;
      collect(instanceView(view, clip), start - clip.trimIn, a, b, [...parents, { clip, origin: start }], heard && !clip.muted, depth + 1, out);
    }
  }
}

/** Combined gain of the compound clips around an instance at a top-level time. */
export function parentGainAt(inst: MediaInstance, time: number): number {
  let g = 1;
  for (const p of inst.parents) g *= clipGainAt(p.clip, time - p.origin);
  return g;
}
