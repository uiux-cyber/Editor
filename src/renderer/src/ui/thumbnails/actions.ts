/**
 * Thumbnails (cover pictures for the video): open one for editing (it replaces the timeline, like
 * a compound clip), capture video frames, try designs, keep A/B/C variants and export pictures.
 * The model lives in core/thumbnails.ts.
 */

import { useMemo } from 'react';
import { fillSlot, insertTemplateLayers, pruneEmptyTracks, designSize } from '@/core/project';
import { createThumbnail, duplicateThumbnail, getThumbnail, MAX_THUMBNAILS, thumbnailOfPath, thumbnailPathId, thumbnailProject } from '@/core/thumbnails';
import { formatTimecode } from '@/core/time';
import type { ID, MediaAsset, Project, ShapeClip, Thumbnail } from '@/core/types';
import { engine } from '@/engine/engine';
import { canvasBlob, jpegUnder, renderStill } from '@/engine/export/still';
import { importMediaFiles } from '@/engine/media/assets';
import { buildTemplate, type TemplateVariation } from '@/library/templateEngine';
import { api } from '@/platform/api';
import { getRootProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import type { FileInfo } from '@shared/ipc';
import { t, tk } from '../i18n';
import { closeCompound } from '../time/timeActions';
import { useTemplates } from '../templates/store';

/** YouTube takes thumbnails up to 2 MB. */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** Video playhead to return to when the thumbnails are closed. */
let videoTime = 0;

/** Where the video's playhead is (remembered while a thumbnail is open). */
export const videoPlayhead = (): number => (inThumbnail() ? videoTime : engine.time);

export const openThumbnailId = (): ID | null => thumbnailOfPath(useProjectStore.getState().editPath);
export const inThumbnail = (): boolean => openThumbnailId() !== null;
export const thumbnailsOf = (): Thumbnail[] => getRootProject().thumbnails ?? [];

/** The open thumbnail and every thumbnail of the project (re-renders when they change). */
export function useThumbnails(): { open: Thumbnail | undefined; list: Thumbnail[] } {
  const path = useProjectStore((s) => s.editPath);
  const list = useProjectStore((s) => s.root.thumbnails);
  return useMemo(() => {
    const id = thumbnailOfPath(path);
    return { open: id ? list?.find((x) => x.id === id) : undefined, list: list ?? [] };
  }, [path, list]);
}

/** Output size: YouTube's 1280 px on the long side (or the project's full size). */
export function thumbnailSize(settings: Project['settings'], full = false): { width: number; height: number } {
  if (full) return { width: settings.width, height: settings.height };
  const k = 1280 / Math.max(settings.width, settings.height);
  return { width: Math.round(settings.width * k), height: Math.round(settings.height * k) };
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Capture the video's frame at `time` as a picture in the media bin (saved in Documents\Kinora\Thumbnails). */
export async function captureFrame(time: number): Promise<MediaAsset | null> {
  const root = getRootProject();
  const { width, height } = root.settings;
  try {
    const canvas = await renderStill(root, time, width, height);
    const blob = await canvasBlob(canvas, 'image/png');
    if (!blob) throw new Error('The frame could not be encoded.');
    const file = await api.call<FileInfo>('x:thumbnails:saveFrame', `${root.name} ${formatTimecode(time, root.settings.fps).replace(/[:.;]/g, '-')}`, new Uint8Array(await blob.arrayBuffer()));
    const result = await importMediaFiles([file]);
    if (!result.assets[0]) throw new Error(result.failures[0]?.reason ?? 'The frame could not be imported.');
    return result.assets[0];
  } catch (err) {
    toast('error', t('The video frame could not be captured'), errorText(err));
    return null;
  }
}

function show(th: Thumbnail): void {
  useProjectStore.getState().setEditPath([thumbnailPathId(th.id)]);
  useUI.getState().set({ selection: [], selectedTransition: null });
  engine.seek(th.time);
}

/** Remember where the playhead is in the open thumbnail (the picture that is exported). */
function keepTime(): void {
  const id = openThumbnailId();
  const time = engine.time;
  const th = getThumbnail(getRootProject(), id);
  if (!th || Math.abs(th.time - time) < 1e-6) return;
  useProjectStore.getState().updateRoot((p) => {
    const x = p.thumbnails?.find((y) => y.id === id);
    if (x) x.time = time;
  }, { history: false });
}

/** Show thumbnail designs in Library ▸ Templates. */
function showDesigns(): void {
  useTemplates.setState({ galleryCategory: 'thumbnail' });
  useUI.getState().set({ libraryTab: 'templates' });
}

/** Add a thumbnail from the video frame at `time` (one undo step) and open it. */
export async function newThumbnailFromFrame(time = inThumbnail() ? videoTime : engine.time): Promise<Thumbnail | null> {
  if (thumbnailsOf().length >= MAX_THUMBNAILS) {
    toast('info', t('A project keeps up to {count} thumbnails', { count: MAX_THUMBNAILS }), t('Delete one to make another.'));
    return null;
  }
  const store = useProjectStore.getState();
  if (store.txnBase) return null;
  engine.pause();
  store.begin(tk('Add thumbnail'));
  let thumb: Thumbnail | null = null;
  try {
    const frame = await captureFrame(time);
    thumb = createThumbnail(getRootProject(), frame ? { asset: frame, time } : null);
    const created = thumb;
    useProjectStore.getState().updateRoot((p) => {
      p.thumbnails = [...(p.thumbnails ?? []), created];
    });
  } finally {
    useProjectStore.getState().commit(tk('Add thumbnail'));
  }
  if (thumb) {
    keepTime();
    show(thumb);
    showDesigns();
  }
  return thumb;
}

/**
 * Edit the project's thumbnails: opens `id` (default: the first one). A project without
 * thumbnails gets one, made from the video frame under the playhead.
 */
export async function openThumbnails(id?: ID): Promise<Thumbnail | null> {
  const store = useProjectStore.getState();
  if (store.txnBase) return null;
  engine.pause();
  if (!inThumbnail()) {
    if (store.editPath.length) closeCompound(0);
    videoTime = engine.time;
  } else keepTime();
  const list = thumbnailsOf();
  const target = getThumbnail(getRootProject(), id) ?? list[0];
  if (!target) return newThumbnailFromFrame(videoTime);
  show(target);
  showDesigns();
  return target;
}

/** Back to the video timeline (the playhead returns to where it was). */
export function closeThumbnails(): void {
  if (!inThumbnail() || useProjectStore.getState().txnBase) return;
  engine.pause();
  keepTime();
  useProjectStore.getState().setEditPath([]);
  useUI.getState().set({ selection: [], selectedTransition: null });
  engine.seek(videoTime);
}

/** Switch to another thumbnail. */
export function switchThumbnail(id: ID): void {
  const th = getThumbnail(getRootProject(), id);
  if (!th || id === openThumbnailId()) return;
  engine.pause();
  keepTime();
  show(th);
}

/** A copy of a thumbnail as the next variant (A/B tests), opened. */
export function duplicateThumbnailById(id: ID | null = openThumbnailId()): Thumbnail | null {
  const root = getRootProject();
  const th = getThumbnail(root, id);
  if (!th) return null;
  if (thumbnailsOf().length >= MAX_THUMBNAILS) {
    toast('info', t('A project keeps up to {count} thumbnails', { count: MAX_THUMBNAILS }), t('Delete one to make another.'));
    return null;
  }
  keepTime();
  const copy = duplicateThumbnail(root, { ...th, time: id === openThumbnailId() ? engine.time : th.time });
  useProjectStore.getState().updateRoot((p) => {
    const at = (p.thumbnails ?? []).findIndex((x) => x.id === th.id);
    const list = [...(p.thumbnails ?? [])];
    list.splice(at + 1, 0, copy);
    p.thumbnails = list;
  }, { label: tk('Duplicate thumbnail') });
  if (inThumbnail()) show(copy);
  return copy;
}

export function renameThumbnail(id: ID, name: string): void {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  useProjectStore.getState().updateRoot((p) => {
    const th = p.thumbnails?.find((x) => x.id === id);
    if (th) th.name = clean;
  }, { label: tk('Rename thumbnail') });
}

/** Delete a thumbnail (undoable). Deleting the open one opens a neighbour, or returns to the video. */
export function deleteThumbnail(id: ID): void {
  const list = thumbnailsOf();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const wasOpen = openThumbnailId() === id;
  if (wasOpen) closeThumbnails();
  useProjectStore.getState().updateRoot((p) => {
    p.thumbnails = (p.thumbnails ?? []).filter((x) => x.id !== id);
    if (!p.thumbnails.length) delete p.thumbnails;
  }, { label: tk('Delete thumbnail') });
  if (wasOpen) {
    const next = thumbnailsOf()[Math.min(i, thumbnailsOf().length - 1)];
    if (next) void openThumbnails(next.id);
  }
}

/** Use the video frame at `time` in the open thumbnail: layers showing the old frame show the new one. */
export async function changeThumbnailFrame(time: number): Promise<boolean> {
  const id = openThumbnailId();
  const th = getThumbnail(getRootProject(), id);
  if (!th) return false;
  const store = useProjectStore.getState();
  if (store.txnBase) return false;
  store.begin(tk('Change thumbnail frame'));
  try {
    const frame = await captureFrame(time);
    if (!frame) return false;
    const old = th.frameAssetId;
    useProjectStore.getState().update((p) => {
      let replaced = 0;
      for (const c of Object.values(p.clips)) {
        if (c.type === 'image' && old && c.assetId === old) {
          c.assetId = frame.id;
          replaced++;
        }
      }
      // No layer showed the frame yet: put it in the background placeholder, if there is one.
      if (!replaced) {
        const slot = backgroundSlot(p);
        if (slot) fillSlot(p, slot.id, frame);
      }
    });
    useProjectStore.getState().updateRoot((p) => {
      const x = p.thumbnails?.find((y) => y.id === id);
      if (x) {
        x.frameAssetId = frame.id;
        x.frameTime = time;
      }
    });
    return true;
  } finally {
    useProjectStore.getState().commit(tk('Change thumbnail frame'));
  }
}

/** The placeholder a design keeps for the video frame: named Background / Frame / Video, else the biggest one. */
function backgroundSlot(p: Project): ShapeClip | null {
  const slots = Object.values(p.clips).filter((c): c is ShapeClip => c.type === 'shape' && !!c.shape.slot && c.name.trim().toLowerCase() !== 'logo' && !c.cutout?.enabled);
  const named = slots.find((s) => /background|frame|video|screenshot|scene/i.test(s.name));
  if (named) return named;
  const area = (s: ShapeClip): number => s.shape.width * s.shape.height * Math.abs(s.transform.scaleX * s.transform.scaleY);
  return slots.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/**
 * Use a thumbnail design (Templates ▸ Thumbnails) for the open thumbnail: its layers replace the
 * thumbnail's, and the captured video frame goes into the design's background. One undo step.
 */
export function applyThumbnailDesign(v: TemplateVariation): ID[] {
  const id = openThumbnailId();
  const root = getRootProject();
  const th = getThumbnail(root, id);
  if (!th) return [];
  const { cw, ch } = designSize(root.settings);
  const built = buildTemplate(v, cw, ch);
  if (!built || !built.clips.length) {
    toast('error', t('This template could not be built for the current project.'));
    return [];
  }
  const frame = th.frameAssetId ? root.assets[th.frameAssetId] : undefined;
  let ids: ID[] = [];
  useProjectStore.getState().update(
    (p) => {
      for (const a of built.assets) if (!p.assets[a.id]) p.assets[a.id] = { ...a, addedAt: Date.now() };
      p.clips = {};
      p.transitions = {};
      ids = insertTemplateLayers(p, built.clips.filter((c) => c.type !== 'audio'), 0, p.settings.fps);
      if (frame) {
        const slot = backgroundSlot(p);
        if (slot) {
          const filled = fillSlot(p, slot.id, frame);
          if (filled) ids = ids.map((x) => (x === slot.id ? filled : x));
        }
      }
      pruneEmptyTracks(p);
    },
    { label: tk('Apply thumbnail design') },
  );
  const live = useProjectStore.getState().project.clips;
  useUI.getState().select(ids.filter((x) => live[x]));
  engine.seek(Math.min(built.duration * (built.def.poster ?? 0.6), Math.max(0, built.duration - 0.05)));
  return ids;
}

/** The picture of a thumbnail (the open one at the playhead). */
export async function renderThumbnail(id: ID, opts: { full?: boolean; width?: number; height?: number } = {}): Promise<HTMLCanvasElement | null> {
  if (id === openThumbnailId()) keepTime();
  const root = getRootProject();
  const th = getThumbnail(root, id);
  if (!th) return null;
  const size = opts.width && opts.height ? { width: opts.width, height: opts.height } : thumbnailSize(root.settings, opts.full);
  return renderStill(thumbnailProject(root, th), th.time, size.width, size.height);
}

export type ThumbnailFormat = 'jpg' | 'png';

/** Encode a thumbnail picture: JPEG kept under 2 MB, or PNG. */
export async function encodeThumbnail(canvas: HTMLCanvasElement, format: ThumbnailFormat): Promise<Uint8Array> {
  const blob = format === 'jpg' ? (await jpegUnder(canvas, THUMBNAIL_MAX_BYTES)).blob : await canvasBlob(canvas, 'image/png');
  if (!blob) throw new Error('The picture could not be encoded.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Write a thumbnail to `path` (no dialog). Returns the file size in bytes. */
export async function exportThumbnailTo(id: ID, path: string, opts: { format: ThumbnailFormat; full?: boolean }): Promise<number> {
  const canvas = await renderThumbnail(id, { full: opts.full });
  if (!canvas) throw new Error('No such thumbnail.');
  const data = await encodeThumbnail(canvas, opts.format);
  await api.fs.writeFile(path, data);
  return data.byteLength;
}

const safe = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Thumbnail';

/** Ask where to save a thumbnail, then export it. */
export async function exportThumbnail(id: ID, opts: { format: ThumbnailFormat; full?: boolean }): Promise<string | null> {
  const root = getRootProject();
  const th = getThumbnail(root, id);
  if (!th) return null;
  const ext = opts.format;
  const path = await api.dialog.saveFile(`${safe(root.name)} - ${safe(th.name)}.${ext}`, [ext === 'jpg' ? { name: t('JPEG picture'), extensions: ['jpg', 'jpeg'] } : { name: t('PNG picture'), extensions: ['png'] }]);
  if (!path) return null;
  try {
    const bytes = await exportThumbnailTo(id, path, opts);
    useUI.getState().toast({ kind: 'success', message: t('Thumbnail saved'), detail: `${path} · ${Math.max(1, Math.round(bytes / 1024))} KB`, action: { label: t('Show in folder'), run: () => void api.app.showItemInFolder(path) } });
    return path;
  } catch (err) {
    toast('error', t('The thumbnail could not be saved'), errorText(err));
    return null;
  }
}
