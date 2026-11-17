/**
 * Media assets at runtime: importing and probing files, streaming URLs, poster thumbnails and
 * shared Mediabunny inputs. Persistent facts live in `project.assets`; everything here is
 * session state that is rebuilt when a project is opened.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } from 'mediabunny';
import { create } from 'zustand';
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS, type FileInfo } from '@shared/ipc';
import { uid } from '@/core/factory';
import type { ID, MediaAsset, Project } from '@/core/types';
import { getSound } from '@/library';
import { api } from '@/platform/api';
import { getProject, updateProject } from '@/store/project';
import { soundAssetDuration, soundBlob } from './sounds';
// Performance & media area: HDR detection and preview-source (proxy) selection.
import { isHdrColorSpace, probeHdrPipeline, setHdrInfo } from './hdr';
import { useMediaPrefs } from './prefs';

export type AssetStatus = 'loading' | 'ready' | 'missing' | 'unsupported';

export interface AssetRuntime {
  status: AssetStatus;
  /** Streamable URL (kinora://media/… or a blob URL for generated sounds). */
  url: string | null;
  /** Small poster as a data URL. */
  thumb: string | null;
  note?: string;
  /** URL of the asset's proxy once its file has been verified (see media/proxies.ts). */
  proxyUrl?: string | null;
}

interface RuntimeState {
  items: Record<ID, AssetRuntime>;
  patch: (id: ID, patch: Partial<AssetRuntime>) => void;
  reset: () => void;
}

export const useAssetRuntime = create<RuntimeState>()((set) => ({
  items: {},
  patch: (id, patch) =>
    set((s) => ({ items: { ...s.items, [id]: { ...(s.items[id] ?? { status: 'loading', url: null, thumb: null }), ...patch } } })),
  reset: () => set({ items: {} }),
}));

export const assetRuntime = (id: ID): AssetRuntime | undefined => useAssetRuntime.getState().items[id];
export const assetUrl = (id: ID): string | null => useAssetRuntime.getState().items[id]?.url ?? null;

/**
 * URL the preview should play for an asset: its proxy when "Use proxies" is on and the proxy is
 * ready, else the original. Export never calls this (it always opens the original).
 */
export function previewUrl(id: ID): string | null {
  const rt = useAssetRuntime.getState().items[id];
  if (!rt) return null;
  return (useMediaPrefs.getState().useProxies && rt.status === 'ready' && rt.proxyUrl) || rt.url;
}

// ---------------------------------------------------------------------------------------------
// Mediabunny inputs
// ---------------------------------------------------------------------------------------------

const sharedInputs = new Map<ID, Input>();
const blobs = new Map<ID, Blob>();

/** Open a fresh Mediabunny input for an asset. The caller owns it and must dispose it. */
export function openInput(asset: MediaAsset): Input {
  if (asset.source.type === 'generated') {
    const blob = blobs.get(asset.id);
    if (!blob) throw new Error(`Sound "${asset.name}" is not ready yet.`);
    return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  }
  const url = api.media.toUrl(asset.source.path);
  return new Input({ source: new UrlSource(url, { maxCacheSize: 32 * 1024 * 1024 }), formats: ALL_FORMATS });
}

/** A long-lived input shared by thumbnails, filmstrips and waveforms. */
export function sharedInput(asset: MediaAsset): Input {
  let input = sharedInputs.get(asset.id);
  if (!input || input.disposed) {
    input = openInput(asset);
    sharedInputs.set(asset.id, input);
  }
  return input;
}

/**
 * Shared input for preview visuals (filmstrips, waveforms, posters): the proxy when proxies are
 * in use and ready, else the original.
 */
export function previewInput(asset: MediaAsset): Input {
  const proxyUrl = useMediaPrefs.getState().useProxies ? useAssetRuntime.getState().items[asset.id]?.proxyUrl : null;
  if (!proxyUrl) return sharedInput(asset);
  const key = `${asset.id}#proxy`;
  let input = sharedInputs.get(key);
  if (!input || input.disposed) {
    input = new Input({ source: new UrlSource(proxyUrl, { maxCacheSize: 16 * 1024 * 1024 }), formats: ALL_FORMATS });
    sharedInputs.set(key, input);
  }
  return input;
}

function disposeInput(id: ID): void {
  for (const key of [id, `${id}#proxy`]) {
    const input = sharedInputs.get(key);
    if (input && !input.disposed) input.dispose();
    sharedInputs.delete(key);
  }
}

// ---------------------------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------------------------

export class ImportError extends Error {
  /** True when FFmpeg could convert the file into something this PC can decode. */
  convertible = false;
  /** Codec / container that could not be read, for messages. */
  codec?: string;
}

