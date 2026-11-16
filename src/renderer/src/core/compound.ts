/**
 * Compound clips (nested sequences).
 *
 * A compound clip stores a `Sequence` (tracks, clips, transitions) in its own time base; the clip
 * shows nested time `trimIn + localTime`. Two kinds of views turn a sequence into a `Project`
 * that the rest of the engine understands:
 *
 *  - instance views (rendering / playback): clip and transition ids are prefixed with the
 *    compound's id (`cp/vd`), so two copies of the same compound playing at once never share
 *    decoders, media elements or texture caches;
 *  - edit views (the store's editing context): the sequence with its real ids, so edits can be
 *    written straight back into the compound.
 *
 * Pure: no DOM, no store.
 */

import { DEFAULT_TRANSFORM, uid } from './factory';
import { splitKeyframes, baseProp } from './keyframes';
import { addTrack, cleanupTransitions, ensureBaseTracks, isFree, maxTransitionDuration, pruneEmptyTracks, trackWithRoom } from './project';
import { EPS, clipEnd, snapToFrame } from './time';
import { retimeClip, sequenceEnd } from './timemap';
import type { Clip, CompoundClip, ID, KeyframeProp, Marker, Project, Sequence, Track, Transition } from './types';

/** Nesting deeper than this is not rendered (guards against malformed files). */
export const MAX_NESTING = 8;

/** Separator between a compound id and a nested id in instance views. */
export const INSTANCE_SEP = '/';

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

interface InstanceEntry {
  settings: Project['settings'];
  assets: Project['assets'];
  view: Project;
}

const instanceCache = new WeakMap<CompoundClip, InstanceEntry>();

/**
 * The nested sequence of `clip` as a renderable project with instance-unique ids. Memoised per
 * (immutable) clip object, so indexes and caches keyed on the view stay warm.
 */
export function instanceView(parent: Pick<Project, 'id' | 'name' | 'settings' | 'assets'>, clip: CompoundClip): Project {
  const hit = instanceCache.get(clip);
  if (hit && hit.settings === parent.settings && hit.assets === parent.assets) return hit.view;
  const prefix = clip.id + INSTANCE_SEP;
  const clips: Record<ID, Clip> = {};
  for (const c of Object.values(clip.sequence.clips)) {
    const id = prefix + c.id;
    clips[id] = { ...c, id } as Clip;
  }
  const transitions: Record<ID, Transition> = {};
  for (const tr of Object.values(clip.sequence.transitions)) {
    const id = prefix + tr.id;
    transitions[id] = { ...tr, id, fromId: prefix + tr.fromId, toId: prefix + tr.toId };
  }
  const view: Project = {
    id: parent.id,
    name: parent.name,
    createdAt: 0,
    updatedAt: 0,
    settings: parent.settings,
    assets: parent.assets,
    tracks: clip.sequence.tracks,
    clips,
    transitions,
    markers: [],
  };
  instanceCache.set(clip, { settings: parent.settings, assets: parent.assets, view });
  return view;
}

/** Ids of every clip of a project, including (prefixed) clips inside compound clips. */
export function instanceIds(project: Pick<Project, 'id' | 'name' | 'settings' | 'assets' | 'clips'>, depth = 0, out = new Set<ID>()): Set<ID> {
  for (const c of Object.values(project.clips)) {
    out.add(c.id);
    if (c.type === 'compound' && depth < MAX_NESTING) instanceIds(instanceView(project, c), depth + 1, out);
  }
  return out;
}

/** Every clip of a project or sequence, including the clips nested in compound clips. */
export function deepClips(container: { clips: Record<ID, Clip> }, depth = 0, out: Clip[] = []): Clip[] {
  for (const c of Object.values(container.clips)) {
    out.push(c);
    if (c.type === 'compound' && depth < MAX_NESTING) deepClips(c.sequence, depth + 1, out);
  }
  return out;
}

/** The id of a clip inside an instance view, without its compound prefixes. */
export const baseClipId = (id: ID): ID => id.slice(id.lastIndexOf(INSTANCE_SEP) + 1);

interface Container {
  tracks: Track[];
  clips: Record<ID, Clip>;
  transitions: Record<ID, Transition>;
  markers?: Marker[];
}

/**
 * Editable view of the sequence reached by following `path` (compound ids, outermost first) from
 * the root. Invalid trailing path entries are dropped (e.g. after an undo removed the compound).
 */
export function resolveEditPath(root: Project, path: readonly ID[]): { view: Project; path: ID[] } {
  let container: Container = root;
  const valid: ID[] = [];
  for (const id of path) {
    const c = container.clips[id];
    if (!c || c.type !== 'compound') break;
    valid.push(id);
    container = c.sequence;
  }
  if (valid.length === 0) return { view: root, path: [] };
  const view: Project = { ...root, tracks: container.tracks, clips: container.clips, transitions: container.transitions, markers: container.markers ?? [] };
  // In / out points belong to the document's own timeline.
  delete view.inPoint;
  delete view.outPoint;
  return { view, path: valid };
}

