/**
 * Pictures that template thumbnails need besides the built-in demo images: brand logos and media
 * embedded in user templates. They are decoded once into bitmaps and served to the thumbnail
 * compositor (see `extraThumbImage` in ui/library/thumbs.tsx).
 */

import type { FrameImage } from '@/engine/compositor';
import type { ID, MediaAsset } from '@/core/types';
import { loadImageBitmap } from '@/engine/media/assets';
import { api } from '@/platform/api';

interface Entry {
  image: FrameImage | null;
  promise: Promise<void>;
}

const entries = new Map<ID, Entry>();
let version = 1;

/** A still for a video file: the frame at ~0.1 s, drawn through a <video> element. */
function videoStill(url: string): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    const fail = (): void => reject(new Error('video still failed'));
    v.onerror = fail;
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      createImageBitmap(v).then(resolve, fail);
      v.removeAttribute('src');
      v.load();
    };
    v.src = url;
  });
}

/** Decode the picture of an asset for thumbnails. Resolves when ready (or failed). */
export function ensureThumbImage(asset: MediaAsset): Promise<void> {
  const existing = entries.get(asset.id);
  if (existing) return existing.promise;
  const entry: Entry = { image: null, promise: Promise.resolve() };
  entries.set(asset.id, entry);
  if (asset.source.type !== 'file' || (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'animation')) return entry.promise;
  const url = api.media.toUrl(asset.source.path);
  entry.promise = (asset.kind === 'video' ? videoStill(url) : loadImageBitmap(url))
    .then((bitmap) => {
      entry.image = { source: bitmap, width: bitmap.width, height: bitmap.height, version: version++ };
    })
    .catch(() => {
      /* thumbnails simply omit pictures that cannot be decoded */
    });
  return entry.promise;
}

/** Decode several assets; never rejects and never waits longer than `timeoutMs`. */
export function ensureThumbImages(assets: MediaAsset[], timeoutMs = 4000): Promise<void> {
  return Promise.race([Promise.all(assets.map(ensureThumbImage)).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/** The decoded picture of an asset, if ready. */
export const thumbImage = (assetId: ID): FrameImage | null => entries.get(assetId)?.image ?? null;

/** Forget a picture (e.g. a removed logo). */
export function forgetThumbImage(assetId: ID): void {
  const e = entries.get(assetId);
  const src = e?.image?.source;
  if (src && 'close' in (src as ImageBitmap)) (src as ImageBitmap).close();
  entries.delete(assetId);
}
