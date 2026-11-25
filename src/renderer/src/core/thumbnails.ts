/**
 * Thumbnails (cover pictures) of a project. Each one is a short nested sequence of layers that is
 * edited like a compound clip: the store's edit path starts with `thumbnail:<id>` (see
 * compound.ts resolveEditPath / commitView), so the timeline, preview, inspector and library all
 * work on it. The exported picture is the frame at `thumbnail.time`.
 *
 * Pure: no DOM, no store.
 */

import { makeImage, makeTrack, uid } from './factory';
import { fitContain, designSize } from './project';
import type { ID, MediaAsset, Project, Sequence, Thumbnail } from './types';

/** Edit-path element of a thumbnail. */
export const THUMBNAIL_PATH = 'thumbnail:';
/** Length of a thumbnail's sequence (its layers span it; any frame of it can be the picture). */
export const THUMBNAIL_DURATION = 5;
/** Most thumbnails a project keeps (YouTube tests up to three). */
export const MAX_THUMBNAILS = 6;

export const thumbnailPathId = (id: ID): ID => THUMBNAIL_PATH + id;

/** The thumbnail an edit path opens (its first element), or null. */
export function thumbnailOfPath(path: readonly ID[]): ID | null {
  const first = path[0];
  return first && first.startsWith(THUMBNAIL_PATH) ? first.slice(THUMBNAIL_PATH.length) : null;
}

export const getThumbnail = (p: Pick<Project, 'thumbnails'>, id: ID | null | undefined): Thumbnail | undefined => (id ? p.thumbnails?.find((t) => t.id === id) : undefined);

/** "Thumbnail A", "Thumbnail B"… (the first letter not in use). */
export function nextThumbnailName(list: readonly Thumbnail[] | undefined): string {
  const used = new Set((list ?? []).map((t) => t.name));
  for (let i = 0; i < 26; i++) {
    const name = `Thumbnail ${String.fromCharCode(65 + i)}`;
    if (!used.has(name)) return name;
  }
  return `Thumbnail ${(list?.length ?? 0) + 1}`;
}

/** The background layer showing a captured video frame (covers the whole picture). */
export function frameLayer(p: Pick<Project, 'settings'>, frame: MediaAsset, trackId: ID): ReturnType<typeof makeImage> {
  const { cw, ch } = designSize(p.settings);
  const fit = fitContain(frame.width || cw, frame.height || ch, cw, ch);
  const cover = Math.max(cw / fit.w, ch / fit.h);
  const clip = makeImage(frame, { name: 'Video frame', duration: THUMBNAIL_DURATION, scale: cover });
  clip.trackId = trackId;
  return clip;
}

/** A new thumbnail: one visual track, with the captured frame as its background when given. */
export function createThumbnail(p: Pick<Project, 'settings' | 'thumbnails'>, frame?: { asset: MediaAsset; time: number } | null, name = nextThumbnailName(p.thumbnails)): Thumbnail {
  const visual = makeTrack('visual', 'V1');
  const audio = makeTrack('audio', 'A1');
  const sequence: Sequence = { tracks: [visual, audio], clips: {}, transitions: {} };
  if (frame) {
    const layer = frameLayer(p, frame.asset, visual.id);
    sequence.clips[layer.id] = layer;
  }
  return { id: uid('th_'), name, sequence, time: 0, ...(frame ? { frameAssetId: frame.asset.id, frameTime: frame.time } : {}) };
}

/** A copy of a thumbnail (new ids for it and its layers), named after the next free letter. */
export function duplicateThumbnail(p: Pick<Project, 'thumbnails'>, source: Thumbnail): Thumbnail {
  const copy = JSON.parse(JSON.stringify(source)) as Thumbnail;
  copy.id = uid('th_');
  copy.name = nextThumbnailName(p.thumbnails);
  const remap = new Map<ID, ID>();
  const clips: Sequence['clips'] = {};
  for (const c of Object.values(copy.sequence.clips)) {
    const id = uid(c.id.slice(0, 3));
    remap.set(c.id, id);
    clips[id] = { ...c, id };
  }
  const transitions: Sequence['transitions'] = {};
  for (const tr of Object.values(copy.sequence.transitions)) {
    const id = uid('tn_');
    const from = remap.get(tr.fromId);
    const to = remap.get(tr.toId);
    if (from && to) transitions[id] = { ...tr, id, fromId: from, toId: to };
  }
  copy.sequence = { ...copy.sequence, clips, transitions };
  return copy;
}

/** The thumbnail as a renderable project (same settings and media as the document). */
export function thumbnailProject(root: Project, t: Thumbnail): Project {
  const view: Project = { ...root, tracks: t.sequence.tracks, clips: t.sequence.clips, transitions: t.sequence.transitions, markers: t.sequence.markers ?? [] };
  delete view.inPoint;
  delete view.outPoint;
  delete view.thumbnails;
  return view;
}