/** Compound clips along an edit path, outermost first. */
export function compoundsOnPath(root: Project, path: readonly ID[]): CompoundClip[] {
  const out: CompoundClip[] = [];
  let container: Container = root;
  for (const id of path) {
    const c = container.clips[id];
    if (!c || c.type !== 'compound') break;
    out.push(c);
    container = c.sequence;
  }
  return out;
}

/**
 * New root project with `view` (an edited nested sequence) written back at `path`. Compound
 * clips that showed their whole sequence follow its new length (without running into the next
 * clip on their track); shared document fields (name, settings, assets) are taken from the view.
 */
export function commitView(root: Project, path: readonly ID[], view: Project): Project {
  const chain: { container: Container; clip: CompoundClip }[] = [];
  let container: Container = root;
  for (const id of path) {
    const c = container.clips[id];
    if (!c || c.type !== 'compound') break;
    chain.push({ container, clip: c });
    container = c.sequence;
  }
  if (chain.length === 0) return view;
  const fps = view.settings.fps;
  let seq: Sequence = { tracks: view.tracks, clips: view.clips, transitions: view.transitions, markers: view.markers };
  for (let i = chain.length - 1; i >= 0; i--) {
    const { container: parent, clip } = chain[i];
    const updated: CompoundClip = { ...clip, sequence: seq };
    updated.duration = followDuration(clip, updated, parent, fps);
    const clips = { ...parent.clips, [clip.id]: updated };
    const transitions = fixTransitions(parent.transitions, clips, updated);
    if (i === 0) {
      return { ...root, name: view.name, settings: view.settings, assets: view.assets, clips, transitions };
    }
    seq = { tracks: parent.tracks, clips, transitions, markers: parent.markers };
  }
  return root;
}

/** Duration of a compound clip after its sequence changed. */
function followDuration(before: CompoundClip, after: CompoundClip, parent: Container, fps: number): number {
  const oldEnd = sequenceEnd(before);
  const newEnd = sequenceEnd(after);
  if (Math.abs(oldEnd - newEnd) < EPS) return before.duration;
  const showedAll = before.trimIn + before.duration >= oldEnd - 1e-4;
  let d = showedAll ? newEnd - before.trimIn : Math.min(before.duration, newEnd - before.trimIn);
  let room = Infinity;
  for (const c of Object.values(parent.clips)) {
    if (c.trackId === before.trackId && c.id !== before.id && c.start >= before.start + EPS) room = Math.min(room, c.start - before.start);
  }
  d = Math.min(d, room);
  return Math.max(1 / fps, snapToFrame(d, fps));
}

/** Drop / clamp transitions touching a compound whose length changed. */
function fixTransitions(transitions: Record<ID, Transition>, clips: Record<ID, Clip>, changed: CompoundClip): Record<ID, Transition> {
  let out: Record<ID, Transition> | null = null;
  for (const tr of Object.values(transitions)) {
    if (tr.fromId !== changed.id && tr.toId !== changed.id) continue;
    const from = clips[tr.fromId];
    const to = clips[tr.toId];
    out ??= { ...transitions };
    if (!from || !to || Math.abs(clipEnd(from) - to.start) > 1e-3) {
      delete out[tr.id];
      continue;
    }
    const max = maxTransitionDuration(from, to);
    if (tr.duration > max) out[tr.id] = { ...tr, duration: max };
  }
  return out ?? transitions;
}

// ---------------------------------------------------------------------------------------------
// Create / break apart
// ---------------------------------------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function compoundSummary(clip: CompoundClip): { clips: number; tracks: number; visual: number; audio: number } {
  const clips = Object.values(clip.sequence.clips);
  const used = new Set(clips.map((c) => c.trackId));
  return {
    clips: clips.length,
    tracks: clip.sequence.tracks.filter((t) => used.has(t.id)).length,
    visual: clips.filter((c) => c.type !== 'audio').length,
    audio: clips.filter((c) => c.type === 'audio').length,
  };
}

/**
 * Mutates. Replaces the given clips with one compound clip holding them, keeping their relative
 * timing and track layering. Clips on locked tracks are left alone. Returns the compound id.
 */