function convertibleError(message: string, codec?: string): ImportError {
  const err = new ImportError(message);
  err.convertible = true;
  err.codec = codec;
  return err;
}

function canvasToThumb(source: CanvasImageSource, sw: number, sh: number): string {
  const maxW = 320;
  const k = Math.min(1, maxW / Math.max(1, sw));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImportError('The image could not be decoded.'));
    img.src = url;
  });
}

async function videoPoster(input: Input, duration: number): Promise<string | null> {
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width: 320 });
    const first = await track.getFirstTimestamp();
    const wrapped = await sink.getCanvas(Math.max(first, Math.min(duration * 0.1, 2)));
    if (!wrapped) return null;
    return canvasToThumb(wrapped.canvas as CanvasImageSource, wrapped.canvas.width, wrapped.canvas.height);
  } catch (err) {
    console.warn('[assets] poster failed', err);
    return null;
  }
}

interface Probed {
  asset: MediaAsset;
  thumb: string | null;
}

async function probe(info: FileInfo): Promise<Probed> {
  const url = api.media.toUrl(info.path);
  const base = { id: uid('as_'), name: info.name, source: { type: 'file' as const, path: info.path }, size: info.size, addedAt: Date.now() };

  if (IMAGE_EXTS.includes(info.ext)) {
    const img = await loadImage(url);
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    return {
      asset: { ...base, kind: 'image', duration: 0, width, height, fps: 0, hasVideo: false, hasAudio: false },
      thumb: canvasToThumb(img, width, height),
    };
  }

  if (!VIDEO_EXTS.includes(info.ext) && !AUDIO_EXTS.includes(info.ext)) throw new ImportError('This file type is not supported.');

  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) {
      if (VIDEO_EXTS.includes(info.ext)) throw convertibleError('The container format could not be read.', info.ext.toUpperCase());
      throw new ImportError('The container format could not be read.');
    }
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new ImportError('No playable video or audio track was found.');
    const videoCodec = video ? await video.getCodec() : null;
    const audioCodec = audio ? await audio.getCodec() : null;
    const videoOk = video ? await video.canDecode() : false;
    const audioOk = audio ? await audio.canDecode() : false;
    const asVideo = !!video && !AUDIO_EXTS.includes(info.ext);
    if (asVideo && !videoOk) {
      throw convertibleError(`The video codec${videoCodec ? ` (${videoCodec.toUpperCase()})` : ''} cannot be decoded on this PC.`, videoCodec?.toUpperCase());
    }
    if (!asVideo && !audioOk) {
      throw new ImportError(`The audio codec${audioCodec ? ` (${audioCodec.toUpperCase()})` : ''} cannot be decoded on this PC.`);
    }
    const tracks = asVideo ? [video!, ...(audio && audioOk ? [audio] : [])] : [audio!];
    const duration = await input.computeDuration(tracks);
    if (!(duration > 0)) throw new ImportError('The file has no duration.');
    if (asVideo) {
      const width = await video!.getDisplayWidth();
      const height = await video!.getDisplayHeight();
      let fps = 30;
      try {
        const stats = await video!.computePacketStats(120);
        if (stats.averagePacketRate > 0) fps = Math.round(stats.averagePacketRate * 1000) / 1000;
      } catch {
        /* keep default */
      }
      // HDR (PQ / HLG) sources are tone-mapped by the `hdr` layer extension.
      let hdr = false;
      try {
        const cs = await video!.getColorSpace();
        hdr = (await video!.hasHighDynamicRange()) || isHdrColorSpace(cs);
        if (hdr) {
          setHdrInfo(base.id, cs);
          void probeHdrPipeline();
        }
      } catch {
        /* colour space unknown: SDR */
      }
      return {
        asset: {
          ...base,
          kind: 'video',
          duration,
          width,
          height,
          fps,
          hasVideo: true,
          hasAudio: !!audio && audioOk,
          videoCodec: videoCodec ?? undefined,
          audioCodec: audio && audioOk ? (audioCodec ?? undefined) : undefined,
          ...(hdr ? { hdr: true } : {}),
        },
        thumb: await videoPoster(input, duration),
      };
    }
    return {
      asset: { ...base, kind: 'audio', duration, width: 0, height: 0, fps: 0, hasVideo: false, hasAudio: true, audioCodec: audioCodec ?? undefined },
      thumb: null,
    };
  } finally {
    input.dispose();
  }
}

export interface ImportResult {
  assets: MediaAsset[];
  /** `convertible`: FFmpeg could turn the file into a format this PC decodes (see media/ffmpeg.ts). */
  failures: { name: string; reason: string; path?: string; convertible?: boolean }[];
}

type AssetsHook = (assets: MediaAsset[]) => void;
const importHooks = new Set<AssetsHook>();
const prepareHooks = new Set<(project: Project) => void>();

