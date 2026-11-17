/**
 * Scene detection: analyse a video clip's visible source range in the worker (histogram + edge
 * differences of every frame at 96 px), threshold adaptively on the main thread (instant when
 * the sensitivity changes), show the shots with thumbnails, and split the clip at the chosen
 * cuts in one undo step.
 */

import { splitClipAt } from '@/core/project';
import { snapToFrame } from '@/core/time';
import type { ID, Project, VideoClip } from '@/core/types';
import { getProject, updateProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { detectCuts, type SceneCut } from './algo/scenes';
import { visionRequest } from './client';
import type { SceneAnalysis } from './protocol';
import { mediaRef } from './reframe';
import { patchScene, runJob, useVision, type SceneState } from './store';

const statsCache = new Map<string, SceneAnalysis>();
const thumbCache = new Map<string, string>();

export const sourceRange = (clip: VideoClip): { start: number; end: number } => ({ start: clip.trimIn, end: clip.trimIn + clip.duration * (clip.speed || 1) });
/** Timeline time of a source time inside a clip. */
export const timelineTime = (clip: VideoClip, sourceTime: number): number => clip.start + (sourceTime - clip.trimIn) / (clip.speed || 1);
const tkey = (t: number): string => t.toFixed(3);

/** Cuts for the current settings (excluding none). */
export function computeCuts(state: Pick<SceneState, 'stats' | 'sensitivity' | 'minShot'>): SceneCut[] {
  return detectCuts(state.stats, { sensitivity: state.sensitivity, minShot: state.minShot });
}

/** Run scene detection on a video clip; results land in the vision store. */
export async function detectScenes(clipId: ID, opts: { sensitivity?: number; minShot?: number } = {}): Promise<SceneState | null> {
  const project = getProject();
  const clip = project.clips[clipId];
  if (!clip || clip.type !== 'video') {
    useUI.getState().toast({ kind: 'info', message: 'Select a video clip to detect its scenes' });
    return null;
  }
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  const { start, end } = sourceRange(clip);
  const key = `${asset.id}|${start.toFixed(3)}|${end.toFixed(3)}`;
  const analysis =
    statsCache.get(key) ??
    (await runJob(
      `scenes:${clipId}`,
      'scenes',
      'Scene detection',
      async (job) => {
        const res = await visionRequest<SceneAnalysis>({ type: 'scenes', media: mediaRef(asset), start, end, width: 96 }, { signal: job.signal, onProgress: (v, l) => job.progress(v, l) });
        statsCache.set(key, res);
        return res;
      },
      clipId,
    ));
  if (!analysis) return null;
  const prev = useVision.getState().scenes[clipId];
  const state: SceneState = {
    clipId,
    assetId: asset.id,
    start,
    end,
    stats: analysis.stats,
    sensitivity: opts.sensitivity ?? prev?.sensitivity ?? 0.5,
    minShot: opts.minShot ?? prev?.minShot ?? 0.6,
    excluded: [],
    thumbs: prev?.assetId === asset.id ? prev.thumbs : {},
    ms: analysis.ms,
    cuts: [],
  };
  state.cuts = computeCuts(state);
  useVision.setState((s) => ({ scenes: { ...s.scenes, [clipId]: state } }));
  void loadThumbs(clipId);
  return state;
}

/** Change the sensitivity / minimum shot length and re-threshold. */
export function retune(clipId: ID, patch: { sensitivity?: number; minShot?: number }): void {
  const cur = useVision.getState().scenes[clipId];
  if (!cur) return;
  const next = { ...cur, ...patch };
  patchScene(clipId, { ...patch, cuts: computeCuts(next), excluded: [] });
  void loadThumbs(clipId);
}

export function toggleCut(clipId: ID, t: number, on: boolean): void {
  const cur = useVision.getState().scenes[clipId];
  if (!cur) return;
  const excluded = cur.excluded.filter((x) => Math.abs(x - t) > 1e-6);
  if (!on) excluded.push(t);
  patchScene(clipId, { excluded });
}

/** First frame of each shot (clip start + every cut). */
export function shotStarts(state: SceneState): number[] {
  return [state.start, ...state.cuts.map((c) => c.t)];
}

async function loadThumbs(clipId: ID): Promise<void> {
  const state = useVision.getState().scenes[clipId];
  const project = getProject();
  const asset = state && project.assets[state.assetId];
  if (!state || !asset) return;
  // A frame just inside each shot reads better than the exact cut frame.
  const want = shotStarts(state)
    .map((t) => Math.min(state.end - 0.01, t + 0.05))
    .filter((t) => !state.thumbs[tkey(t)] && !thumbCache.has(`${asset.id}|${tkey(t)}`));
  const known: Record<string, string> = { ...state.thumbs };
  for (const t of shotStarts(state).map((x) => Math.min(state.end - 0.01, x + 0.05))) {
    const hit = thumbCache.get(`${asset.id}|${tkey(t)}`);
    if (hit) known[tkey(t)] = hit;
  }
  if (want.length) {
    try {
      const blobs = await visionRequest<Blob[]>({ type: 'thumbs', media: mediaRef(asset), times: want, width: 160 });
      blobs.forEach((b, i) => {
        if (!b.size) return;
        const url = URL.createObjectURL(b);
        thumbCache.set(`${asset.id}|${tkey(want[i])}`, url);
        known[tkey(want[i])] = url;
      });
    } catch (err) {
      console.warn('[vision] thumbnails failed', err);
    }
  }
  patchScene(clipId, { thumbs: known });
}

export const thumbFor = (state: SceneState, shotStart: number): string | undefined => state.thumbs[tkey(Math.min(state.end - 0.01, shotStart + 0.05))];

/** Cuts that are ticked and fall inside the clip as it is now. */
export function selectedCuts(state: SceneState, project: Project = getProject()): number[] {
  const clip = project.clips[state.clipId];
  if (!clip || clip.type !== 'video') return [];
  const { start, end } = sourceRange(clip);
  return state.cuts.map((c) => c.t).filter((t) => t > start + 1e-6 && t < end - 1e-6 && !state.excluded.some((x) => Math.abs(x - t) < 1e-6));
}

/** Split the clip at the given source times (one undo step). Returns the ids of every piece. */
export function splitAtCuts(clipId: ID, sourceTimes: number[]): ID[] {
  const project = getProject();
  const clip = project.clips[clipId];
  if (!clip || clip.type !== 'video') return [];
  const fps = project.settings.fps;
  const times = [...new Set(sourceTimes.map((s) => snapToFrame(timelineTime(clip, s), fps)))].sort((a, b) => a - b);
  const pieces: ID[] = [clipId];
  updateProject((p) => {
    let current = clipId;
    for (const T of times) {
      // Linked clips (e.g. detached audio) are split together so they stay in sync.
      const linked = clip.linkId ? Object.values(p.clips).filter((c) => c.linkId === clip.linkId && c.id !== current && T > c.start && T < c.start + c.duration) : [];
      const right = splitClipAt(p, current, T, fps);
      if (!right) continue;
      for (const l of linked) splitClipAt(p, l.id, T, fps);
      pieces.push(right);
      current = right;
    }
  });
  const alive = pieces.filter((id) => getProject().clips[id]);
  if (alive.length > 1) {
    useUI.getState().select(alive);
    useUI.getState().toast({ kind: 'success', message: `Split into ${alive.length} clips`, detail: 'Press Ctrl+Z to undo.' });
  }
  useVision.setState((s) => {
    const scenes = { ...s.scenes };
    delete scenes[clipId];
    return { scenes };
  });
  return alive;
}
