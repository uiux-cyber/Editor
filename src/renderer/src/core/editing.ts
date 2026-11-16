/**
 * Timeline editing beyond the basics in project.ts:
 *
 *  - trim modes: ripple, roll, slip and slide, plus plain trims that keep linked clips in sync;
 *  - the magnetic main track (no gaps; clips dropped onto it are inserted at a cut);
 *  - clip groups (`groupId`) and linked clips (`linkId`).
 *
 * A trim-mode edit is an `EditOp` plus a signed delta in seconds. `proposeEdit` works out where
 * every touched clip ends up without changing anything; `clampEdit` finds the largest delta on the
 * frame grid that keeps the timeline valid (no clip shorter than a frame or running past its
 * media, nothing before 0, no overlaps); `applyEdit` does both and mutates the project.
 *
 * Functions documented as "mutates" are meant for immer drafts inside a store update.
 */

import { uid } from './factory';
import { addTrack, cleanupRelations, cleanupTransitions, clipKind, clipsOnTrack, isFree, isMagneticTrack, mainTrackId, splitClipAt } from './project';
import { EPS, clipEnd } from './time';
import type { Clip, ID, Project, Track } from './types';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Clips with a source in-point (video, audio and nested sequences). */
type Trimmable = Extract<Clip, { trimIn: number }>;

export const hasTrimIn = (c: Clip): c is Trimmable => c.type === 'video' || c.type === 'audio' || c.type === 'compound';
const rateOf = (c: Clip): number => (c.type === 'video' || c.type === 'audio' ? c.speed : 1);
const ADJ = 1e-3;

function lockedTracks(p: Project): Set<ID> {
  return new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
}

/** Source length available to a clip (seconds of source), or Infinity when unbounded. */
function sourceSpan(p: Project, c: Clip): number {
  if (c.type === 'video' || c.type === 'audio') {
    const asset = p.assets[c.assetId];
    if (!asset || !(asset.duration > 0) || c.freeze || (c.speedRamp && c.speedRamp.length > 0)) return Infinity;
    return asset.duration;
  }
  if (c.type === 'compound') {
    let end = 0;
    for (const inner of Object.values(c.sequence?.clips ?? {})) end = Math.max(end, clipEnd(inner));
    return end > 0 ? end : Infinity;
  }
  return Infinity;
}

/** The clip on the same track that ends exactly where `c` starts. */
export function adjacentBefore(p: Project, c: Clip): Clip | null {
  for (const o of Object.values(p.clips)) {
    if (o.trackId === c.trackId && o.id !== c.id && Math.abs(clipEnd(o) - c.start) < ADJ) return o;
  }
  return null;
}