/** Run `cb` with every batch of newly imported assets (e.g. to queue proxies). */
export function onAssetsImported(cb: AssetsHook): () => void {
  importHooks.add(cb);
  return () => importHooks.delete(cb);
}

/** Run `cb` after a project's assets have been prepared (e.g. to verify proxies). */
export function onProjectAssetsPrepared(cb: (project: Project) => void): () => void {
  prepareHooks.add(cb);
  return () => prepareHooks.delete(cb);
}

export interface ImportOptions {
  /** Converted files: lower-cased converted path → original file (sets `transcodedFrom` and the name). */
  transcodedFrom?: Record<string, string>;
}

/** Probe files and add them to the current project's media bin. */
export async function importMediaFiles(files: FileInfo[], opts: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { assets: [], failures: [] };
  const existingBefore = new Set(Object.keys(getProject().assets));
  const existing = new Map<string, MediaAsset>();
  for (const a of Object.values(getProject().assets)) {
    if (a.source.type === 'file') existing.set(a.source.path.toLowerCase(), a);
  }
  for (const file of files) {
    if (!file.exists) {
      result.failures.push({ name: file.name, reason: 'The file could not be found.' });
      continue;
    }
    const dup = existing.get(file.path.toLowerCase());
    if (dup) {
      result.assets.push(dup);
      continue;
    }
    try {
      const { asset, thumb } = await probe(file);
      const original = opts.transcodedFrom?.[file.path.toLowerCase()];
      if (original) {
        asset.transcodedFrom = original;
        asset.name = original.split(/[\\/]/).pop() ?? asset.name;
      }
      useAssetRuntime.getState().patch(asset.id, { status: 'ready', url: api.media.toUrl(file.path), thumb });
      updateProject((p) => {
        p.assets[asset.id] = asset;
      });
      existing.set(file.path.toLowerCase(), asset);
      result.assets.push(asset);
    } catch (err) {
      const reason = err instanceof ImportError ? err.message : 'The file could not be read.';
      if (!(err instanceof ImportError)) console.warn('[assets] import failed', file.path, err);
      result.failures.push({ name: file.name, reason, path: file.path, convertible: err instanceof ImportError && err.convertible });
    }
  }
  const added = result.assets.filter((a) => !existingBefore.has(a.id));
  if (added.length) importHooks.forEach((cb) => cb(added));
  return result;
}

/** Add (or reuse) the generated asset for a library sound. */
export async function addSoundAsset(soundId: string): Promise<MediaAsset> {
  const def = getSound(soundId);
  if (!def) throw new Error(`Unknown sound "${soundId}"`);
  const existing = Object.values(getProject().assets).find((a) => a.source.type === 'generated' && a.source.soundId === soundId);
  if (existing) {
    await prepareAsset(existing);
    return existing;
  }
  const { blob, url, duration } = await soundBlob(soundId);
  const asset: MediaAsset = {
    id: uid('as_'),
    kind: 'audio',
    name: def.name,
    source: { type: 'generated', soundId },
    duration,
    width: 0,
    height: 0,
    fps: 0,
    hasVideo: false,
    hasAudio: true,
    size: blob.size,
    audioCodec: 'pcm-s16',
    addedAt: Date.now(),
  };
  blobs.set(asset.id, blob);
  useAssetRuntime.getState().patch(asset.id, { status: 'ready', url, thumb: null });
  updateProject((p) => {
    p.assets[asset.id] = asset;
  });
  return asset;
}

// ---------------------------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------------------------

async function prepareAsset(asset: MediaAsset): Promise<void> {
  const rt = useAssetRuntime.getState();
  const current = rt.items[asset.id];
  if (current && current.status === 'ready' && current.url) return;
  if (asset.source.type === 'generated') {
    try {
      const { blob, url } = await soundBlob(asset.source.soundId);
      blobs.set(asset.id, blob);
      rt.patch(asset.id, { status: 'ready', url, thumb: null });
    } catch {
      rt.patch(asset.id, { status: 'missing', url: null, note: 'This built-in sound is no longer available.' });
    }
    return;
  }
  const [info] = await api.fs.stat([asset.source.path]);
  if (!info || !info.exists) {
    rt.patch(asset.id, { status: 'missing', url: null, thumb: null, note: 'File not found' });
    return;
  }
  const url = api.media.toUrl(asset.source.path);
  rt.patch(asset.id, { status: 'ready', url, thumb: current?.thumb ?? null });
  if (asset.hdr) {
    setHdrInfo(asset.id, null);
    void probeHdrPipeline();
    void sharedInput(asset)
      .getPrimaryVideoTrack()
      .then(async (t) => t && setHdrInfo(asset.id, await t.getColorSpace()))
      .catch(() => undefined);
  }
  // Posters are regenerated lazily in the background.
  void (async () => {
    try {
      if (asset.kind === 'image') {
        const img = await loadImage(url);
        rt.patch(asset.id, { thumb: canvasToThumb(img, img.naturalWidth || 1, img.naturalHeight || 1) });
      } else if (asset.kind === 'video') {
        const thumb = await videoPoster(previewInput(asset), asset.duration);
        if (thumb) rt.patch(asset.id, { thumb });
      }
    } catch {
      /* poster is optional */
    }
  })();
}

