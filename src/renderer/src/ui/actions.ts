/**
 * Editor commands. Menus, shortcuts, context menus and library tiles all go through these so
 * behaviour (placement rules, undo steps, selection) is identical everywhere.
 */

import { uid, makeAdjustment, makeAudio, makeEffect, makeGenerator, makeImage, makeShape, makeSticker, makeText, makeVideo, linear } from '@/core/factory';
import { groupClips, insertOnMain, linkClips, splitClipsAt, ungroupClips, unlinkClips } from '@/core/editing';
import {
  addTrack,
  areAdjacent,
  cleanupTransitions,
  clipKind,
  clipsOnTrack,
  cloneClip,
  designSize,
  detachAudio,
  fillSlot,
  getIndex,
  insertClipsAt,
  isFree,
  isMagneticTrack,
  mainTrackId,
  maxDurationFromSource,
  nearestFreeStart,
  projectDuration,
  pruneEmptyTracks,
  removeClips,
  rippleDelete,
  setTransition,
  trackWithRoom,
} from '@/core/project';
import { defaultAnimationClipDuration } from '@/core/animTiming';
import { clipEnd, snapToFrame } from '@/core/time';
import { retimeClip } from '@/core/timemap';
import type { Clip, ID, MediaAsset, Project, ShapeKind, Track, VisualClip } from '@/core/types';
import { engine } from '@/engine/engine';
import { addSoundAsset } from '@/engine/media/assets';
import { stickerAspect } from '@/engine/sources/sticker';
import { getEffect, getFilter, getGenerator, getSticker, getTemplate, getTextPreset, getTransition } from '@/library';
import type { TemplateVariation } from '@/library/templateEngine';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { t } from './i18n';
import { TRACK_SIZES, clampTrackHeight, type TrackSize } from './timeline/geometry';
import { applyTemplateVariation } from './templates/apply';
import { applyThumbnailDesign, inThumbnail } from './thumbnails/actions';

const DEFAULT_STILL_DURATION = 5;

const fps = (): number => getProject().settings.fps;
const playhead = (): number => snapToFrame(engine.time, fps());
const selectedClips = (): Clip[] => {
  const p = getProject();
  return useUI
    .getState()
    .selection.map((id) => p.clips[id])
    .filter(Boolean);
};