/** The clip on the same track that starts exactly where `c` ends. */
export function adjacentAfter(p: Project, c: Clip): Clip | null {
  for (const o of Object.values(p.clips)) {
    if (o.trackId === c.trackId && o.id !== c.id && Math.abs(o.start - clipEnd(c)) < ADJ) return o;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Groups and links
// ---------------------------------------------------------------------------------------------

/** Clips sharing `clipId`'s link id (not including the clip itself). */
export function linkedPartners(p: Project, clipId: ID): Clip[] {
  const clip = p.clips[clipId];
  if (!clip?.linkId) return [];
  return Object.values(p.clips).filter((c) => c.id !== clipId && c.linkId === clip.linkId);
}

/** Every clip in `clipId`'s group (including the clip itself). */
export function groupMembers(p: Project, clipId: ID): Clip[] {
  const clip = p.clips[clipId];
  if (!clip) return [];
  if (!clip.groupId) return [clip];
  return Object.values(p.clips).filter((c) => c.groupId === clip.groupId);
}

/** `ids` plus every clip grouped and / or linked with them (transitively). */
export function expandSelection(p: Project, ids: Iterable<ID>, opts: { groups?: boolean; links?: boolean } = {}): ID[] {
  const useGroups = opts.groups !== false;
  const useLinks = opts.links !== false;
  const byGroup = new Map<ID, ID[]>();
  const byLink = new Map<ID, ID[]>();
  for (const c of Object.values(p.clips)) {
    if (useGroups && c.groupId) (byGroup.get(c.groupId) ?? byGroup.set(c.groupId, []).get(c.groupId)!).push(c.id);
    if (useLinks && c.linkId) (byLink.get(c.linkId) ?? byLink.set(c.linkId, []).get(c.linkId)!).push(c.id);
  }
  const out = new Set<ID>();
  const queue: ID[] = [];
  for (const id of ids) {
    if (p.clips[id] && !out.has(id)) {
      out.add(id);
      queue.push(id);
    }
  }
  while (queue.length) {
    const c = p.clips[queue.pop()!];
    const related = [...(c.groupId ? (byGroup.get(c.groupId) ?? []) : []), ...(c.linkId ? (byLink.get(c.linkId) ?? []) : [])];
    for (const r of related) {
      if (!out.has(r)) {
        out.add(r);
        queue.push(r);
      }
    }
  }
  return [...out];
}

/** Mutates. Puts the clips in one new group. Returns its id, or null for fewer than two clips. */
export function groupClips(p: Project, ids: ID[]): ID | null {
  const live = ids.filter((id) => p.clips[id]);
  if (live.length < 2) return null;
  const groupId = uid('grp_');
  for (const id of live) p.clips[id].groupId = groupId;
  cleanupRelations(p);
  return groupId;
}

/** Mutates. Removes the clips from their groups. Returns true when anything changed. */
export function ungroupClips(p: Project, ids: ID[]): boolean {
  let changed = false;
  for (const id of ids) {
    if (p.clips[id]?.groupId) {
      delete p.clips[id].groupId;
      changed = true;
    }
  }
  if (changed) cleanupRelations(p);
  return changed;
}

/** Mutates. Links the clips so they select, move, trim, split and delete together. */
export function linkClips(p: Project, ids: ID[]): ID | null {
  const live = ids.filter((id) => p.clips[id]);
  if (live.length < 2) return null;
  const linkId = uid('lk_');
  for (const id of live) p.clips[id].linkId = linkId;
  cleanupRelations(p);
  return linkId;
}

/** Mutates. Breaks the links of the clips. Returns true when anything changed. */
export function unlinkClips(p: Project, ids: ID[]): boolean {
  let changed = false;
  for (const id of ids) {
    if (p.clips[id]?.linkId) {
      delete p.clips[id].linkId;
      changed = true;
    }
  }
  if (changed) cleanupRelations(p);
  return changed;
}

/**
 * Mutates. Splits clips at an absolute time; with `linked`, their linked partners are split too
 * and each pair of right halves gets its own fresh link. Returns the ids of the right halves.
 */
export function splitClipsAt(p: Project, ids: ID[], time: number, fps: number, linked = true): ID[] {
  const locked = lockedTracks(p);
  const all = linked ? expandSelection(p, ids, { groups: false }) : ids;
  const relink = new Map<ID, ID>();
  const created: ID[] = [];
  for (const id of all) {
    const c = p.clips[id];
    if (!c || locked.has(c.trackId)) continue;
    const linkId = c.linkId;
    const right = splitClipAt(p, id, time, fps);
    if (!right) continue;
    created.push(right);
    if (linkId) {
      let next = relink.get(linkId);
      if (!next) relink.set(linkId, (next = uid('lk_')));
      p.clips[right].linkId = next;
    }
  }
  cleanupRelations(p);
  return created;
}

// ---------------------------------------------------------------------------------------------
// Trim modes
// ---------------------------------------------------------------------------------------------

export type TrimEdge = 'l' | 'r';

/**
 * Delta conventions (seconds on the timeline):
 *  - trim: movement of the dragged edge (positive = to the right). With `ripple`, the clip keeps
 *    its start and everything after it on the track (and on the tracks of linked clips) shifts.
 *  - roll: movement of the cut between `leftId` and `rightId`.
 *  - slip: movement of the picture inside the clip; the in / out points move the other way.
 *  - slide: movement of the clip; its neighbours shorten / lengthen to compensate.
 * `linked` (default true in the helpers) applies the edit to linked partners as well.
 */
export type EditOp =
  | { kind: 'trim'; clipId: ID; edge: TrimEdge; ripple?: boolean; linked?: boolean }
  | { kind: 'roll'; leftId: ID; rightId: ID; linked?: boolean }
  | { kind: 'slip'; clipId: ID; linked?: boolean }
  | { kind: 'slide'; clipId: ID; linked?: boolean };

/** New placement of one clip in a proposal. */
export interface ClipEdit {
  start: number;
  duration: number;
  trimIn?: number;
  /** Keyframes move this much earlier (head trims keep keyframes glued to the picture). */
  kfShift: number;
}

export type Proposal = Map<ID, ClipEdit>;

class Builder {
  readonly edits: Proposal = new Map();

  get(c: Clip): ClipEdit {
    let e = this.edits.get(c.id);
    if (!e) {
      e = { start: c.start, duration: c.duration, trimIn: hasTrimIn(c) ? c.trimIn : undefined, kfShift: 0 };
      this.edits.set(c.id, e);
    }
    return e;
  }

  /** Move the left edge by `d`; `keepStart` (ripple) keeps the clip where it is instead. */
  head(c: Clip, d: number, keepStart = false): void {
    const e = this.get(c);
    if (!keepStart) e.start += d;
    e.duration -= d;
    if (e.trimIn !== undefined) e.trimIn += d * rateOf(c);
    e.kfShift += d;
  }

  tail(c: Clip, d: number): void {
    this.get(c).duration += d;
  }

  shift(c: Clip, d: number): void {
    this.get(c).start += d;
  }

  slip(c: Clip, d: number): void {
    const e = this.get(c);
    if (e.trimIn !== undefined) e.trimIn -= d * rateOf(c);
  }
}

function partnersOf(p: Project, id: ID, locked: ReadonlySet<ID>, exclude: ReadonlySet<ID> = new Set()): Clip[] {
  return linkedPartners(p, id).filter((c) => !locked.has(c.trackId) && !exclude.has(c.id));
}

/**
 * Shift every clip that starts at or after the edit point on the given tracks — and, so linked
 * clips stay in sync, on the tracks of their partners.
 */
function rippleShift(p: Project, b: Builder, tracks: Map<ID, number>, shift: number, exclude: ReadonlySet<ID>, locked: ReadonlySet<ID>): void {
  const queue = [...tracks.entries()];
  const seen = new Set(tracks.keys());
  const moved = new Set<ID>();
  while (queue.length) {
    const [trackId, at] = queue.shift()!;
    if (locked.has(trackId)) continue;
    for (const c of clipsOnTrack(p, trackId)) {
      if (exclude.has(c.id) || moved.has(c.id) || c.start < at - 1e-4) continue;
      moved.add(c.id);
      b.shift(c, shift);
      if (!c.linkId) continue;
      for (const partner of linkedPartners(p, c.id)) {
        if (!seen.has(partner.trackId)) {
          seen.add(partner.trackId);
          queue.push([partner.trackId, at]);
        }
      }
    }
  }
}

/** Where every touched clip would end up for `op` moved by `delta` seconds (nothing is changed). */
export function proposeEdit(p: Project, op: EditOp, delta: number): Proposal {
  const b = new Builder();
  const locked = lockedTracks(p);
  const d = delta;
  switch (op.kind) {
    case 'trim': {
      const lead = p.clips[op.clipId];
      if (!lead) break;
      const targets = [lead, ...(op.linked ? partnersOf(p, lead.id, locked) : [])];
      // Trims on the magnetic main track always ripple: it never has gaps.
      const ripple = !!op.ripple || targets.some((c) => isMagneticTrack(p, c.trackId));
      const editPoints = new Map<ID, number>();
      for (const c of targets) {
        if (op.edge === 'r') b.tail(c, d);
        else b.head(c, d, ripple);
        editPoints.set(c.trackId, Math.min(editPoints.get(c.trackId) ?? Infinity, clipEnd(c)));
      }
      if (ripple && d !== 0) rippleShift(p, b, editPoints, op.edge === 'r' ? d : -d, new Set(targets.map((c) => c.id)), locked);
      break;
    }
    case 'roll': {
      const left = p.clips[op.leftId];
      const right = p.clips[op.rightId];
      if (!left || !right) break;
      b.tail(left, d);
      b.head(right, d);
      if (!op.linked) break;
      const pair = new Set([left.id, right.id]);
      const lp = partnersOf(p, left.id, locked, pair);
      const rp = partnersOf(p, right.id, locked, pair);
      const used = new Set<ID>();
      for (const a of lp) {
        b.tail(a, d);
        // A partner pair that also meets at a cut rolls with it.
        const match = rp.find((r) => !used.has(r.id) && r.trackId === a.trackId && Math.abs(clipEnd(a) - r.start) < ADJ);
        if (match) {
          used.add(match.id);
          b.head(match, d);
        }
      }
      for (const r of rp) if (!used.has(r.id)) b.head(r, d);
      break;
    }
    case 'slip': {
      const lead = p.clips[op.clipId];
      if (!lead) break;
      for (const c of [lead, ...(op.linked ? partnersOf(p, lead.id, locked) : [])]) if (hasTrimIn(c)) b.slip(c, d);
      break;
    }
    case 'slide': {
      const lead = p.clips[op.clipId];
      if (!lead) break;
      const targets = [lead, ...(op.linked ? partnersOf(p, lead.id, locked) : [])];
      const ids = new Set(targets.map((c) => c.id));
      for (const c of targets) {
        b.shift(c, d);
        const prev = adjacentBefore(p, c);
        const next = adjacentAfter(p, c);
        if (prev && !ids.has(prev.id)) b.tail(prev, d);
        if (next && !ids.has(next.id)) b.head(next, d);
      }
      break;
    }
  }
  return b.edits;
}

/**
 * Is the proposal a valid timeline? Limits only bite when the edit makes things worse than they
 * already were, so a clip that is already slightly past its media never blocks an edit.
 */
export function isValidProposal(p: Project, edits: Proposal, fps: number): boolean {
  const minDur = 1 / Math.max(1, fps);
  const tracks = new Set<ID>();
  for (const [id, e] of edits) {
    const c = p.clips[id];
    if (!c) continue;
    if (e.duration < Math.min(minDur, c.duration) - EPS) return false;
    if (e.start < Math.min(0, c.start) - EPS) return false;
    if (e.trimIn !== undefined && hasTrimIn(c)) {
      if (e.trimIn < Math.min(0, c.trimIn) - 1e-6) return false;
      const span = sourceSpan(p, c);
      if (Number.isFinite(span)) {
        const rate = rateOf(c);
        const end = e.trimIn + e.duration * rate;
        if (end > Math.max(span, c.trimIn + c.duration * rate) + 1e-4) return false;
      }
    }
    tracks.add(c.trackId);
  }
  for (const trackId of tracks) {
    const spans = clipsOnTrack(p, trackId)
      .map((c) => {
        const e = edits.get(c.id);
        return e ? { s: e.start, e: e.start + e.duration, edited: true } : { s: c.start, e: clipEnd(c), edited: false };
      })
      .sort((a, b) => a.s - b.s);
    let maxEnd = -Infinity;
    let maxEditedEnd = -Infinity;
    for (const s of spans) {
      if (s.s < (s.edited ? maxEnd : maxEditedEnd) - 1e-4) return false;
      maxEnd = Math.max(maxEnd, s.e);
      if (s.edited) maxEditedEnd = Math.max(maxEditedEnd, s.e);
    }
  }
  return true;
}

/** The largest delta (on the frame grid, same sign, |result| ≤ |delta|) that keeps `op` valid. */
export function clampEdit(p: Project, op: EditOp, delta: number, fps: number): number {
  const f = Math.max(1, fps);
  const frames = Math.round(delta * f);
  if (frames === 0) return 0;
  const test = (n: number): boolean => isValidProposal(p, proposeEdit(p, op, n / f), f);
  if (test(frames)) return frames / f;
  const sign = Math.sign(frames);
  let lo = 0;
  let hi = Math.abs(frames);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (test(sign * mid)) lo = mid;
    else hi = mid;
  }
  return (sign * lo) / f;
}

/** Mutates. Writes a proposal into the project. */
export function applyProposal(p: Project, edits: Proposal): void {
  for (const [id, e] of edits) {
    const c = p.clips[id];
    if (!c) continue;
    c.start = Math.max(0, e.start);
    c.duration = e.duration;
    if (e.trimIn !== undefined && hasTrimIn(c)) c.trimIn = Math.max(0, e.trimIn);
    if (e.kfShift && c.keyframes) {
      for (const frames of Object.values(c.keyframes)) frames?.forEach((k) => (k.t = Math.max(0, k.t - e.kfShift)));
    }
  }
  cleanupTransitions(p);
}

/** Mutates. Clamps and applies an edit; returns the delta actually applied (seconds). */
export function applyEdit(p: Project, op: EditOp, delta: number, fps: number): number {
  const applied = clampEdit(p, op, delta, fps);
  if (applied !== 0) applyProposal(p, proposeEdit(p, op, applied));
  return applied;
}

/** Mutates. Plain trim of one edge (linked partners follow unless `linked` is false). */
export const trimClip = (p: Project, clipId: ID, edge: TrimEdge, delta: number, fps: number, linked = true): number =>
  applyEdit(p, { kind: 'trim', clipId, edge, linked }, delta, fps);

/** Mutates. Ripple trim: later clips on the track shift so no gap opens or closes. */
export const rippleTrim = (p: Project, clipId: ID, edge: TrimEdge, delta: number, fps: number, linked = true): number =>
  applyEdit(p, { kind: 'trim', clipId, edge, ripple: true, linked }, delta, fps);

/** Mutates. Roll the cut between two adjacent clips. */
export const rollEdit = (p: Project, leftId: ID, rightId: ID, delta: number, fps: number, linked = true): number =>
  applyEdit(p, { kind: 'roll', leftId, rightId, linked }, delta, fps);

/** Mutates. Slip a media clip's source in / out points; its timeline position stays. */
export const slipClip = (p: Project, clipId: ID, delta: number, fps: number, linked = true): number =>
  applyEdit(p, { kind: 'slip', clipId, linked }, delta, fps);

/** Mutates. Slide a clip between its neighbours, which trim to compensate. */
export const slideClip = (p: Project, clipId: ID, delta: number, fps: number, linked = true): number =>
  applyEdit(p, { kind: 'slide', clipId, linked }, delta, fps);

// ---------------------------------------------------------------------------------------------
// Magnetic main track
// ---------------------------------------------------------------------------------------------

/** A free track of `kind` for a clip that was pushed off its own (never the magnetic main). */
function roomFor(p: Project, c: Clip, start: number, ignore: ReadonlySet<ID>): Track {
  const kind = clipKind(c);
  const main = p.magneticMain ? mainTrackId(p) : null;
  const tracks = p.tracks.filter((t) => t.kind === kind && !t.locked && t.id !== main);
  const from = Math.max(0, p.tracks.findIndex((t) => t.id === c.trackId));
  const candidates = tracks.sort((a, b) => Math.abs(p.tracks.indexOf(a) - from) - Math.abs(p.tracks.indexOf(b) - from));
  for (const t of candidates) if (isFree(p, t.id, start, c.duration, ignore)) return t;
  return addTrack(p, kind, { trackId: c.trackId, where: kind === 'visual' ? 'above' : 'below' });
}

/**
 * Mutates. Moves the linked partners of moved clips by the same amounts so pictures and sound
 * stay in sync; a partner that no longer fits on its track moves to the nearest free one.
 */
export function syncLinkedPartners(p: Project, deltas: ReadonlyMap<ID, number>, skip: ReadonlySet<ID>): void {
  const locked = lockedTracks(p);
  const main = p.magneticMain ? mainTrackId(p) : null;
  const moves = new Map<ID, number>();
  for (const [id, d] of deltas) {
    if (Math.abs(d) < EPS) continue;
    for (const partner of linkedPartners(p, id)) {
      if (skip.has(partner.id) || deltas.has(partner.id) || moves.has(partner.id)) continue;
      if (locked.has(partner.trackId) || partner.trackId === main) continue;
      moves.set(partner.id, d);
    }
  }
  const pending = new Set(moves.keys());
  for (const [id, d] of moves) {
    pending.delete(id);
    const c = p.clips[id];
    const start = Math.max(0, c.start + d);
    c.start = start;
    const ignore = new Set([id, ...pending]);
    if (!isFree(p, c.trackId, start, c.duration, ignore)) c.trackId = roomFor(p, c, start, ignore).id;
  }
}

/** Mutates. Any of `ids` that overlaps another clip moves to the nearest free track of its kind. */
export function relocateOverlaps(p: Project, ids: ID[]): void {
  for (const id of ids) {
    const c = p.clips[id];
    if (!c || isFree(p, c.trackId, c.start, c.duration, new Set([id]))) continue;
    c.trackId = roomFor(p, c, c.start, new Set([id])).id;
  }
}

/**
 * Mutates. Packs the magnetic main track so it starts at 0 with no gaps, keeping linked clips in
 * sync. A no-op for projects without a magnetic main track. Returns true when anything moved.
 */
export function packMainTrack(p: Project): boolean {
  if (!p.magneticMain) return false;
  const main = mainTrackId(p);
  if (!main || p.tracks.find((t) => t.id === main)?.locked) return false;
  const clips = clipsOnTrack(p, main);
  const deltas = new Map<ID, number>();
  let cursor = 0;
  for (const c of clips) {
    if (Math.abs(c.start - cursor) > 1e-6) {
      deltas.set(c.id, cursor - c.start);
      p.clips[c.id].start = cursor;
    }
    cursor += c.duration;
  }
  if (deltas.size === 0) return false;
  syncLinkedPartners(p, deltas, new Set(clips.map((c) => c.id)));
  cleanupTransitions(p);
  return true;
}

/**
 * The cut on the main track (as it would be packed without `ignore`) nearest to `time`: 0, a
 * boundary between two clips, or the end of the track.
 */
export function mainInsertionCut(p: Project, time: number, ignore?: ReadonlySet<ID>): number {
  const main = mainTrackId(p);
  if (!main) return 0;
  let cut = 0;
  let best = Math.abs(time);
  let edge = 0;
  for (const c of clipsOnTrack(p, main, ignore)) {
    edge += c.duration;
    const d = Math.abs(edge - time);
    if (d < best - 1e-9) {
      best = d;
      cut = edge;
    }
  }
  return cut;
}

/**
 * Mutates. Puts `ids` (already in the project) on the main track as one block, in their current
 * order, at the cut nearest to `time`; later clips — and their linked partners, unless in `skip` —
 * move right to make room. Returns the start of the block.
 */
export function insertOnMain(p: Project, ids: ID[], time: number, skip: ReadonlySet<ID> = new Set()): number {
  const main = mainTrackId(p);
  if (!main) return time;
  const block = ids
    .map((id) => p.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const blockIds = new Set(block.map((c) => c.id));
  const rest = clipsOnTrack(p, main, blockIds);
  const cut = mainInsertionCut(p, time, blockIds);
  const len = block.reduce((sum, c) => sum + c.duration, 0);
  const deltas = new Map<ID, number>();
  let cursor = 0;
  for (const c of rest) {
    let start = cursor;
    cursor += c.duration;
    if (start >= cut - 1e-6) start += len;
    if (Math.abs(start - c.start) > 1e-6) {
      deltas.set(c.id, start - c.start);
      p.clips[c.id].start = start;
    }
  }
  let t = cut;
  for (const c of block) {
    const clip = p.clips[c.id];
    clip.trackId = main;
    clip.start = t;
    t += clip.duration;
  }
  syncLinkedPartners(p, deltas, new Set([...skip, ...blockIds, ...rest.map((c) => c.id)]));
  cleanupTransitions(p);
  return cut;
}