/** Rebuild runtime state for every asset of a freshly loaded project. */
export async function prepareProjectAssets(project: Project): Promise<{ missing: MediaAsset[] }> {
  for (const id of [...sharedInputs.keys()]) disposeInput(id);
  useAssetRuntime.getState().reset();
  const assets = Object.values(project.assets);
  await Promise.all(assets.map((a) => prepareAsset(a).catch(() => useAssetRuntime.getState().patch(a.id, { status: 'missing', url: null }))));
  const items = useAssetRuntime.getState().items;
  prepareHooks.forEach((cb) => cb(project));
  return { missing: assets.filter((a) => items[a.id]?.status === 'missing') };
}

/** Point a missing asset at a new file. */
export async function relinkAsset(assetId: ID, file: FileInfo): Promise<void> {
  const asset = getProject().assets[assetId];
  if (!asset) return;
  const { asset: probed, thumb } = await probe(file);
  if (probed.kind !== asset.kind) throw new ImportError(`Expected ${asset.kind === 'image' ? 'an image' : asset.kind === 'audio' ? 'an audio file' : 'a video'}.`);
  disposeInput(assetId);
  updateProject((p) => {
    p.assets[assetId] = { ...probed, id: assetId, name: probed.name, addedAt: asset.addedAt };
  });
  useAssetRuntime.getState().patch(assetId, { status: 'ready', url: api.media.toUrl(file.path), thumb, note: undefined });
}

/** Remove an asset and every clip that uses it. */
export function removeAsset(assetId: ID): void {
  disposeInput(assetId);
  updateProject((p) => {
    for (const clip of Object.values(p.clips)) {
      if ((clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') && clip.assetId === assetId) delete p.clips[clip.id];
    }
    for (const tr of Object.values(p.transitions)) {
      if (!p.clips[tr.fromId] || !p.clips[tr.toId]) delete p.transitions[tr.id];
    }
    delete p.assets[assetId];
  });
}

// ---------------------------------------------------------------------------------------------
// Still images for the compositor
// ---------------------------------------------------------------------------------------------

interface ImageEntry {
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  version: number;
  loading: boolean;
}

const images = new Map<ID, ImageEntry>();
const imageListeners = new Set<() => void>();
let imageVersion = 1;
const MAX_IMAGE_EDGE = 4096;

export function onImageLoaded(cb: () => void): () => void {
  imageListeners.add(cb);
  return () => imageListeners.delete(cb);
}

/** Decoded bitmap for an image asset, or null while it loads (listeners fire when ready). */
export function getImage(assetId: ID): ImageEntry | null {
  let entry = images.get(assetId);
  if (entry) return entry.bitmap ? entry : null;
  const url = assetUrl(assetId);
  if (!url) return null;
  entry = { bitmap: null, width: 0, height: 0, version: imageVersion++, loading: true };
  images.set(assetId, entry);
  const e = entry;
  void loadImageBitmap(url)
    .then((bitmap) => {
      e.bitmap = bitmap;
      e.width = bitmap.width;
      e.height = bitmap.height;
      e.loading = false;
      imageListeners.forEach((cb) => cb());
    })
    .catch((err) => {
      console.warn('[assets] image load failed', err);
      images.delete(assetId);
    });
  return null;
}

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const img = await loadImage(url);
  const w = img.naturalWidth || 1024;
  const h = img.naturalHeight || 1024;
  const k = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
  return createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'high', premultiplyAlpha: 'premultiply' });
}

/** Wait until every image used by the project is decoded (used before exporting). */
export async function preloadImages(assetIds: ID[]): Promise<void> {
  await Promise.all(
    assetIds.map(async (id) => {
      const existing = images.get(id);
      if (existing?.bitmap) return;
      const url = assetUrl(id);
      if (!url) return;
      try {
        const bitmap = await loadImageBitmap(url);
        images.set(id, { bitmap, width: bitmap.width, height: bitmap.height, version: imageVersion++, loading: false });
      } catch {
        /* missing images render as nothing */
      }
    }),
  );
}

export function forgetImage(assetId: ID): void {
  const e = images.get(assetId);
  e?.bitmap?.close();
  images.delete(assetId);
}

export { soundAssetDuration };
