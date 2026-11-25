/**
 * Render-cache keys (pure). The timeline is cut into fixed segments of about one second; each
 * segment's key hashes everything that affects its pixels — the composition settings and
 * render size, and for every frame the ordered scene items (each clip / transition with all its
 * properties and the media facts of the files it shows). Editing a clip therefore invalidates
 * exactly the segments in which that clip is visible; selection, playhead, proxies or edits
 * elsewhere leave keys untouched. Unit-tested in tests/media.test.ts.
 */

import { getSceneItems } from '@/core/scene';
import type { Clip, ID, MediaAsset, Project, Transition, VisualClip } from '@/core/types';
import { hashString } from '@shared/media';

/** Bump when the cached file format or the key recipe changes. */
export const CACHE_FORMAT = 1;

export interface CacheSize {
  width: number;
  height: number;
}

export interface KeyContext {
  size: CacheSize;
  /** Anything global that changes rendering (app version, HDR pipeline mode…). */
  salt?: string;
}

export interface Segment {
  index: number;
  /** Timeline seconds. */
  start: number;
  end: number;
  firstFrame: number;
  frames: number;
  /** null when nothing is visible (background only — never worth caching). */
  key: string | null;
  /** Heuristic rendering cost of the heaviest frame (see frameCost). */
  cost: number;
}

/** Frames per segment: one second of material. */
export const segmentFrames = (fps: number): number => Math.max(1, Math.round(fps));

/** Render size of cached frames: the preview quality applied to the project, at most 1080p-class. */
export function cacheRenderSize(projectW: number, projectH: number, previewQuality: number): CacheSize {
  const even = (v: number): number => Math.max(16, Math.round(v / 2) * 2);
  const k = Math.min(1, Math.max(0.1, previewQuality), 1920 / Math.max(projectW, projectH, 1));
  return { width: even(projectW * k), height: even(projectH * k) };
}

/** JSON with sorted object keys, so equal values always serialise identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Facts of a media file that change its pixels (not the proxy, which only feeds the preview). */
function assetFacts(asset: MediaAsset | undefined): string {
  if (!asset) return 'missing';
  const s = asset.source;
  const src = s.type === 'file' ? s.path.toLowerCase() : s.type === 'generated' ? `gen:${s.soundId}` : `motion:${hashString(s.code)}:${hashString(JSON.stringify(s.meta))}`;
  return `${asset.id}|${src}|${asset.size}|${asset.width}x${asset.height}|${asset.duration}|${asset.fps}|${asset.hdr ? 'hdr' : 'sdr'}`;
}

function collectAssetIds(clip: Clip, out: Set<ID>): void {
  if ('assetId' in clip && typeof clip.assetId === 'string') out.add(clip.assetId);
  if (clip.type === 'compound') for (const c of Object.values(clip.sequence.clips)) collectAssetIds(c, out);
}

// Clip / transition hashes are memoised per immutable object (immer keeps unchanged objects).
// A clip's entry also remembers the media facts it was hashed with: relinking a file changes
// the asset but not the clip object.
const clipHashes = new WeakMap<object, string>();
const clipEntries = new WeakMap<object, { json: string; ids: ID[]; facts: string; hash: string }>();

function clipHash(clip: Clip, project: Project): string {
  let e = clipEntries.get(clip);
  if (!e) {
    const ids = new Set<ID>();
    collectAssetIds(clip, ids);
    e = { json: hashString(stableStringify(clip)), ids: [...ids].sort(), facts: '', hash: '' };
    clipEntries.set(clip, e);
  }
  const facts = e.ids.map((id) => assetFacts(project.assets[id])).join(';');
  if (facts !== e.facts || !e.hash) {
    e.facts = facts;
    e.hash = hashString(`${e.json}#${facts}`);
  }
  return e.hash;
}

function transitionHash(tr: Transition): string {
  let h = clipHashes.get(tr);
  if (h === undefined) {
    h = hashString(stableStringify(tr));
    clipHashes.set(tr, h);
  }
  return h;
}

/** Ordered signature of what is drawn at one instant ('' = nothing). */
export function frameSignature(project: Project, time: number): string {
  let sig = '';
  for (const item of getSceneItems(project, time)) {
    if (item.kind === 'layer') sig += `L${clipHash(item.layer.clip, project)};`;
    else sig += `T${transitionHash(item.transition)}:${clipHash(item.from.clip, project)}:${clipHash(item.to.clip, project)};`;
  }
  return sig;
}

/**
 * Heuristic cost of rendering one frame (≈ full-frame GPU passes + decoders). Frames above
 * HEAVY_COST are flagged "needs render" before anyone has played them.
 */
export function frameCost(project: Project, time: number, proxied: (assetId: ID) => boolean = () => false): number {
  let cost = 0;
  const layer = (clip: VisualClip): number => {
    let c = 1;
    if (clip.type === 'video') {
      c += 1;
      const a = project.assets[clip.assetId];
      if (a && Math.min(a.width, a.height) >= 1440 && !proxied(a.id)) c += 2.5;
      if (a?.hdr) c += 0.5;
    }
    if (clip.type === 'generator') c += 1.5;
    if (clip.type === 'adjustment') c += 2;
    const fx = clip.effects.filter((e) => e.enabled).length;
    c += fx * 2.5;
    if (fx > 0 || clip.blendMode !== 'normal') c += 1;
    if (clip.mask || clip.chromaKey?.enabled) c += 0.5;
    if (clip.adjust || clip.filter) c += 0.3;
    return c;
  };
  for (const item of getSceneItems(project, time)) {
    if (item.kind === 'layer') cost += layer(item.layer.clip);
    else cost += 3 + layer(item.from.clip) + layer(item.to.clip);
  }
  return cost;
}

export const HEAVY_COST = 9;

/** Segments of the whole timeline with their keys. */
export function computeSegments(project: Project, ctx: KeyContext, duration: number, proxied?: (assetId: ID) => boolean): Segment[] {
  const fps = Math.max(1, project.settings.fps);
  const per = segmentFrames(fps);
  const totalFrames = Math.ceil(duration * fps - 1e-6);
  const base = `v${CACHE_FORMAT}|${ctx.salt ?? ''}|${ctx.size.width}x${ctx.size.height}|${fps}|${project.settings.width}x${project.settings.height}|${project.settings.background}|${per}`;
  const out: Segment[] = [];
  for (let index = 0, first = 0; first < totalFrames; index++, first += per) {
    const frames = Math.min(per, totalFrames - first);
    let sig = '';
    let prev = '';
    let any = false;
    let cost = 0;
    for (let f = 0; f < frames; f++) {
      const t = (first + f) / fps;
      const s = frameSignature(project, t);
      if (s) any = true;
      // Consecutive identical frames add nothing: the clip data already pins where changes happen.
      if (s !== prev) sig += `|${f}:${s}`;
      prev = s;
      if (f % 6 === 0 || f === frames - 1) cost = Math.max(cost, frameCost(project, t, proxied));
    }
    out.push({
      index,
      start: first / fps,
      end: (first + frames) / fps,
      firstFrame: first,
      frames,
      key: any ? hashString(`${base}|${first}|${frames}${sig}`) + hashString(sig, 7).slice(0, 6) : null,
      cost,
    });
  }
  return out;
}
