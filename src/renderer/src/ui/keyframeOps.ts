import { KF_TOLERANCE, findKeyframeIndex, propAt, withKeyframe, withoutKeyframe } from '@/core/keyframes';
import type { Clip, ID, KeyframeProp } from '@/core/types';
import { engine } from '@/engine/engine';
import { getProject, updateProject } from '@/store/project';

/** Playhead position inside a clip, clamped to the clip. */
export function localTimeOf(clip: Pick<Clip, 'start' | 'duration'>): number {
  return Math.min(Math.max(engine.time - clip.start, 0), clip.duration);
}

/**
 * Mutates a draft clip: write `value` to a property. When the property is keyframed the value
 * is written as a keyframe at the playhead (auto-key), otherwise to the static value.
 */
export function writeProp(clip: Clip, prop: KeyframeProp, value: number): void {
  const frames = clip.keyframes?.[prop];
  if (frames && frames.length > 0) {
    clip.keyframes![prop] = withKeyframe(frames, localTimeOf(clip), value);
    return;
  }
  if (prop === 'volume') {
    if (clip.type === 'video' || clip.type === 'audio') clip.volume = value;
  } else if (clip.type !== 'audio') {
    clip.transform[prop] = value;
  }
}

export function hasKeyframeAtPlayhead(clip: Clip, prop: KeyframeProp): boolean {
  return findKeyframeIndex(clip.keyframes?.[prop], localTimeOf(clip), KF_TOLERANCE * 2) >= 0;
}

/** Add or remove a keyframe at the playhead for the given properties (as one undo step). */
export function toggleKeyframe(ids: ID[], props: KeyframeProp[]): void {
  const project = getProject();
  const first = project.clips[ids[0]];
  if (!first) return;
  const remove = props.every((p) => hasKeyframeAtPlayhead(first, p));
  updateProject((p) => {
    for (const id of ids) {
      const clip = p.clips[id];
      if (!clip) continue;
      const t = localTimeOf(clip);
      for (const prop of props) {
        const frames = clip.keyframes?.[prop];
        if (remove) {
          const next = withoutKeyframe(frames, t);
          if (clip.keyframes) {
            if (next.length) clip.keyframes[prop] = next;
            else delete clip.keyframes[prop];
          }
        } else {
          clip.keyframes ??= {};
          clip.keyframes[prop] = withKeyframe(frames, t, propAt(clip, prop, t));
        }
      }
    }
  });
}

/** Jump the playhead to the previous / next keyframe of the given properties. */
export function jumpKeyframe(clip: Clip, props: KeyframeProp[], direction: -1 | 1): void {
  const t = localTimeOf(clip);
  const times = new Set<number>();
  for (const prop of props) for (const f of clip.keyframes?.[prop] ?? []) times.add(f.t);
  const sorted = [...times].sort((a, b) => a - b);
  const target = direction > 0 ? sorted.find((x) => x > t + KF_TOLERANCE * 2) : [...sorted].reverse().find((x) => x < t - KF_TOLERANCE * 2);
  if (target !== undefined) engine.seek(clip.start + target);
}

export function clearKeyframes(ids: ID[], props: KeyframeProp[]): void {
  updateProject((p) => {
    for (const id of ids) {
      const clip = p.clips[id];
      if (!clip?.keyframes) continue;
      for (const prop of props) {
        const frames = clip.keyframes[prop];
        if (!frames?.length) continue;
        // Keep the value currently shown as the new static value.
        const current = propAt(clip, prop, localTimeOf(clip));
        delete clip.keyframes[prop];
        if (prop === 'volume') {
          if (clip.type === 'video' || clip.type === 'audio') clip.volume = current;
        } else if (clip.type !== 'audio') clip.transform[prop] = current;
      }
    }
  });
}
