/**
 * Pure timeline operations. Query helpers accept any project; functions documented as
 * "mutates" are meant to be called on an immer draft inside a store transaction.
 */

import { makeTrack, uid } from './factory';
import { splitKeyframes, baseProp } from './keyframes';
import { EPS, clipEnd, snapToFrame } from './time';
import { maxDurationFor, retimeClip, sanitizeRamp } from './timemap';
import { dirnamePath, isAbsolutePath, relativeInside, resolveFrom } from './paths';
import {
  DESIGN_SHORT_SIDE,
  PROJECT_FILE_VERSION,
  type AudioClip,
  type Clip,
  type ID,
  type KeyframeProp,
  type MediaAsset,
  type Project,
  type ProjectFile,
  type ProjectSettings,
  type ShapeClip,
  type Sequence,
  type Track,
  type TrackKind,
  type Transition,
  type VisualClip,
} from './types';

// ---------------------------------------------------------------------------------------------
// Creation & geometry
// ---------------------------------------------------------------------------------------------

export interface NewProjectOptions {
  name?: string;
  width: number;
  height: number;
  fps: number;
  background?: string;
}

export function createProject(opts: NewProjectOptions): Project {
  const now = Date.now();
  return {
    id: uid('pr_'),
    name: opts.name?.trim() || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    settings: { width: opts.width, height: opts.height, fps: opts.fps, background: opts.background ?? '#000000' },
    assets: {},
    tracks: [makeTrack('visual', 'V1'), makeTrack('audio', 'A1')],
    clips: {},
    transitions: {},
    markers: [],
    // New projects get the magnetic main track (older files stay as they were saved).
    magneticMain: true,
  };
}

export interface DesignSize {
  /** Composition size in design px. */
  cw: number;
  ch: number;
  /** Real pixels per design pixel at full output resolution. */
  ds: number;
}

export function designSize(settings: Pick<ProjectSettings, 'width' | 'height'>): DesignSize {
  const ds = Math.min(settings.width, settings.height) / DESIGN_SHORT_SIDE;
  return { cw: settings.width / ds, ch: settings.height / ds, ds };
}

/** Natural (scale = 1) size of a media layer: fitted inside the composition. */
export function fitContain(srcW: number, srcH: number, cw: number, ch: number): { w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { w: cw, h: ch };
  const k = Math.min(cw / srcW, ch / srcH);
  return { w: srcW * k, h: srcH * k };
}

// ---------------------------------------------------------------------------------------------
// Indexed queries (memoised per immutable project instance)
// ---------------------------------------------------------------------------------------------

export interface ProjectIndex {
  byTrack: Map<ID, Clip[]>;
  /** Transition leaving a clip (clip is `fromId`). */
  transOut: Map<ID, Transition>;
  /** Transition entering a clip (clip is `toId`). */
  transIn: Map<ID, Transition>;
  duration: number;
}

const indexCache = new WeakMap<Project, ProjectIndex>();

function buildIndex(project: Project): ProjectIndex {
  const byTrack = new Map<ID, Clip[]>();
  for (const track of project.tracks) byTrack.set(track.id, []);
  let duration = 0;
  for (const clip of Object.values(project.clips)) {
    let list = byTrack.get(clip.trackId);
    if (!list) byTrack.set(clip.trackId, (list = []));
    list.push(clip);
    const end = clip.start + clip.duration;
    if (end > duration) duration = end;
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);
  const transOut = new Map<ID, Transition>();
  const transIn = new Map<ID, Transition>();
  for (const tr of Object.values(project.transitions)) {
    transOut.set(tr.fromId, tr);
    transIn.set(tr.toId, tr);
  }
  return { byTrack, transOut, transIn, duration };
}

/** Only call with committed (non-draft) project objects. */
export function getIndex(project: Project): ProjectIndex {
  let idx = indexCache.get(project);
  if (!idx) {
    idx = buildIndex(project);
    indexCache.set(project, idx);
  }
  return idx;
}

export const projectDuration = (project: Project): number => getIndex(project).duration;

// ---------------------------------------------------------------------------------------------
// Draft-safe queries
// ---------------------------------------------------------------------------------------------

export const clipKind = (clip: Pick<Clip, 'type'>): TrackKind => (clip.type === 'audio' ? 'audio' : 'visual');

export function getTrack(p: Project, trackId: ID): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

/** The "Main" track: the bottom-most visual track that is not a caption track. */
export function mainTrackId(p: Project): ID | null {
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const t = p.tracks[i];
    if (t.kind === 'visual' && t.role !== 'captions') return t.id;
  }
  return null;
}

/** True when `trackId` is the main track and the project keeps it magnetic (gap-free). */
export function isMagneticTrack(p: Project, trackId: ID): boolean {
  return !!p.magneticMain && mainTrackId(p) === trackId;
}

