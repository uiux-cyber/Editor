/**
 * Session state of the vision features: running jobs (progress / cancel), analysis results the
 * UI shows (scene lists, colour-match previews, track paths) and the box-drawing mode of the
 * motion tracker. Nothing here is persisted — project changes go through `updateProject`.
 */

import { create } from 'zustand';
import type { ID, Grade } from '@/core/types';
import type { SceneCut } from './algo/scenes';
import { isCancelled } from './client';
import { toast } from '@/store/ui';

export type JobKind = 'reframe' | 'scenes' | 'color' | 'track' | 'cutout';

export interface VisionJob {
  key: string;
  kind: JobKind;
  label: string;
  /** 0..1, or -1 while indeterminate. */
  progress: number;
  detail?: string;
  clipId?: ID;
  cancel: () => void;
}

export interface SceneState {
  clipId: ID;
  assetId: ID;
  /** Source range analysed. */
  start: number;
  end: number;
  stats: { t: number; hist: number; edge: number; luma: number }[];
  sensitivity: number;
  minShot: number;
  /** Cuts (source times) the user unticked. */
  excluded: number[];
  /** Object URLs of thumbnails keyed by source time (rounded to ms). */
  thumbs: Record<string, string>;
  ms: number;
  cuts: SceneCut[];
}

export interface ColorMatchState {
  clipId: ID;
  referenceId: ID;
  previous: Partial<Grade> | undefined;
  applied: Partial<Grade>;
  previews: { w: number; h: number; reference: string; before: string; after: string };
  distanceBefore: number;
  distanceAfter: number;
  ms: number;
}

export interface TrackPoint {
  /** Timeline time. */
  T: number;
  /** Follower position (design px from the centre). */
  x: number;
  y: number;
  conf: number;
}

export interface TrackState {
  followerId: ID;
  videoId: ID;
  points: TrackPoint[];
  keyframes: number;
  frames: number;
  ms: number;
}

/** Box drawn on the preview, in design px (centre + size). */
export interface DesignBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface CutoutStatus {
  state: 'loading' | 'ready' | 'error';
  ms?: number;
  delegate?: string;
  message?: string;
}

export interface VisionState {
  jobs: Record<string, VisionJob>;
  scenes: Record<ID, SceneState>;
  color: Record<ID, ColorMatchState>;
  tracks: Record<ID, TrackState>;
  /** Box-drawing mode for the tracker. */
  draw: { followerId: ID; videoId: ID; box: DesignBox | null; active: boolean } | null;
  cutout: Record<ID, CutoutStatus>;
  set: (patch: Partial<Omit<VisionState, 'set'>>) => void;
}

export const useVision = create<VisionState>()((set) => ({
  jobs: {},
  scenes: {},
  color: {},
  tracks: {},
  draw: null,
  cutout: {},
  set: (patch) => set(patch),
}));

export const visionState = (): VisionState => useVision.getState();

export function patchScene(clipId: ID, patch: Partial<SceneState>): void {
  const cur = useVision.getState().scenes[clipId];
  if (!cur) return;
  useVision.setState((s) => ({ scenes: { ...s.scenes, [clipId]: { ...cur, ...patch } } }));
}

export interface JobHandle {
  signal: AbortSignal;
  progress: (value: number, detail?: string) => void;
}

/**
 * Run a cancellable job with progress shown in the UI. Errors are reported as toasts; returns
 * null when the job failed or was cancelled. A job with the same key is cancelled first.
 */
export async function runJob<T>(key: string, kind: JobKind, label: string, fn: (job: JobHandle) => Promise<T>, clipId?: ID): Promise<T | null> {
  useVision.getState().jobs[key]?.cancel();
  const ctrl = new AbortController();
  const job: VisionJob = { key, kind, label, progress: -1, clipId, cancel: () => ctrl.abort() };
  useVision.setState((s) => ({ jobs: { ...s.jobs, [key]: job } }));
  let last = 0;
  const progress = (value: number, detail?: string): void => {
    const now = performance.now();
    const cur = useVision.getState().jobs[key];
    if (!cur || cur.cancel !== job.cancel) return;
    if (now - last < 80 && value < 1 && detail === cur.detail) return;
    last = now;
    useVision.setState((s) => ({ jobs: { ...s.jobs, [key]: { ...cur, progress: value, detail: detail ?? cur.detail } } }));
  };
  try {
    return await fn({ signal: ctrl.signal, progress });
  } catch (err) {
    if (!isCancelled(err) && !ctrl.signal.aborted) {
      console.warn(`[vision] ${label} failed`, err);
      toast('error', `${label} failed`, (err as Error)?.message ?? String(err));
    }
    return null;
  } finally {
    useVision.setState((s) => {
      if (s.jobs[key]?.cancel !== job.cancel) return s;
      const jobs = { ...s.jobs };
      delete jobs[key];
      return { jobs };
    });
  }
}
