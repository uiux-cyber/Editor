/**
 * Editor actions for time remapping (speed, speed ramps, reverse, freeze frames, preserve pitch)
 * and compound clips (create, open, close, break apart). Every change is one undo step through
 * the project store; the commands in ui/commands/defs/time.ts call these.
 */

import { uid } from '@/core/factory';
import { breakApart, compoundHasOwnLook, compoundsOnPath, createCompound } from '@/core/compound';
import { propAt } from '@/core/keyframes';
import { cleanupTransitions, clipsOnTrack, splitClipAt } from '@/core/project';
import { clipEnd, snapToFrame } from '@/core/time';
import { applySpeed, sourceTimeAt, type CurvePoint } from '@/core/timemap';
import type { Clip, ID, KeyframeProp, Project, VideoClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { getProject, getRootProject, updateProject, useProjectStore, type UpdateOptions } from '@/store/project';
import { toast, useUI } from '@/store/ui';

export const FREEZE_DURATION = 2;

const playhead = (): number => snapToFrame(engine.time, getProject().settings.fps);
const lockedTracks = (p: Project): Set<ID> => new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
const selected = (): Clip[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter(Boolean);
};

// ---------------------------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------------------------

/** Room on the track after a clip (up to the next clip). */
function roomAfter(p: Project, clip: Clip): number {
  const next = clipsOnTrack(p, clip.trackId).find((c) => c.start >= clip.start + 1e-6 && c.id !== clip.id);
  return next ? next.start - clip.start : Infinity;
}

/**
 * Apply a constant speed (number) or a speed curve (normalised points) to timed-media clips,
 * keeping their source content (the duration follows), limited by the media and the next clip.
 */
export function setClipSpeed(ids: ID[], speed: number | CurvePoint[], opts: UpdateOptions = { coalesce: 'speed' }): void {
  updateProject((p) => {
    const fps = p.settings.fps;
    for (const id of ids) {
      const clip = p.clips[id];
      if (!clip || (clip.type !== 'video' && clip.type !== 'audio') || clip.freeze) continue;
      const asset = p.assets[clip.assetId];
      applySpeed(clip, speed, { assetDuration: asset?.duration, room: roomAfter(p, clip), fps });
    }
    cleanupTransitions(p);
  }, opts);
}

export function setReverse(ids: ID[], on: boolean): void {
  updateProject((p) => {
    for (const id of ids) {
      const clip = p.clips[id];
      if (!clip || (clip.type !== 'video' && clip.type !== 'audio') || clip.freeze) continue;
      if (on) clip.reverse = true;
      else delete clip.reverse;
    }
  });
}

export function setPreservePitch(ids: ID[], on: boolean): void {
  updateProject((p) => {
    for (const id of ids) {
      const clip = p.clips[id];
      if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
      if (on) clip.preservePitch = true;
      else delete clip.preservePitch;
    }
  });
}

/** Toggle reverse on the selected media clips (all follow the first one). */
export function toggleReverseSelection(): void {
  const media = selected().filter((c): c is Extract<Clip, { type: 'video' | 'audio' }> => (c.type === 'video' || c.type === 'audio') && !c.freeze);
  if (!media.length) {
    toast('info', 'Select a video or audio clip to reverse it');
    return;
  }
  setReverse(
    media.map((c) => c.id),
    !media[0].reverse,
  );
}

// ---------------------------------------------------------------------------------------------
// Freeze frame
// ---------------------------------------------------------------------------------------------

const KF_PROPS: KeyframeProp[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume'];

/** The video clip the freeze frame applies to: the selected one under the playhead, else the top one. */
function freezeTarget(p: Project, time: number): VideoClip | null {
  const locked = lockedTracks(p);
  const under = (c: Clip): c is VideoClip => c.type === 'video' && !locked.has(c.trackId) && time >= c.start - 1e-6 && time < clipEnd(c) - 1e-6;
  const sel = selected().filter(under);
  if (sel.length) return sel[0];
  const order = new Map(p.tracks.map((t, i) => [t.id, i]));
  const all = Object.values(p.clips)
    .filter(under)
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  return all[0] ?? null;
}

/**
 * Freeze the frame under the playhead: splits the video clip there and inserts a held-frame
 * segment (`freeze`, silent) of `duration` seconds, pushing later clips on that track.
 */
export function freezeFrame(duration = FREEZE_DURATION): ID | null {
  const project = getProject();
  const time = playhead();
  const target = freezeTarget(project, time);
  if (!target) {
    toast('info', 'Nothing to freeze here', 'Move the playhead over a video clip first.');
    return null;
  }
  if (target.freeze) {
    toast('info', 'This clip is already a freeze frame');
    return null;
  }
  let freezeId: ID | null = null;
  updateProject((p) => {
    const fps = p.settings.fps;
    const frame = 1 / fps;
    const hold = Math.max(frame, snapToFrame(duration, fps));
    const clip = p.clips[target.id] as VideoClip;
    const local = Math.min(Math.max(0, time - clip.start), clip.duration - frame);
    // The exact source frame the preview shows at the playhead.
    const source = sourceTimeAt(clip, local);
    const values = new Map(KF_PROPS.map((k) => [k, propAt(clip, k, local)]));
    const template = JSON.parse(JSON.stringify(clip)) as VideoClip;
    let insertAt: number;
    if (local < frame - 1e-6) insertAt = clip.start;
    else if (time >= clipEnd(clip) - frame + 1e-6) insertAt = clipEnd(clip);
    else {
      splitClipAt(p, clip.id, time, fps);
      insertAt = time;
    }
    // Ripple: everything at or after the insertion point on this track moves right.
    for (const c of clipsOnTrack(p, clip.trackId)) if (c.start >= insertAt - 1e-6) p.clips[c.id].start = snapToFrame(c.start + hold, fps);

    const fr: VideoClip = { ...template, id: uid('vd_'), start: insertAt, duration: hold, trimIn: source, freeze: true, fadeIn: 0, fadeOut: 0, name: `${template.name.replace(/ · freeze$/, '')} · freeze` };
    delete fr.speedRamp;
    delete fr.reverse;
    delete fr.preservePitch;
    delete fr.linkId;
    delete fr.anim;
    // Keyframed properties hold the value they had at the frozen moment.
    if (fr.keyframes) {
      for (const k of KF_PROPS) {
        if (!fr.keyframes[k]?.length) continue;
        const v = values.get(k)!;
        if (k === 'volume') fr.volume = v;
        else fr.transform[k] = v;
      }
      delete fr.keyframes;
    }
    for (const fx of fr.effects) fx.uid = uid('fx_');
    p.clips[fr.id] = fr;
    freezeId = fr.id;
    // A transition that entered the clip now enters the freeze frame when it was inserted before it.
    if (insertAt === clip.start) {
      for (const tr of Object.values(p.transitions)) if (tr.toId === clip.id) tr.toId = fr.id;
    }
    cleanupTransitions(p);
  });
  if (freezeId) {
    useUI.getState().select([freezeId]);
    toast('success', 'Freeze frame added', `The frame holds for ${duration} s; later clips on the track moved right.`);
  }
  return freezeId;
}

// ---------------------------------------------------------------------------------------------
// Compound clips
// ---------------------------------------------------------------------------------------------

export const inCompound = (): boolean => useProjectStore.getState().editPath.length > 0;

export function createCompoundFromSelection(): ID | null {
  const ids = useUI.getState().selection;
  if (ids.length === 0) {
    toast('info', 'Select the clips to combine', 'Shift-click or drag a box around clips, then create the compound clip.');
    return null;
  }
  let id: ID | null = null;
  updateProject((p) => {
    id = createCompound(p, ids);
  });
  if (!id) {
    toast('info', 'These clips cannot be combined', 'Clips on locked tracks stay where they are.');
    return null;
  }
  useUI.getState().select([id]);
  return id;
}

/** The compound clip to act on: the selected one, else the one under the playhead. */
function compoundTarget(): Clip | null {
  const sel = selected().find((c) => c.type === 'compound');
  if (sel) return sel;
  const p = getProject();
  const t = engine.time;
  return Object.values(p.clips).find((c) => c.type === 'compound' && t >= c.start && t < clipEnd(c)) ?? null;
}

export const hasCompoundTarget = (): boolean => !!compoundTarget();

/** Open a compound clip for editing (its nested sequence replaces the timeline). */
export function openCompound(id?: ID): void {
  const clip = id ? getProject().clips[id] : compoundTarget();
  if (!clip || clip.type !== 'compound') return;
  const store = useProjectStore.getState();
  if (store.txnBase) return;
  engine.pause();
  const fps = store.project.settings.fps;
  const nested = clip.trimIn + Math.min(Math.max(engine.time - clip.start, 0), Math.max(0, clip.duration - 1 / fps));
  store.setEditPath([...store.editPath, clip.id]);
  useUI.getState().set({ selection: [], selectedTransition: null });
  engine.seek(nested);
}

/** Close open compound clips down to `depth` (0 = back to the project timeline). */
export function closeCompound(depth = useProjectStore.getState().editPath.length - 1): void {
  const store = useProjectStore.getState();
  const path = store.editPath;
  if (depth < 0 || depth >= path.length || store.txnBase) return;
  engine.pause();
  const chain = compoundsOnPath(getRootProject(), path);
  // Map the playhead back out through every closed level.
  let t = engine.time;
  for (let i = chain.length - 1; i >= depth; i--) {
    const c = chain[i];
    t = c.start + Math.min(Math.max(t - c.trimIn, 0), c.duration);
  }
  const reselect = chain[depth]?.id;
  store.setEditPath(path.slice(0, depth));
  useUI.getState().set({ selection: reselect ? [reselect] : [], selectedTransition: null });
  engine.seek(t);
}

export function breakApartSelection(): void {
  const targets = selected().filter((c) => c.type === 'compound');
  const list = targets.length ? targets : [compoundTarget()].filter((c): c is Clip => !!c && c.type === 'compound');
  if (!list.length) {
    toast('info', 'Select a compound clip to break it apart');
    return;
  }
  const lost = list.some((c) => c.type === 'compound' && compoundHasOwnLook(c));
  let ids: ID[] = [];
  updateProject((p) => {
    for (const c of list) ids = ids.concat(breakApart(p, c.id));
  });
  useUI.getState().select(ids);
  if (lost) toast('warning', 'Compound clip broken apart', "Its own transform, effects and grade applied to the whole compound and were not copied to its clips.");
}