export function createCompound(p: Project, ids: readonly ID[]): ID | null {
  const fps = p.settings.fps;
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
  const picked = ids.map((id) => p.clips[id]).filter((c): c is Clip => !!c && !locked.has(c.trackId));
  if (picked.length === 0) return null;
  const pickedIds = new Set(picked.map((c) => c.id));
  const t0 = snapToFrame(Math.min(...picked.map((c) => c.start)), fps);
  const t1 = Math.max(...picked.map(clipEnd));

  // Tracks that hold the picked clips, in timeline order (visual first, top → bottom).
  const usedTracks = new Set(picked.map((c) => c.trackId));
  const tracks: Track[] = p.tracks.filter((t) => usedTracks.has(t.id)).map((t) => ({ ...clone(t), locked: false }));
  const holder = { tracks } as Project;
  ensureBaseTracks(holder);

  const clips: Record<ID, Clip> = {};
  for (const c of picked) {
    const copy = clone(c);
    copy.start = Math.max(0, c.start - t0);
    clips[copy.id] = copy;
  }
  const transitions: Record<ID, Transition> = {};
  for (const tr of Object.values(p.transitions)) {
    if (pickedIds.has(tr.fromId) && pickedIds.has(tr.toId)) transitions[tr.id] = clone(tr);
  }
  // Links that would now cross the compound boundary are dissolved on both sides.
  for (const c of picked) {
    if (!c.linkId) continue;
    const partners = Object.values(p.clips).filter((o) => o.linkId === c.linkId);
    if (partners.every((o) => pickedIds.has(o.id))) continue;
    delete clips[c.id].linkId;
    for (const o of partners) if (!pickedIds.has(o.id)) delete p.clips[o.id].linkId;
  }

  // The compound goes on the top-most visual track of the selection when there is room there.
  const visualTracks = p.tracks.filter((t) => t.kind === 'visual' && usedTracks.has(t.id));
  for (const c of picked) delete p.clips[c.id];
  const duration = Math.max(1 / fps, snapToFrame(t1 - t0, fps));
  let track = visualTracks.find((t) => isFree(p, t.id, t0, duration));
  track ??= trackWithRoom(p, 'visual', t0, duration);

  const count = Object.values(p.clips).filter((c) => c.type === 'compound').length + 1;
  const compound: CompoundClip = {
    id: uid('cp_'),
    trackId: track.id,
    type: 'compound',
    name: `Compound clip ${count}`,
    start: t0,
    duration,
    transform: { ...DEFAULT_TRANSFORM },
    blendMode: 'normal',
    effects: [],
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    trimIn: 0,
    sequence: { tracks: holder.tracks, clips, transitions },
  };
  p.clips[compound.id] = compound;
  cleanupTransitions(p);
  pruneEmptyTracks(p);
  return compound.id;
}

