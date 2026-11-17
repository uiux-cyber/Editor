/**
 * Auto-reframe: subject analysis per asset (faces → objects → saliency → centre, sampled at
 * 5 fps in the vision worker), smoothed into an eased virtual-camera path and exposed to
 * `reframeProject` through the shared focus provider. The Auto-reframe tool analyses every
 * media clip of the project, builds a reframed copy for the chosen aspect and opens it as a new,
 * unsaved project. The export engineer's multi-aspect export reads the same provider.
 */

import { uid } from '@/core/factory';
import { reframeProject, setFocusProvider, type FocusPoint } from '@/core/reframe';
import type { ImageClip, MediaAsset, Project, VideoClip } from '@/core/types';
import { assetUrl } from '@/engine/media/assets';
import { getProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { confirmDiscard } from '@/ui/projectIO';
import { evalCamera, smoothCameraPath, type CameraKey } from './algo/camera';
import { visionRequest } from './client';
import type { FocusAnalysis, MediaRef } from './protocol';
import { runJob } from './store';

export const ASPECTS = [
  { id: '9:16', w: 9, h: 16, label: '9:16', hint: 'Shorts, Reels, TikTok' },
  { id: '1:1', w: 1, h: 1, label: '1:1', hint: 'Square feed' },
  { id: '4:5', w: 4, h: 5, label: '4:5', hint: 'Portrait feed' },
  { id: '16:9', w: 16, h: 9, label: '16:9', hint: 'YouTube, landscape' },
] as const;
export type AspectId = (typeof ASPECTS)[number]['id'];

export interface FocusTrack {
  /** Camera keys in source time. */
  keys: CameraKey[];
  samples: FocusAnalysis['samples'];
  /** Share of samples per detector. */
  sources: Record<string, number>;
  ms: number;
}

const analyses = new Map<string, FocusTrack>();
const listeners = new Set<() => void>();

/** Cache key that survives re-opening the same file in another project. */
export function assetKey(asset: MediaAsset): string {
  const src = asset.source.type === 'file' ? asset.source.path.toLowerCase() : `gen:${asset.id}`;
  return `${src}|${asset.size}|${asset.duration.toFixed(3)}`;
}

export const focusTrack = (asset: MediaAsset): FocusTrack | undefined => analyses.get(assetKey(asset));
export const onFocusChanged = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function mediaRef(asset: MediaAsset): MediaRef {
  const url = assetUrl(asset.id);
  if (!url) throw new Error(`“${asset.name}” is offline. Relink it first.`);
  return { url, kind: asset.kind === 'image' ? 'image' : 'video' };
}

/** Analyse (or return the cached analysis of) an asset. */
export async function analyseFocus(asset: MediaAsset, opts: { signal?: AbortSignal; onProgress?: (v: number, label?: string) => void } = {}): Promise<FocusTrack> {
  const cached = focusTrack(asset);
  if (cached) return cached;
  const res = await visionRequest<FocusAnalysis>(
    { type: 'focus', media: mediaRef(asset), fps: 5, start: 0, end: asset.kind === 'image' ? 0 : asset.duration },
    { signal: opts.signal, onProgress: opts.onProgress },
  );
  const sources: Record<string, number> = {};
  for (const s of res.samples) sources[s.kind] = (sources[s.kind] ?? 0) + 1 / Math.max(1, res.samples.length);
  const track: FocusTrack = { keys: smoothCameraPath(res.samples), samples: res.samples, sources, ms: res.ms };
  analyses.set(assetKey(asset), track);
  listeners.forEach((cb) => cb());
  return track;
}

/** Focus points of a clip in clip-local time (null when its asset was not analysed). */
export function clipFocus(clip: VideoClip | ImageClip, project: Project): FocusPoint[] | null {
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  const track = focusTrack(asset);
  if (!track || !track.keys.length) return null;
  if (clip.type === 'image') {
    const k = track.keys[0];
    return [{ t: 0, x: k.x, y: k.y }];
  }
  const speed = clip.speed || 1;
  const s0 = clip.trimIn;
  const s1 = clip.trimIn + clip.duration * speed;
  const out: FocusPoint[] = [];
  const at = (s: number): FocusPoint => {
    const p = evalCamera(track.keys, s);
    return { t: Math.min(clip.duration, Math.max(0, (s - s0) / speed)), x: p.x, y: p.y };
  };
  // Ease of the key segment that contains `s` (used for the boundary points).
  const easeAt = (s: number): FocusPoint['ease'] => {
    let e: FocusPoint['ease'] = 'linear';
    for (const k of track.keys) if (k.t <= s) e = k.ease;
    return e;
  };
  out.push({ ...at(s0), ease: easeAt(s0) });
  for (const k of track.keys) {
    if (k.t <= s0 + 1e-6 || k.t >= s1 - 1e-6) continue;
    out.push({ t: (k.t - s0) / speed, x: k.x, y: k.y, ease: k.ease });
  }
  out.push({ ...at(s1), ease: 'linear' });
  return out;
}

// Steer every reframe (auto-reframe tool, multi-aspect export) with the cached analyses.
setFocusProvider(clipFocus);

/** Output size for an aspect, keeping the project's short side. */
export function aspectSize(project: Project, aspect: AspectId): { width: number; height: number } {
  const def = ASPECTS.find((a) => a.id === aspect)!;
  const short = Math.min(project.settings.width, project.settings.height);
  const even = (v: number): number => Math.max(16, Math.round(v / 2) * 2);
  return def.w >= def.h ? { width: even((short * def.w) / def.h), height: even(short) } : { width: even(short), height: even((short * def.h) / def.w) };
}

/** Assets the reframe should analyse: media that fills the frame in some clip. */
export function reframeAssets(project: Project): MediaAsset[] {
  const ids = new Set<string>();
  for (const c of Object.values(project.clips)) if ((c.type === 'video' || c.type === 'image') && project.assets[c.assetId]) ids.add(c.assetId);
  return [...ids].map((id) => project.assets[id]).filter((a) => a.width > 0 && a.height > 0);
}

/**
 * Analyse every media asset of a project that has no cached analysis yet (progress 0..1).
 * After this, `reframeProject` (auto-reframe, multi-aspect export) pans to the subjects.
 */
export async function analyseProjectFocus(project: Project, opts: { signal?: AbortSignal; onProgress?: (v: number, label?: string) => void } = {}): Promise<void> {
  const todo = reframeAssets(project).filter((a) => !focusTrack(a));
  const totalSeconds = todo.reduce((s, a) => s + Math.max(0.2, a.duration), 0) || 1;
  let done = 0;
  for (const a of todo) {
    const weight = Math.max(0.2, a.duration) / totalSeconds;
    await analyseFocus(a, { signal: opts.signal, onProgress: (v) => opts.onProgress?.(done + v * weight, `Analysing “${a.name}”`) });
    done += weight;
  }
  opts.onProgress?.(1);
}

/**
 * Analyse the project's media (with progress), build the reframed copy and open it as a new,
 * unsaved project. Returns the new project, or null when cancelled / failed.
 */
export async function autoReframe(aspect: AspectId): Promise<Project | null> {
  const source = getProject();
  const ok = await runJob('reframe', 'reframe', `Auto-reframe ${aspect}`, async (job) => {
    await analyseProjectFocus(source, { signal: job.signal, onProgress: (v, l) => job.progress(v, l ?? 'Building the reframed copy') });
    return true;
  });
  if (!ok) return null;
  const { width, height } = aspectSize(source, aspect);
  const copy = reframeProject(source, width, height);
  copy.id = uid('pr_');
  copy.name = `${source.name} (${aspect})`;
  copy.createdAt = copy.updatedAt = Date.now();
  if (!(await confirmDiscard())) return null;
  useProjectStore.getState().load(copy, null, false);
  useUI.getState().set({ screen: 'editor', selection: [], selectedTransition: null, modal: null });
  useUI.getState().toast({ kind: 'success', message: `Reframed copy for ${aspect} opened`, detail: 'It is a new, unsaved project — save it to keep it. The original file is unchanged.' });
  return copy;
}

/** Forget cached analyses (settings). */
export function clearFocusCache(): void {
  analyses.clear();
  listeners.forEach((cb) => cb());
}