/** Keep the selection free of ids that no longer exist. */
export function sanitizeSelection(): void {
  const ui = useUI.getState();
  const p = getProject();
  const alive = ui.selection.filter((id) => p.clips[id]);
  if (alive.length !== ui.selection.length) ui.set({ selection: alive });
  if (ui.selectedTransition && !p.transitions[ui.selectedTransition]) ui.set({ selectedTransition: null });
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

export interface Placement {
  /** Timeline time; defaults to the playhead. */
  time?: number;
  /** Preferred track; a compatible free track is found or created otherwise. */
  trackId?: ID;
  /** Create a new track above this one instead of reusing a track. */
  newTrackAbove?: ID;
  /** Create a new track at the very top / bottom of its kind. */
  newTrack?: boolean;
}

/**
 * Pick the track for an overlay (text, sticker, shape…): the nearest free visual track ABOVE
 * everything already visible in that time range, so the new layer is never hidden.
 */
function overlayTrack(p: Project, start: number, duration: number): Track {
  // Overlays never go on a magnetic main track: it holds the base sequence.
  const main = p.magneticMain ? mainTrackId(p) : null;
  const visual = p.tracks.filter((t) => t.kind === 'visual' && t.id !== main);
  let topBusy = visual.length; // index of the top-most track that has content in range
  for (let i = 0; i < visual.length; i++) {
    if (!isFree(p, visual[i].id, start, duration)) {
      topBusy = i;
      break;
    }
  }
  for (let i = Math.min(topBusy, visual.length) - 1; i >= 0; i--) {
    if (!visual[i].locked && isFree(p, visual[i].id, start, duration)) return visual[i];
  }
  if (topBusy === visual.length) {
    // Nothing in range anywhere: use the lowest free unlocked track.
    for (let i = visual.length - 1; i >= 0; i--) if (!visual[i].locked) return visual[i];
  }
  return addTrack(p, 'visual');
}

/** Mutates. Put a new clip on the timeline according to the placement rules. Returns it. */
function place(p: Project, clip: Clip, where: Placement, mode: 'media' | 'overlay' | 'audio'): Clip {
  const f = p.settings.fps;
  let start = snapToFrame(where.time ?? engine.time, f);
  clip.duration = Math.max(1 / f, snapToFrame(clip.duration, f));
  const kind = clipKind(clip);
  let track: Track | undefined;

  if (where.newTrackAbove) {
    track = addTrack(p, kind, { trackId: where.newTrackAbove, where: 'above' });
  } else if (where.newTrack) {
    track = addTrack(p, kind);
  } else if (where.trackId) {
    const t = p.tracks.find((x) => x.id === where.trackId);
    if (t && t.kind === kind && !t.locked) {
      track = t;
      if (!isMagneticTrack(p, t.id)) start = nearestFreeStart(p, t.id, start, clip.duration);
    }
  }
  if (!track) {
    if (mode === 'overlay') {
      track = overlayTrack(p, start, clip.duration);
    } else if (mode === 'media' && where.time === undefined) {
      // Click-to-add media builds a sequence on the base track: use the playhead when it is
      // free there, otherwise append after the last clip.
      const base = [...p.tracks].reverse().find((t) => t.kind === 'visual' && !t.locked) ?? addTrack(p, 'visual');
      track = base;
      if (!isFree(p, base.id, start, clip.duration)) {
        const clips = clipsOnTrack(p, base.id);
        start = clips.length ? clipEnd(clips[clips.length - 1]) : 0;
      }
    } else {
      track = trackWithRoom(p, kind, start, clip.duration);
    }
  }
  clip.trackId = track.id;
  clip.start = start;
  p.clips[clip.id] = clip;
  if (isMagneticTrack(p, track.id)) {
    // Magnetic main track: insert at the nearest cut (click-to-add appends to the sequence).
    const append = mode === 'media' && where.time === undefined && !where.trackId;
    insertOnMain(p, [clip.id], append ? Number.MAX_SAFE_INTEGER : start);
  }
  return clip;
}

function commitNew(build: (p: Project) => Clip | Clip[] | null, label: string): ID[] {
  let ids: ID[] = [];
  updateProject(
    (p) => {
      const made = build(p);
      if (!made) return;
      ids = (Array.isArray(made) ? made : [made]).map((c) => c.id);
    },
    { label },
  );
  if (ids.length) useUI.getState().select(ids);
  return ids;
}

const KIND_NAMES: Record<MediaAsset['kind'], string> = { video: 'video', audio: 'audio', image: 'image', animation: 'animation' };

// ---------------------------------------------------------------------------------------------
// Adding content
// ---------------------------------------------------------------------------------------------

export function addAsset(asset: MediaAsset, where: Placement = {}): ID[] {
  return commitNew((p) => {
    if (asset.kind === 'audio') return place(p, makeAudio(asset), where, 'audio');
    if (asset.kind === 'image') return place(p, makeImage(asset, { duration: DEFAULT_STILL_DURATION }), where, 'media');
    // Animated GIF / WebP / APNG / Lottie: an image clip one loop long (at least 3 s).
    if (asset.kind === 'animation') return place(p, makeImage(asset, { duration: defaultAnimationClipDuration(asset.duration) }), where, 'media');
    return place(p, makeVideo(asset), where, 'media');
  }, `Add ${KIND_NAMES[asset.kind]}`);
}

export function addText(presetId: string | null, where: Placement = {}): ID[] {
  const preset = presetId ? getTextPreset(presetId) : undefined;
  return commitNew((p) => {
    const { cw } = designSize(p.settings);
    const clip = makeText(preset?.sample ?? 'Your text here', {
      duration: DEFAULT_STILL_DURATION,
      style: { ...(preset?.style ?? {}), boxWidth: preset?.style.boxWidth ?? undefined },
      anim: preset?.anim,
      textAnim: preset?.textAnim,
    });
    // Count-up presets (library/textPresets/counters.ts) carry their counter settings.
    if (preset?.counter) clip.counter = { ...preset.counter };
    // Keep presets designed for landscape from overflowing narrow frames.
    const maxSize = cw < 1300 ? 0.72 : 1;
    if (maxSize < 1) clip.text.fontSize = Math.round(clip.text.fontSize * maxSize);
    return place(p, clip, where, 'overlay');
  }, 'Add text');
}

export function addSticker(stickerId: string, where: Placement = {}): ID[] {
  const def = getSticker(stickerId);
  if (!def) return [];
  return commitNew((p) => {
    const { cw } = designSize(p.settings);
    const aspect = stickerAspect(def);
    const size = Math.min(360, (cw * 0.5) / aspect);
    const clip = makeSticker(stickerId, { duration: DEFAULT_STILL_DURATION, size: Math.round(size), name: def.name });
    return place(p, clip, where, 'overlay');
  }, 'Add sticker');
}

export function addShape(kind: ShapeKind, where: Placement = {}): ID[] {
  return commitNew((p) => {
    const wide = kind === 'line' || kind === 'arrow' || kind === 'pill';
    const clip = makeShape(kind, {
      duration: DEFAULT_STILL_DURATION,
      width: wide ? 520 : 360,
      height: kind === 'line' ? 12 : wide ? 160 : 360,
      fill: linear(135, '#7c5cff', '#22d3ee'),
      radius: kind === 'rect' || kind === 'frame' ? 28 : 0,
    });
    return place(p, clip, where, 'overlay');
  }, 'Add shape');
}

export function addGenerator(generatorId: string, where: Placement = {}): ID[] {
  const def = getGenerator(generatorId);
  if (!def) return [];
  return commitNew((p) => place(p, makeGenerator(generatorId, { duration: DEFAULT_STILL_DURATION, name: def.name }), where, 'media'), 'Add background');
}

export function addAdjustment(where: Placement = {}, init?: { effectId?: string; filterId?: string }): ID[] {
  return commitNew((p) => {
    const clip = makeAdjustment({ duration: DEFAULT_STILL_DURATION });
    if (init?.effectId) {
      const def = getEffect(init.effectId);
      if (def) {
        clip.effects.push(makeEffect(def.id));
        clip.name = def.name;
      }
    }
    if (init?.filterId) {
      const def = getFilter(init.filterId);
      if (def) {
        clip.filter = { id: def.id, intensity: 1 };
        clip.name = def.name;
      }
    }
    return place(p, clip, where, 'overlay');
  }, 'Add adjustment layer');
}

export async function addSound(soundId: string, where: Placement = {}): Promise<ID[]> {
  try {
    const asset = await addSoundAsset(soundId);
    return commitNew((p) => place(p, makeAudio(p.assets[asset.id] ?? asset), where, 'audio'), 'Add sound');
  } catch (err) {
    toast('error', t('Could not add the sound'), (err as Error).message);
    return [];
  }
}

/**
 * Insert a template at the playhead (or `time`). Layers, the media they use (brand logo,
 * embedded media) and the template's music bed form a single undo step — see
 * ui/templates/apply.ts. Returns the ids of the inserted layers.
 */
export function applyTemplate(v: TemplateVariation, time?: number): ID[] {
  // While a thumbnail is open, a thumbnail design replaces its layers (try designs one after another).
  if (inThumbnail() && getTemplate(v.templateId)?.category === 'thumbnail') return applyThumbnailDesign(v);
  return applyTemplateVariation(v, { time }).ids;
}

/** Drop media on a template placeholder. */
export function fillSlotWith(slotId: ID, asset: MediaAsset): void {
  let newId: ID | null = null;
  updateProject(
    (p) => {
      newId = fillSlot(p, slotId, asset);
    },
    { label: 'Fill placeholder' },
  );
  if (newId) useUI.getState().select([newId]);
}

// ---------------------------------------------------------------------------------------------
// Transitions, effects, filters
// ---------------------------------------------------------------------------------------------

/** The cut (pair of adjacent visual clips) closest to a time. */
export function nearestCut(project: Project, time: number, trackId?: ID): { from: Clip; to: Clip; cut: number } | null {
  const idx = getIndex(project);
  let best: { from: Clip; to: Clip; cut: number } | null = null;
  for (const track of project.tracks) {
    if (track.kind !== 'visual' || track.locked || (trackId && track.id !== trackId)) continue;
    const clips = idx.byTrack.get(track.id) ?? [];
    for (let i = 0; i + 1 < clips.length; i++) {
      if (!areAdjacent(clips[i], clips[i + 1])) continue;
      const cut = clips[i + 1].start;
      if (!best || Math.abs(cut - time) < Math.abs(best.cut - time)) best = { from: clips[i], to: clips[i + 1], cut };
    }
  }
  return best;
}

export function addTransition(type: string, fromId?: ID, toId?: ID): boolean {
  const def = getTransition(type);
  if (!def) return false;
  const project = getProject();
  let pair = fromId && toId ? { from: project.clips[fromId], to: project.clips[toId] } : null;
  if (!pair) {
    // Prefer a cut touching the selection, then the cut nearest to the playhead.
    const sel = selectedClips();
    for (const clip of sel) {
      const near = nearestCut(project, clipEnd(clip), clip.trackId);
      if (near && (near.from.id === clip.id || near.to.id === clip.id)) {
        pair = near;
        break;
      }
    }
    pair ??= nearestCut(project, engine.time);
  }
  if (!pair || !pair.from || !pair.to) {
    toast('info', t('Transitions go between two clips'), t('Place two clips side by side on the same track, then add a transition.'));
    return false;
  }
  let id: ID | null = null;
  updateProject(
    (p) => {
      const tr = setTransition(p, pair!.from.id, pair!.to.id, def.id, def.duration ?? 0.6);
      id = tr?.id ?? null;
    },
    { label: 'Add transition' },
  );
  if (id) useUI.getState().selectTransition(id);
  return !!id;
}

export function removeTransition(id: ID): void {
  updateProject(
    (p) => {
      delete p.transitions[id];
    },
    { label: 'Remove transition' },
  );
  sanitizeSelection();
}

export function applyEffect(effectId: string, clipId?: ID): void {
  const def = getEffect(effectId);
  if (!def) return;
  const targets = clipId ? [clipId] : selectedClips().filter((c) => c.type !== 'audio').map((c) => c.id);
  if (targets.length === 0) {
    addAdjustment({}, { effectId });
    toast('info', t('{name} added as an adjustment layer', { name: def.name }), t('It affects everything beneath it. Select a clip first to apply an effect to that clip only.'));
    return;
  }
  updateProject(
    (p) => {
      for (const id of targets) {
        const clip = p.clips[id];
        if (clip && clip.type !== 'audio') clip.effects.push(makeEffect(def.id));
      }
    },
    { label: `Apply ${def.name}` },
  );
}

export function applyFilter(filterId: string | null, clipId?: ID): void {
  const targets = clipId ? [clipId] : selectedClips().filter((c) => c.type !== 'audio').map((c) => c.id);
  if (targets.length === 0) {
    if (!filterId) return;
    const def = getFilter(filterId);
    addAdjustment({}, { filterId });
    if (def) toast('info', t('{name} added as an adjustment layer', { name: def.name }), t('It grades everything beneath it. Select a clip first to filter that clip only.'));
    return;
  }
  updateProject(
    (p) => {
      for (const id of targets) {
        const clip = p.clips[id];
        if (!clip || clip.type === 'audio') continue;
        if (filterId) clip.filter = { id: filterId, intensity: clip.filter?.intensity ?? 1 };
        else delete clip.filter;
      }
    },
    { label: filterId ? `Apply ${getFilter(filterId)?.name ?? 'filter'}` : 'Remove filter' },
  );
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

/** Update the given clips in one undo step. */
export function editClips(ids: ID[], recipe: (clip: Clip) => void, coalesce?: string): void {
  if (ids.length === 0) return;
  updateProject(
    (p) => {
      for (const id of ids) {
        const clip = p.clips[id];
        if (clip) recipe(clip);
      }
    },
    coalesce ? { coalesce } : undefined,
  );
}

export function editVisual(ids: ID[], recipe: (clip: VisualClip) => void, coalesce?: string): void {
  editClips(
    ids,
    (clip) => {
      if (clip.type !== 'audio') recipe(clip);
    },
    coalesce,
  );
}

export function splitAtPlayhead(): void {
  const project = getProject();
  const time = playhead();
  const sel = selectedClips();
  const lockedTracks = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
  const candidates = (sel.length ? sel : Object.values(project.clips)).filter(
    (c) => !lockedTracks.has(c.trackId) && time > c.start + 1e-6 && time < clipEnd(c) - 1e-6,
  );
  if (candidates.length === 0) {
    toast('info', t('Nothing to split here'), t('Move the playhead over a clip first.'));
    return;
  }
  let created: ID[] = [];
  updateProject(
    (p) => {
      // Linked partners (a video and its detached sound) are split with it.
      created = splitClipsAt(p, candidates.map((c) => c.id), time, p.settings.fps, true);
    },
    { label: 'Split' },
  );
  if (created.length) useUI.getState().select(created);
}

/** Split one clip (blade tool). With `linked`, its linked partners are split at the same time. */
export function splitClip(clipId: ID, time: number, linked = true): void {
  updateProject(
    (p) => {
      splitClipsAt(p, [clipId], time, p.settings.fps, linked);
    },
    { label: 'Split' },
  );
}

export function deleteSelection(ripple = false): void {
  const ui = useUI.getState();
  if (ui.selectedTransition) {
    removeTransition(ui.selectedTransition);
    return;
  }
  const ids = ui.selection.filter((id) => getProject().clips[id]);
  if (ids.length === 0) return;
  updateProject(
    (p) => {
      const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
      const deletable = ids.filter((id) => p.clips[id] && !locked.has(p.clips[id].trackId));
      if (ripple) rippleDelete(p, deletable);
      else removeClips(p, deletable);
    },
    { label: ripple ? 'Ripple delete' : ids.length > 1 ? 'Delete clips' : 'Delete clip' },
  );
  sanitizeSelection();
}

/** How paste / duplicate treat a magnetic main track: copies of its clips insert at a cut. */
function magneticMain(p: Project): { id: ID; insert: (p: Project, ids: ID[], time: number) => void } | undefined {
  const id = p.magneticMain ? mainTrackId(p) : null;
  return id ? { id, insert: (d, ids, time) => void insertOnMain(d, ids, time) } : undefined;
}

export function copySelection(): boolean {
  const clips = selectedClips();
  if (clips.length === 0) return false;
  useUI.getState().set({
    clipboard: { clips: JSON.parse(JSON.stringify(clips)) as Clip[], trackOrder: getProject().tracks.map((t) => t.id) },
  });
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection(false);
}

export function paste(): void {
  const data = useUI.getState().clipboard;
  if (!data || data.clips.length === 0) return;
  const project = getProject();
  // Media may have been removed from the bin since the copy.
  const usable = data.clips.filter((c) => !('assetId' in c) || project.assets[c.assetId]);
  if (usable.length === 0) return;
  let ids: ID[] = [];
  updateProject(
    (p) => {
      ids = insertClipsAt(p, usable, playhead(), data.trackOrder, magneticMain(p));
    },
    { label: 'Paste' },
  );
  useUI.getState().select(ids);
}

export function duplicateSelection(): void {
  const clips = selectedClips();
  if (clips.length === 0) return;
  const project = getProject();
  const end = Math.max(...clips.map(clipEnd));
  let ids: ID[] = [];
  updateProject(
    (p) => {
      ids = insertClipsAt(p, clips, end, project.tracks.map((t) => t.id), magneticMain(p));
    },
    { label: 'Duplicate' },
  );
  useUI.getState().select(ids);
}

export function selectAll(): void {
  useUI.getState().select(Object.keys(getProject().clips));
}

export function nudgeSelection(frames: number): void {
  const clips = selectedClips();
  if (clips.length === 0) return;
  const f = fps();
  const delta = frames / f;
  const ids = new Set(clips.map((c) => c.id));
  // All-or-nothing: only move when every selected clip has room.
  const project = getProject();
  const ok = clips.every((c) => c.start + delta >= -1e-6 && isFree(project, c.trackId, c.start + delta, c.duration, ids));
  if (!ok) return;
  updateProject(
    (p) => {
      for (const c of clips) p.clips[c.id].start = snapToFrame(Math.max(0, c.start + delta), f);
      cleanupTransitions(p);
    },
    { coalesce: 'nudge', label: 'Nudge' },
  );
}

/** Trim the start (Q) or end (W) of the selected / touched clips to the playhead. */
export function trimToPlayhead(edge: 'start' | 'end'): void {
  const project = getProject();
  const time = playhead();
  const sel = selectedClips();
  const targets = (sel.length ? sel : Object.values(project.clips)).filter((c) => time > c.start + 1e-6 && time < clipEnd(c) - 1e-6);
  if (targets.length === 0) return;
  updateProject(
    (p) => {
      for (const t of targets) {
        const clip = p.clips[t.id];
        if (edge === 'start') {
          const cut = time - clip.start;
          // In-point through the time mapping (speed ramps, reverse, freeze, compound clips).
          retimeClip(clip, t, cut, clip.duration - cut);
          if (clip.keyframes) {
            for (const frames of Object.values(clip.keyframes)) frames?.forEach((k) => (k.t = Math.max(0, k.t - cut)));
          }
          clip.start = time;
        } else {
          retimeClip(clip, t, 0, time - clip.start);
        }
      }
      cleanupTransitions(p);
    },
    { label: edge === 'start' ? 'Trim start to playhead' : 'Trim end to playhead' },
  );
}

export function detachAudioFromSelection(): void {
  const clips = selectedClips().filter((c) => c.type === 'video');
  if (clips.length === 0) return;
  const made: ID[] = [];
  updateProject(
    (p) => {
      for (const c of clips) {
        const id = detachAudio(p, c.id);
        if (id) made.push(id);
      }
    },
    { label: 'Detach audio' },
  );
  if (made.length) useUI.getState().select([...clips.map((c) => c.id), ...made]);
  else toast('info', t('Nothing to detach'), t('The selected clips have no sound, or it is already on its own clip.'));
}

/** Change clip speed, keeping the in-point and clamping to the available media. */
export function setSpeed(ids: ID[], speed: number): void {
  const s = Math.min(16, Math.max(0.1, speed));
  updateProject(
    (p) => {
      const f = p.settings.fps;
      for (const id of ids) {
        const clip = p.clips[id];
        if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
        const sourceSpan = clip.duration * clip.speed;
        clip.speed = s;
        let duration = Math.max(1 / f, snapToFrame(sourceSpan / s, f));
        duration = Math.min(duration, maxDurationFromSource(clip, p.assets));
        // Do not run into the next clip on the track when slowing down (the magnetic main
        // track pushes later clips instead).
        const next = clipsOnTrack(p, clip.trackId).find((c) => c.start >= clip.start + 1e-6 && c.id !== clip.id);
        if (next && !isMagneticTrack(p, clip.trackId)) duration = Math.min(duration, next.start - clip.start);
        clip.duration = Math.max(1 / f, duration);
      }
      cleanupTransitions(p);
    },
    { coalesce: 'speed', label: 'Change speed' },
  );
}

export function addMarker(): void {
  const time = playhead();
  updateProject(
    (p) => {
      if (p.markers.some((m) => Math.abs(m.time - time) < 1e-4)) return;
      p.markers.push({ id: uid('mk_'), time, label: '', color: '#fbbf24' });
      p.markers.sort((a, b) => a.time - b.time);
    },
    { label: 'Add marker' },
  );
}

export function addTrackOfKind(kind: 'visual' | 'audio'): void {
  updateProject(
    (p) => {
      addTrack(p, kind);
    },
    { label: kind === 'visual' ? 'Add video track' : 'Add audio track' },
  );
}

export function tidyTracks(): void {
  updateProject((p) => pruneEmptyTracks(p), { label: 'Remove empty tracks' });
}

// ---------------------------------------------------------------------------------------------
// Groups, links, magnetic main track, track sizes, history
// ---------------------------------------------------------------------------------------------

export function groupSelection(): void {
  const ids = useUI.getState().selection.filter((id) => getProject().clips[id]);
  if (ids.length < 2) {
    toast('info', t('Select two or more clips to group them'), t('Shift-click the clips or drag a box around them first.'));
    return;
  }
  updateProject((p) => void groupClips(p, ids), { label: 'Group clips' });
}

export function ungroupSelection(): void {
  const ids = useUI.getState().selection;
  if (!ids.some((id) => getProject().clips[id]?.groupId)) return;
  updateProject((p) => void ungroupClips(p, ids), { label: 'Ungroup clips' });
}

export function linkSelection(): void {
  const ids = useUI.getState().selection.filter((id) => getProject().clips[id]);
  if (ids.length < 2) {
    toast('info', t('Select two or more clips to link them'), t('Linked clips select, move, trim, split and delete together.'));
    return;
  }
  updateProject((p) => void linkClips(p, ids), { label: 'Link clips' });
}

export function unlinkSelection(): void {
  const ids = useUI.getState().selection;
  if (!ids.some((id) => getProject().clips[id]?.linkId)) return;
  updateProject((p) => void unlinkClips(p, ids), { label: 'Unlink clips' });
}

/** Turn the magnetic main track on or off (turning it on closes the gaps on it). */
export function toggleMagneticMain(): void {
  const on = !getProject().magneticMain;
  updateProject(
    (p) => {
      if (on) p.magneticMain = true;
      else delete p.magneticMain;
    },
    { label: on ? 'Magnetic main track on' : 'Magnetic main track off' },
  );
}

/** Set every track to one of the preset heights. */
export function setTrackSize(size: TrackSize): void {
  updateProject(
    (p) => {
      for (const t of p.tracks) {
        if (size === 'medium') delete t.height;
        else t.height = TRACK_SIZES[size][t.kind];
      }
    },
    { label: `Track size: ${size[0].toUpperCase()}${size.slice(1)}` },
  );
}

/** Set (or with `undefined`, reset) the height of one track. */
export function setTrackHeight(trackId: ID, height: number | undefined): void {
  updateProject(
    (p) => {
      const t = p.tracks.find((x) => x.id === trackId);
      if (!t) return;
      if (height === undefined) delete t.height;
      else t.height = clampTrackHeight(t.kind, height);
    },
    { label: height === undefined ? 'Reset track height' : 'Resize track' },
  );
}

/** Jump to a state listed in the History panel (0 = oldest kept state). */
export function goToHistory(index: number): void {
  useProjectStore.getState().goTo(index);
  sanitizeSelection();
}

/** Jump to the previous / next edit point (clip boundary or marker). */
export function jumpToEdit(direction: -1 | 1): void {
  const project = getProject();
  const points = new Set<number>([0, projectDuration(project)]);
  for (const c of Object.values(project.clips)) {
    points.add(c.start);
    points.add(clipEnd(c));
  }
  for (const m of project.markers) points.add(m.time);
  const sorted = [...points].sort((a, b) => a - b);
  const t = engine.time;
  const eps = 0.5 / project.settings.fps;
  const target = direction > 0 ? sorted.find((p) => p > t + eps) : [...sorted].reverse().find((p) => p < t - eps);
  if (target !== undefined) engine.seek(target);
}

export const undo = (): void => {
  useProjectStore.getState().undo();
  sanitizeSelection();
};
export const redo = (): void => {
  useProjectStore.getState().redo();
  sanitizeSelection();
};

export { cloneClip };