export function clipsOnTrack(p: Project, trackId: ID, ignore?: ReadonlySet<ID>): Clip[] {
  const out: Clip[] = [];
  for (const clip of Object.values(p.clips)) {
    if (clip.trackId === trackId && !(ignore && ignore.has(clip.id))) out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function contentEnd(p: Project): number {
  let end = 0;
  for (const clip of Object.values(p.clips)) end = Math.max(end, clip.start + clip.duration);
  return end;
}

export function isFree(p: Project, trackId: ID, start: number, duration: number, ignore?: ReadonlySet<ID>): boolean {
  if (start < -EPS) return false;
  const end = start + duration;
  for (const clip of Object.values(p.clips)) {
    if (clip.trackId !== trackId || (ignore && ignore.has(clip.id))) continue;
    if (start < clipEnd(clip) - EPS && end > clip.start + EPS) return false;
  }
  return true;
}

/** The closest start time ≥ 0 to `desired` at which a clip of `duration` fits on the track. */
export function nearestFreeStart(p: Project, trackId: ID, desired: number, duration: number, ignore?: ReadonlySet<ID>): number {
  const want = Math.max(0, desired);
  const clips = clipsOnTrack(p, trackId, ignore);
  let best = Infinity;
  let bestDist = Infinity;
  let cursor = 0;
  const consider = (gapStart: number, gapEnd: number): void => {
    if (gapEnd - gapStart < duration - EPS) return;
    const candidate = Math.min(Math.max(want, gapStart), gapEnd - duration);
    const dist = Math.abs(candidate - want);
    if (dist < bestDist - EPS) {
      best = candidate;
      bestDist = dist;
    }
  };
  for (const clip of clips) {
    consider(cursor, clip.start);
    cursor = Math.max(cursor, clipEnd(clip));
  }
  consider(cursor, Infinity);
  return Number.isFinite(best) ? Math.max(0, best) : cursor;
}

/** Neighbouring clips on the same track. */
export function neighbours(p: Project, clip: Clip): { prev: Clip | null; next: Clip | null } {
  let prev: Clip | null = null;
  let next: Clip | null = null;
  for (const other of Object.values(p.clips)) {
    if (other.trackId !== clip.trackId || other.id === clip.id) continue;
    if (clipEnd(other) <= clip.start + EPS && (!prev || other.start > prev.start)) prev = other;
    if (other.start >= clipEnd(clip) - EPS && (!next || other.start < next.start)) next = other;
  }
  return { prev, next };
}

export function areAdjacent(a: Clip, b: Clip): boolean {
  return a.trackId === b.trackId && Math.abs(clipEnd(a) - b.start) < 1e-3;
}

/**
 * Source media time shown at a clip-local time. Time remapping (speed ramps, reverse, freeze)
 * lives in core/timemap.ts; re-exported here for existing callers.
 */
export { sourceTimeAt } from './timemap';

/**
 * Longest timeline duration a clip can have from its current in-point (media clips: the source
 * available, honouring ramps / reverse / freeze; compound clips: the nested sequence).
 */
export function maxDurationFromSource(clip: Clip, assets: Record<ID, MediaAsset>): number {
  return maxDurationFor(clip, assets);
}

// ---------------------------------------------------------------------------------------------
// Track mutations
// ---------------------------------------------------------------------------------------------

function nextTrackName(p: Project, kind: TrackKind): string {
  const prefix = kind === 'visual' ? 'V' : 'A';
  let n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const names = new Set(p.tracks.map((t) => t.name));
  while (names.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Mutates. Adds a track and returns it. Visual tracks are inserted above `aboveTrackId` (or at
 * the very top); audio tracks are appended at the bottom (or below `aboveTrackId`).
 */
export function addTrack(p: Project, kind: TrackKind, relativeTo?: { trackId: ID; where: 'above' | 'below' }): Track {
  const track = makeTrack(kind, nextTrackName(p, kind));
  const firstAudio = p.tracks.findIndex((t) => t.kind === 'audio');
  const visualEnd = firstAudio < 0 ? p.tracks.length : firstAudio;
  let index = kind === 'visual' ? 0 : p.tracks.length;
  if (relativeTo) {
    const ref = p.tracks.findIndex((t) => t.id === relativeTo.trackId);
    if (ref >= 0) index = relativeTo.where === 'above' ? ref : ref + 1;
  }
  // Keep the invariant: all visual tracks first, then all audio tracks.
  index = kind === 'visual' ? Math.min(Math.max(index, 0), visualEnd) : Math.min(Math.max(index, visualEnd), p.tracks.length);
  p.tracks.splice(index, 0, track);
  return track;
}

/** Mutates. Removes a track with all its clips. */
export function removeTrack(p: Project, trackId: ID): void {
  const ids = Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .map((c) => c.id);
  removeClips(p, ids, false);
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  ensureBaseTracks(p);
}

/** Mutates. Guarantees at least one visual and one audio track. */
export function ensureBaseTracks(p: Project): void {
  if (!p.tracks.some((t) => t.kind === 'visual')) p.tracks.unshift(makeTrack('visual', 'V1'));
  if (!p.tracks.some((t) => t.kind === 'audio')) p.tracks.push(makeTrack('audio', 'A1'));
}

/** Mutates. Drops empty tracks, always keeping one of each kind. */
export function pruneEmptyTracks(p: Project): void {
  const used = new Set(Object.values(p.clips).map((c) => c.trackId));
  // A magnetic main track stays even when empty, so the track above never becomes "Main".
  const main = p.magneticMain ? mainTrackId(p) : null;
  for (const kind of ['visual', 'audio'] as const) {
    const ofKind = p.tracks.filter((t) => t.kind === kind);
    const empty = ofKind.filter((t) => !used.has(t.id) && t.id !== main);
    let removable = empty.length;
    if (empty.length === ofKind.length) removable -= 1; // keep one
    if (removable <= 0) continue;
    // Prefer removing the outermost empty tracks (top for visual, bottom for audio).
    const victims = new Set((kind === 'visual' ? empty : empty.slice().reverse()).slice(0, removable).map((t) => t.id));
    p.tracks = p.tracks.filter((t) => !victims.has(t.id));
  }
}

/** Mutates. Finds (or creates) a track of `kind` where `[start, start+duration)` is free. */
export function trackWithRoom(p: Project, kind: TrackKind, start: number, duration: number, preferTrackId?: ID, ignore?: ReadonlySet<ID>): Track {
  const ok = (t: Track): boolean => t.kind === kind && !t.locked && isFree(p, t.id, start, duration, ignore);
  const preferred = preferTrackId ? getTrack(p, preferTrackId) : undefined;
  if (preferred && ok(preferred)) return preferred;
  // Visual: search from the bottom-most visual track upwards so the base layer fills first.
  const candidates = kind === 'visual' ? p.tracks.filter((t) => t.kind === 'visual').reverse() : p.tracks.filter((t) => t.kind === 'audio');
  const start0 = preferred ? candidates.indexOf(preferred) : -1;
  const ordered = start0 >= 0 ? [...candidates.slice(start0), ...candidates.slice(0, start0)] : candidates;
  for (const t of ordered) if (ok(t)) return t;
  return addTrack(p, kind);
}

// ---------------------------------------------------------------------------------------------
// Clip mutations
// ---------------------------------------------------------------------------------------------

/** Mutates. Removes transitions that no longer join two adjacent clips and clamps durations. */
export function cleanupTransitions(p: Project): void {
  for (const tr of Object.values(p.transitions)) {
    const from = p.clips[tr.fromId];
    const to = p.clips[tr.toId];
    if (!from || !to || from.type === 'audio' || to.type === 'audio' || !areAdjacent(from, to)) {
      delete p.transitions[tr.id];
      continue;
    }
    const max = maxTransitionDuration(from, to);
    if (tr.duration > max) tr.duration = max;
    if (tr.duration < 0.05) delete p.transitions[tr.id];
  }
}

export function maxTransitionDuration(from: Clip, to: Clip): number {
  return Math.max(0, Math.min(from.duration, to.duration, 5));
}

/** Mutates. */
export function removeClips(p: Project, ids: Iterable<ID>, prune = true): void {
  for (const id of ids) delete p.clips[id];
  cleanupTransitions(p);
  cleanupRelations(p);
  if (prune) pruneEmptyTracks(p);
}

/** Mutates. Drops group and link ids that no longer join at least two clips. */
export function cleanupRelations(p: Project): void {
  const groups = new Map<ID, number>();
  const links = new Map<ID, number>();
  for (const clip of Object.values(p.clips)) {
    if (clip.groupId) groups.set(clip.groupId, (groups.get(clip.groupId) ?? 0) + 1);
    if (clip.linkId) links.set(clip.linkId, (links.get(clip.linkId) ?? 0) + 1);
  }
  for (const clip of Object.values(p.clips)) {
    if (clip.groupId && groups.get(clip.groupId)! < 2) delete p.clips[clip.id].groupId;
    if (clip.linkId && links.get(clip.linkId)! < 2) delete p.clips[clip.id].linkId;
  }
}

/**
 * Mutates. Removes clips and closes the gaps they leave by shifting later clips on the same
 * track to the left.
 */
export function rippleDelete(p: Project, ids: Iterable<ID>): void {
  const removed = new Map<ID, { start: number; end: number }[]>();
  for (const id of ids) {
    const clip = p.clips[id];
    if (!clip) continue;
    if (!removed.has(clip.trackId)) removed.set(clip.trackId, []);
    removed.get(clip.trackId)!.push({ start: clip.start, end: clipEnd(clip) });
    delete p.clips[id];
  }
  for (const [trackId, ranges] of removed) {
    ranges.sort((a, b) => a.start - b.start);
    for (const clip of clipsOnTrack(p, trackId)) {
      let shift = 0;
      for (const r of ranges) if (r.end <= clip.start + EPS) shift += r.end - r.start;
      if (shift > 0) p.clips[clip.id].start = Math.max(0, clip.start - shift);
    }
  }
  cleanupTransitions(p);
  cleanupRelations(p);
  pruneEmptyTracks(p);
}

/** Mutates. Shifts clips left so the track has no gaps (keeping order). */
export function closeGaps(p: Project, trackId: ID): void {
  let cursor = 0;
  for (const clip of clipsOnTrack(p, trackId)) {
    p.clips[clip.id].start = cursor;
    cursor += clip.duration;
  }
  cleanupTransitions(p);
}

const KF_PROPS: KeyframeProp[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume'];

/**
 * Mutates. Splits a clip at an absolute timeline time. Returns the id of the new right-hand clip
 * or null when the time does not fall strictly inside the clip.
 */
export function splitClipAt(p: Project, clipId: ID, time: number, fps: number): ID | null {
  const clip = p.clips[clipId];
  if (!clip) return null;
  const t = snapToFrame(time, fps);
  const min = 1 / fps;
  const local = t - clip.start;
  if (local < min - EPS || clip.duration - local < min - EPS) return null;

  const right = JSON.parse(JSON.stringify(clip)) as Clip;
  right.id = uid(clip.id.slice(0, 3));
  right.start = t;
  right.duration = clip.duration - local;
  clip.duration = local;

  if (clip.type === 'video' || clip.type === 'audio' || clip.type === 'compound') {
    // Time mapping (speed ramps, reverse, freeze, nested time) for both halves: the left half
    // keeps showing [0, local) and the right half what came after it.
    const orig = JSON.parse(JSON.stringify(clip)) as Clip;
    orig.duration = local + right.duration;
    retimeClip(right, orig, local, right.duration);
    retimeClip(clip, orig, 0, local);
  }
  if ((clip.type === 'video' || clip.type === 'audio' || clip.type === 'compound') && (right.type === 'video' || right.type === 'audio' || right.type === 'compound')) {
    right.fadeIn = 0;
    clip.fadeOut = 0;
  }
  if (clip.type !== 'audio' && right.type !== 'audio') {
    if (clip.anim?.out) delete clip.anim.out;
    if (right.anim?.in) delete right.anim.in;
    if (clip.type === 'text' && right.type === 'text') {
      if (clip.textAnim?.out) delete clip.textAnim.out;
      if (right.textAnim?.in) delete right.textAnim.in;
    }
  }
  if (clip.keyframes) {
    const leftKf: NonNullable<Clip['keyframes']> = {};
    const rightKf: NonNullable<Clip['keyframes']> = {};
    for (const prop of KF_PROPS) {
      const frames = clip.keyframes[prop];
      if (!frames || frames.length === 0) continue;
      const parts = splitKeyframes(frames, local, baseProp(clip, prop));
      if (parts.left.length) leftKf[prop] = parts.left;
      if (parts.right.length) rightKf[prop] = parts.right;
    }
    clip.keyframes = leftKf;
    right.keyframes = rightKf;
  }

  p.clips[right.id] = right;
  // A transition that left the original clip now leaves the right half.
  for (const tr of Object.values(p.transitions)) {
    if (tr.fromId === clip.id) tr.fromId = right.id;
  }
  cleanupTransitions(p);
  return right.id;
}

/** Deep copy with a fresh id (and fresh effect instance ids). */
export function cloneClip<T extends Clip>(clip: T): T {
  const copy = JSON.parse(JSON.stringify(clip)) as T;
  copy.id = uid(clip.id.slice(0, 3));
  if (copy.type !== 'audio') {
    for (const fx of (copy as VisualClip).effects) fx.uid = uid('fx_');
  }
  return copy;
}

/**
 * Mutates. Inserts clips at `time`, keeping their relative timing and stacking order. Each
 * source track's clips stay together on one target track; new tracks are created when the
 * existing ones have no room. Returns the ids of the inserted clips.
 *
 * `main` describes a magnetic main track: clips copied from it go back onto it through
 * `main.insert` (which inserts at a cut and makes room); other clips never land on it.
 */
export function insertClipsAt(
  p: Project,
  clips: Clip[],
  time: number,
  sourceTrackOrder?: ID[],
  main?: { id: ID; insert: (p: Project, ids: ID[], time: number) => void },
): ID[] {
  if (clips.length === 0) return [];
  const origin = Math.min(...clips.map((c) => c.start));
  const groups = new Map<ID, Clip[]>();
  for (const c of clips) {
    if (!groups.has(c.trackId)) groups.set(c.trackId, []);
    groups.get(c.trackId)!.push(c);
  }
  // Bottom-most source track first so stacking order is preserved for visual tracks.
  const order = sourceTrackOrder ?? [];
  const keys = [...groups.keys()].sort((a, b) => order.indexOf(b) - order.indexOf(a));
  const inserted: ID[] = [];
  const usedTracks = new Set<ID>();
  // Copies form their own groups / links (copied together → still grouped / linked together).
  const remap = new Map<ID, ID>();
  const fresh = (id: ID, prefix: string): ID => {
    let next = remap.get(id);
    if (!next) remap.set(id, (next = uid(prefix)));
    return next;
  };
  for (const key of keys) {
    const group = groups.get(key)!;
    const kind = clipKind(group[0]);
    const toMain = !!main && key === main.id && p.tracks.some((t) => t.id === main.id && !t.locked);
    const fits = (t: Track): boolean =>
      t.kind === kind && !t.locked && !usedTracks.has(t.id) && t.id !== main?.id && group.every((c) => isFree(p, t.id, time + (c.start - origin), c.duration));
    const candidates = kind === 'visual' ? p.tracks.filter((t) => t.kind === 'visual').reverse() : p.tracks.filter((t) => t.kind === 'audio');
    const target = toMain ? p.tracks.find((t) => t.id === main!.id)! : (candidates.find(fits) ?? addTrack(p, kind));
    usedTracks.add(target.id);
    const first = inserted.length;
    for (const c of group) {
      const copy = cloneClip(c);
      copy.trackId = target.id;
      copy.start = time + (c.start - origin);
      if (copy.groupId) copy.groupId = fresh(copy.groupId, 'grp_');
      if (copy.linkId) copy.linkId = fresh(copy.linkId, 'lk_');
      p.clips[copy.id] = copy;
      inserted.push(copy.id);
    }
    if (toMain) main!.insert(p, inserted.slice(first), time + Math.min(...group.map((c) => c.start - origin)));
  }
  if (remap.size) cleanupRelations(p);
  return inserted;
}

/**
 * Mutates. Places template layers (ordered bottom → top, times relative to 0) on new visual
 * tracks above everything else, packing layers that never overlap in time onto shared tracks
 * while preserving the stacking order. Returns the inserted clip ids.
 */
export function insertTemplateLayers(p: Project, layers: Clip[], time: number, fps: number): ID[] {
  const groupId = uid('grp_');
  const lanes: Clip[][] = [];
  const laneOf = new Map<Clip, number>();
  const overlaps = (a: Clip, b: Clip): boolean => a.start < clipEnd(b) - EPS && clipEnd(a) > b.start + EPS;
  const visual = layers.filter((l) => l.type !== 'audio');
  for (let i = 0; i < visual.length; i++) {
    const layer = visual[i];
    let minLane = 0;
    for (let j = 0; j < i; j++) {
      if (overlaps(layer, visual[j])) minLane = Math.max(minLane, laneOf.get(visual[j])! + 1);
    }
    let lane = minLane;
    while (lane < lanes.length && lanes[lane].some((other) => overlaps(layer, other))) lane++;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(layer);
    laneOf.set(layer, lane);
  }
  const ids: ID[] = [];
  // Lane 0 is the lowest: create tracks bottom-up, each new one on top of the stack.
  for (const lane of lanes) {
    const track = addTrack(p, 'visual');
    for (const layer of lane) {
      const clip = cloneClip(layer);
      clip.trackId = track.id;
      clip.groupId = groupId;
      clip.start = snapToFrame(time + layer.start, fps);
      clip.duration = Math.max(1 / fps, snapToFrame(layer.duration, fps));
      p.clips[clip.id] = clip;
      ids.push(clip.id);
    }
  }
  for (const layer of layers.filter((l) => l.type === 'audio')) {
    const start = snapToFrame(time + layer.start, fps);
    const track = trackWithRoom(p, 'audio', start, layer.duration);
    const clip = cloneClip(layer);
    clip.trackId = track.id;
    clip.groupId = groupId;
    clip.start = start;
    p.clips[clip.id] = clip;
    ids.push(clip.id);
  }
  pruneEmptyTracks(p);
  return ids;
}

/** Mutates. Adds or replaces the transition between two adjacent clips. */
export function setTransition(p: Project, fromId: ID, toId: ID, type: string, duration: number, params: Transition['params'] = {}): Transition | null {
  const from = p.clips[fromId];
  const to = p.clips[toId];
  if (!from || !to || from.type === 'audio' || to.type === 'audio' || !areAdjacent(from, to)) return null;
  for (const tr of Object.values(p.transitions)) {
    if (tr.fromId === fromId || tr.toId === toId) delete p.transitions[tr.id];
  }
  const tr: Transition = { id: uid('tn_'), type, duration: Math.min(duration, maxTransitionDuration(from, to)), fromId, toId, params };
  p.transitions[tr.id] = tr;
  return tr;
}

/** Mutates. Moves the audio of a video clip to its own clip on an audio track. */
export function detachAudio(p: Project, clipId: ID): ID | null {
  const clip = p.clips[clipId];
  if (!clip || clip.type !== 'video' || clip.freeze) return null;
  const asset = p.assets[clip.assetId];
  if (!asset || !asset.hasAudio) return null;
  // Already detached: its sound is the linked audio clip.
  if (clip.linkId && Object.values(p.clips).some((c) => c.type === 'audio' && c.linkId === clip.linkId)) return null;
  const track = trackWithRoom(p, 'audio', clip.start, clip.duration);
  const audio: AudioClip = {
    id: uid('au_'),
    trackId: track.id,
    type: 'audio',
    name: clip.name,
    start: clip.start,
    duration: clip.duration,
    assetId: clip.assetId,
    trimIn: clip.trimIn,
    speed: clip.speed,
    volume: clip.volume,
    muted: false,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
  // The detached sound keeps following the picture's time mapping.
  if (clip.speedRamp?.length) audio.speedRamp = clip.speedRamp.map((k) => ({ ...k }));
  if (clip.reverse) audio.reverse = true;
  if (clip.preservePitch) audio.preservePitch = true;
  if (clip.keyframes?.volume) audio.keyframes = { volume: clip.keyframes.volume };
  // The picture and its sound stay linked: they move, trim, split and delete together.
  audio.linkId = clip.linkId ?? uid('lk_');
  clip.linkId = audio.linkId;
  p.clips[audio.id] = audio;
  clip.muted = true;
  return audio.id;
}

/**
 * Mutates. Replaces a template media placeholder with real media, keeping its timing,
 * placement, rounding and animation. The media is cropped to cover the placeholder exactly.
 */
export function fillSlot(p: Project, slotId: ID, asset: MediaAsset): ID | null {
  const slot = p.clips[slotId];
  if (!slot || slot.type !== 'shape' || asset.kind === 'audio') return null;
  const shape = (slot as ShapeClip).shape;
  const { cw, ch } = designSize(p.settings);
  const fit = fitContain(asset.width, asset.height, cw, ch);
  const slotAspect = shape.width / shape.height;
  const srcAspect = asset.width / asset.height;
  const crop = { l: 0, t: 0, r: 0, b: 0 };
  let w = fit.w;
  let h = fit.h;
  if (srcAspect > slotAspect) {
    const keep = slotAspect / srcAspect;
    crop.l = crop.r = (1 - keep) / 2;
    w = fit.w * keep;
  } else {
    const keep = srcAspect / slotAspect;
    crop.t = crop.b = (1 - keep) / 2;
    h = fit.h * keep;
  }
  const base = {
    id: uid(asset.kind === 'video' ? 'vd_' : 'im_'),
    trackId: slot.trackId,
    name: asset.name,
    start: slot.start,
    duration: slot.duration,
    groupId: slot.groupId,
    keyframes: slot.keyframes,
    transform: { ...slot.transform, scaleX: (shape.width / w) * slot.transform.scaleX, scaleY: (shape.height / h) * slot.transform.scaleY },
    blendMode: slot.blendMode,
    crop,
    cornerRadius: shape.radius > 0 ? Math.min(1, shape.radius / (Math.min(shape.width, shape.height) / 2)) : slot.cornerRadius,
    mask: slot.mask,
    adjust: slot.adjust,
    filter: slot.filter,
    effects: slot.effects,
    anim: slot.anim,
    assetId: asset.id,
  };
  const clip: Clip =
    asset.kind === 'video'
      ? { ...base, type: 'video', trimIn: 0, speed: 1, volume: 1, muted: true, fadeIn: 0, fadeOut: 0 }
      : { ...base, type: 'image' };
  if (clip.type === 'video' && asset.duration > 0 && clip.duration > asset.duration) {
    // Not enough footage: slow the clip down just enough to fill the slot.
    clip.speed = Math.max(0.1, asset.duration / clip.duration);
  }
  delete p.clips[slotId];
  p.clips[clip.id] = JSON.parse(JSON.stringify(clip)) as Clip;
  for (const tr of Object.values(p.transitions)) {
    if (tr.fromId === slotId) tr.fromId = clip.id;
    if (tr.toId === slotId) tr.toId = clip.id;
  }
  return clip.id;
}

// ---------------------------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export interface ProjectPathOptions {
  /**
   * Absolute path of the project file. When given, media inside the project's folder is stored
   * relative to it on save (`Media/clip.mp4`) and relative paths are resolved against it on load.
   * Paths outside the folder stay absolute, so older projects keep working unchanged.
   */
  projectPath?: string | null;
}

/** Map every file path an asset refers to (source, proxy, transcode original). */
function mapAssetPaths(assets: Record<ID, MediaAsset>, fn: (p: string) => string): Record<ID, MediaAsset> {
  const out: Record<ID, MediaAsset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    if (!isObj(asset)) continue;
    let next = asset;
    if (asset.source?.type === 'file' && typeof asset.source.path === 'string') next = { ...next, source: { ...asset.source, path: fn(asset.source.path) } };
    if (isObj(asset.proxy) && typeof asset.proxy.path === 'string') next = { ...next, proxy: { ...asset.proxy, path: fn(asset.proxy.path) } };
    if (typeof asset.transcodedFrom === 'string') next = { ...next, transcodedFrom: fn(asset.transcodedFrom) };
    out[id] = next;
  }
  return out;
}

function resolveAssetPaths(assets: Record<ID, MediaAsset>, projectPath: string | null | undefined): Record<ID, MediaAsset> {
  const dir = projectPath && isAbsolutePath(projectPath) ? dirnamePath(projectPath) : null;
  return dir ? mapAssetPaths(assets, (p) => resolveFrom(dir, p)) : assets;
}

export function serializeProject(project: Project, opts: ProjectPathOptions = {}): string {
  // Media under the project's folder is written relative to the project file (see core/paths.ts).
  const dir = opts.projectPath && isAbsolutePath(opts.projectPath) ? dirnamePath(opts.projectPath) : null;
  const assets = dir ? mapAssetPaths(project.assets, (p) => relativeInside(dir, p) ?? p) : project.assets;
  const file: ProjectFile = { app: 'kinora', version: PROJECT_FILE_VERSION, project: { ...project, assets, updatedAt: Date.now() } };
  return JSON.stringify(file);
}

/** Parse and sanitise a project file. Throws a readable error when the file is not usable. */
export function parseProjectFile(text: string, opts: ProjectPathOptions = {}): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid Kinora project (it could not be read as JSON).');
  }
  if (!isObj(raw) || raw.app !== 'kinora' || !isObj(raw.project)) throw new Error('This file is not a Kinora project.');
  if (num(raw.version, 0) > PROJECT_FILE_VERSION) throw new Error('This project was saved by a newer version of Kinora. Please update the app to open it.');
  const src = raw.project as unknown as Project;
  const settings = isObj(src.settings) ? (src.settings as unknown as ProjectSettings) : ({} as ProjectSettings);
  const project: Project = {
    id: typeof src.id === 'string' ? src.id : uid('pr_'),
    name: typeof src.name === 'string' ? src.name : 'Untitled project',
    createdAt: num(src.createdAt, Date.now()),
    updatedAt: num(src.updatedAt, Date.now()),
    settings: {
      width: Math.min(8192, Math.max(16, Math.round(num(settings.width, 1920)))),
      height: Math.min(8192, Math.max(16, Math.round(num(settings.height, 1080)))),
      fps: Math.min(240, Math.max(1, num(settings.fps, 30))),
      background: typeof settings.background === 'string' ? settings.background : '#000000',
    },
    // Relative media paths (media inside the project folder) resolve against the project file.
    assets: isObj(src.assets) ? resolveAssetPaths(src.assets as Project['assets'], opts.projectPath) : {},
    tracks: Array.isArray(src.tracks) ? src.tracks.filter((t) => isObj(t) && typeof t.id === 'string' && (t.kind === 'visual' || t.kind === 'audio')) : [],
    clips: {},
    transitions: {},
    markers: Array.isArray(src.markers) ? src.markers.filter((m) => isObj(m) && typeof m.id === 'string' && Number.isFinite(m.time)) : [],
  };
  // Export In / Out marks (optional).
  if (typeof src.inPoint === 'number' && Number.isFinite(src.inPoint)) project.inPoint = Math.max(0, src.inPoint);
  if (typeof src.outPoint === 'number' && Number.isFinite(src.outPoint)) project.outPoint = Math.max(0, src.outPoint);
  if (src.magneticMain === true) project.magneticMain = true;
  // Enforce the visual-then-audio ordering invariant.
  project.tracks = [...project.tracks.filter((t) => t.kind === 'visual'), ...project.tracks.filter((t) => t.kind === 'audio')];
  for (const t of project.tracks) {
    if (t.height !== undefined && !(Number.isFinite(t.height) && t.height > 0)) delete t.height;
    else if (t.height !== undefined) t.height = Math.round(Math.min(240, Math.max(20, t.height)));
  }
  ensureBaseTracks(project);
  // Clips and transitions, including the nested sequences of compound clips.
  const seq = sanitizeSequence({ tracks: project.tracks, clips: src.clips, transitions: src.transitions }, project.assets, 0);
  project.clips = seq.clips;
  project.transitions = seq.transitions;
  cleanupTransitions(project);
  cleanupRelations(project);
  return project;
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Sanitise the clips and transitions of a (possibly nested) sequence. `tracks` must already be
 * validated. Compound clips are sanitised recursively (nesting is capped).
 */
function sanitizeSequence(src: { tracks: Track[]; clips: unknown; transitions: unknown }, assets: Project['assets'], depth: number): Sequence {
  const out: Sequence = { tracks: src.tracks, clips: {}, transitions: {} };
  const trackKinds = new Map(src.tracks.map((t) => [t.id, t.kind]));
  for (const clip of Object.values(isObj(src.clips) ? (src.clips as Project['clips']) : {})) {
    if (!isObj(clip) || typeof clip.id !== 'string' || typeof clip.type !== 'string') continue;
    if (trackKinds.get(clip.trackId) !== clipKind(clip)) continue;
    if (!(num(clip.duration, 0) > 0) || !Number.isFinite(clip.start)) continue;
    if ((clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') && !assets[clip.assetId]) continue;
    clip.start = Math.max(0, clip.start);
    if (clip.groupId !== undefined && typeof clip.groupId !== 'string') delete clip.groupId;
    if (clip.linkId !== undefined && typeof clip.linkId !== 'string') delete clip.linkId;
    if (clip.type !== 'audio') {
      const v = clip as VisualClip;
      v.effects = Array.isArray(v.effects) ? v.effects : [];
      v.blendMode = v.blendMode ?? 'normal';
      v.transform = {
        x: num(v.transform?.x, 0),
        y: num(v.transform?.y, 0),
        scaleX: num(v.transform?.scaleX, 1),
        scaleY: num(v.transform?.scaleY, 1),
        rotation: num(v.transform?.rotation, 0),
        opacity: num(v.transform?.opacity, 1),
      };
    }
    if (clip.type === 'video' || clip.type === 'audio') {
      // Time remapping fields (all optional).
      clip.trimIn = Math.max(0, num(clip.trimIn, 0));
      clip.speed = Math.min(16, Math.max(0.1, num(clip.speed, 1)));
      const ramp = sanitizeRamp(clip.speedRamp);
      if (ramp) clip.speedRamp = ramp;
      else delete clip.speedRamp;
      for (const key of ['reverse', 'freeze', 'preservePitch'] as const) {
        if (clip[key] !== undefined && !isBool(clip[key])) delete clip[key];
      }
    }
    if (clip.type === 'compound') {
      if (depth >= 8 || !isObj(clip.sequence)) continue;
      const raw = clip.sequence as unknown as Record<string, unknown>;
      let tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).filter((t): t is Track => isObj(t) && typeof t.id === 'string' && (t.kind === 'visual' || t.kind === 'audio'));
      tracks = [...tracks.filter((t) => t.kind === 'visual'), ...tracks.filter((t) => t.kind === 'audio')];
      const holder = { tracks } as Project;
      ensureBaseTracks(holder);
      const nested = sanitizeSequence({ tracks: holder.tracks, clips: raw.clips, transitions: raw.transitions }, assets, depth + 1);
      const markers = Array.isArray(raw.markers) ? (raw.markers as Project['markers']).filter((m) => isObj(m) && typeof m.id === 'string' && Number.isFinite(m.time)) : [];
      clip.sequence = markers.length ? { ...nested, markers } : nested;
      clip.trimIn = Math.max(0, num(clip.trimIn, 0));
      clip.volume = Math.min(2, Math.max(0, num(clip.volume, 1)));
      clip.muted = isBool(clip.muted) ? clip.muted : false;
      clip.fadeIn = Math.max(0, num(clip.fadeIn, 0));
      clip.fadeOut = Math.max(0, num(clip.fadeOut, 0));
    }
    out.clips[clip.id] = clip;
  }
  for (const tr of Object.values(isObj(src.transitions) ? (src.transitions as Project['transitions']) : {})) {
    if (isObj(tr) && typeof tr.id === 'string' && out.clips[tr.fromId] && out.clips[tr.toId]) {
      out.transitions[tr.id] = { ...tr, params: isObj(tr.params) ? tr.params : {} };
    }
  }
  if (depth > 0) {
    cleanupTransitions(out as unknown as Project);
    cleanupRelations(out as unknown as Project);
  }
  return out;
}