const KF_PROPS: KeyframeProp[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume'];

/** Mutates a clip copy: keyframes re-based after `cut` seconds were removed from its start. */
function rebaseKeyframes(clip: Clip, cut: number): void {
  if (!clip.keyframes || cut <= EPS) return;
  const next: NonNullable<Clip['keyframes']> = {};
  for (const prop of KF_PROPS) {
    const frames = clip.keyframes[prop];
    if (!frames?.length) continue;
    const { right } = splitKeyframes(frames, cut, baseProp(clip, prop));
    if (right.length) next[prop] = right;
  }
  clip.keyframes = next;
}

/** True when the compound's own look (transform, grade, effects…) differs from neutral. */
export function compoundHasOwnLook(c: CompoundClip): boolean {
  const t = c.transform;
  return (
    Math.abs(t.x) > EPS ||
    Math.abs(t.y) > EPS ||
    Math.abs(t.scaleX - 1) > EPS ||
    Math.abs(t.scaleY - 1) > EPS ||
    Math.abs(t.rotation) > EPS ||
    Math.abs(t.opacity - 1) > EPS ||
    c.blendMode !== 'normal' ||
    c.effects.length > 0 ||
    !!c.filter ||
    !!c.mask ||
    !!c.anim ||
    !!c.flipH ||
    !!c.flipV ||
    !!c.chromaKey?.enabled ||
    (!!c.adjust && Object.keys(c.adjust).length > 0) ||
    (!!c.crop && c.crop.l + c.crop.t + c.crop.r + c.crop.b > 0) ||
    !!c.cornerRadius ||
    !!c.keyframes && KF_PROPS.some((k) => k !== 'volume' && !!c.keyframes?.[k]?.length)
  );
}

/**
 * Mutates. Replaces a compound clip with its clips at their timeline positions (only the part
 * the compound shows), keeping their layering. Returns the ids of the restored clips.
 */
export function breakApart(p: Project, compoundId: ID): ID[] {
  const cp = p.clips[compoundId];
  if (!cp || cp.type !== 'compound') return [];
  const fps = p.settings.fps;
  const min = 0.5 / fps;
  const ws = cp.trimIn;
  const we = cp.trimIn + cp.duration;
  const offset = cp.start - cp.trimIn;
  const seq = cp.sequence;
  const parentTrack = p.tracks.find((t) => t.id === cp.trackId);
  delete p.clips[compoundId];
  cleanupTransitions(p);

  // Clips of each nested track, cut to the visible window.
  const prepared = new Map<ID, Clip[]>();
  for (const c of Object.values(seq.clips)) {
    const cs = Math.max(c.start, ws);
    const ce = Math.min(clipEnd(c), we);
    if (ce - cs < min) continue;
    const copy = clone(c);
    const cut = cs - c.start;
    retimeClip(copy, c, cut, snapToFrame(ce - cs, fps) || ce - cs);
    rebaseKeyframes(copy, cut);
    if (copy.type !== 'audio') {
      if (cut > EPS && copy.anim?.in) delete copy.anim.in;
      if (ce < clipEnd(c) - EPS && copy.anim?.out) delete copy.anim.out;
    }
    if ((copy.type === 'video' || copy.type === 'audio') && (c.type === 'video' || c.type === 'audio')) {
      if (cut > EPS) copy.fadeIn = 0;
      if (ce < clipEnd(c) - EPS) copy.fadeOut = 0;
      // Fold the compound's (static) level into its clips.
      if (cp.muted) copy.muted = true;
      else if (Math.abs(cp.volume - 1) > EPS && !copy.keyframes?.volume?.length) copy.volume = Math.min(2, Math.max(0, copy.volume * cp.volume));
    }
    copy.start = snapToFrame(offset + cs, fps);
    if (!prepared.has(c.trackId)) prepared.set(c.trackId, []);
    prepared.get(c.trackId)!.push(copy);
  }

  const fits = (track: Track, clips: Clip[]): boolean => !track.locked && clips.every((c) => isFree(p, track.id, c.start, c.duration));
  const placed: Clip[] = [];
  const place = (track: Track, clips: Clip[]): void => {
    for (const c of clips) {
      if (p.clips[c.id]) {
        // A copy of this compound was broken apart before: give the clip a fresh id.
        const fresh = uid(c.id.slice(0, 3));
        for (const tr of Object.values(seq.transitions)) {
          if (tr.fromId === c.id) tr.fromId = fresh;
          if (tr.toId === c.id) tr.toId = fresh;
        }
        c.id = fresh;
      }
      c.trackId = track.id;
      p.clips[c.id] = c;
      placed.push(c);
    }
  };

  // Visual tracks bottom → top, stacked upwards from the compound's own track.
  const nestedVisual = seq.tracks.filter((t) => t.kind === 'visual' && prepared.has(t.id)).reverse();
  let below: Track | undefined = parentTrack && parentTrack.kind === 'visual' ? parentTrack : undefined;
  for (const nt of nestedVisual) {
    const clips = prepared.get(nt.id)!;
    let target: Track | undefined;
    if (below) {
      if (below === parentTrack && fits(below, clips) && !placed.some((c) => c.trackId === below!.id)) target = below;
      else {
        const idx = p.tracks.indexOf(below);
        const above = idx > 0 ? p.tracks[idx - 1] : undefined;
        if (above && above.kind === 'visual' && fits(above, clips)) target = above;
        else target = addTrack(p, 'visual', { trackId: below.id, where: 'above' });
      }
    } else {
      target = addTrack(p, 'visual');
    }
    if (nt.hidden && !target.hidden && placed.every((c) => c.trackId !== target!.id)) {
      // Respect hidden nested tracks by keeping their clips on a hidden track of their own.
      target = addTrack(p, 'visual', { trackId: target.id, where: 'above' });
      target.hidden = true;
    }
    place(target, clips);
    below = target;
  }
  // Audio tracks top → bottom, onto the first audio track with room.
  for (const nt of seq.tracks.filter((t) => t.kind === 'audio' && prepared.has(t.id))) {
    const clips = prepared.get(nt.id)!;
    const target = p.tracks.find((t) => t.kind === 'audio' && fits(t, clips)) ?? addTrack(p, 'audio');
    if (nt.muted && !target.muted) for (const c of clips) if (c.type === 'audio') c.muted = true;
    place(target, clips);
  }

  // Transitions between clips that came back together.
  const placedIds = new Set(placed.map((c) => c.id));
  for (const tr of Object.values(seq.transitions)) {
    if (!placedIds.has(tr.fromId) || !placedIds.has(tr.toId)) continue;
    const id = p.transitions[tr.id] ? uid('tn_') : tr.id;
    p.transitions[id] = { ...clone(tr), id };
  }
  cleanupTransitions(p);
  pruneEmptyTracks(p);
  return placed.map((c) => c.id);
}
