/**
 * Export queue state machine. Jobs carry a snapshot of the project, the settings and the
 * destination; they run one after another. This module is the pure part (reducer + derived
 * values), unit tested in tests/export.test.ts; `queue.ts` wraps it in a store and runs the jobs.
 *
 *   queued ──start──▶ running ──complete──▶ done
 *     │                 │  └────fail──────▶ failed ──retry──▶ queued
 *     │                 └─cancel─▶ cancelling ──cancelled──▶ cancelled ──retry──▶ queued
 *     └──────cancel─────────────────────────────────────────▶ cancelled
 *   remove / clearFinished drop jobs that are not running.
 */

import type { Project } from '@/core/types';
import type { ExportProgress, ExportSettings } from './exporter';

export type JobStatus = 'queued' | 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled';

export interface JobOutput {
  /** File (or folder, for image sequences) the job writes. */
  path: string;
  kind: 'file' | 'folder';
}

export interface JobResult {
  seconds: number;
  frames: number;
  /** Size of the output (all frames for an image sequence). */
  bytes: number;
  /** Extra files written next to the output (subtitle sidecars). */
  extraFiles: string[];
}

export interface ExportJob {
  id: string;
  /** Jobs added while the queue was idle start a new batch; total progress covers one batch. */
  batch: number;
  /** e.g. "YouTube Shorts" or "Custom". */
  label: string;
  /** e.g. "1080 × 1920 · 30 fps · H.264". */
  detail: string;
  /** e.g. "9:16". */
  aspect: string;
  output: JobOutput;
  /** Snapshot rendered by the job (already adapted to the output aspect). */
  project: Project;
  settings: ExportSettings;
  /** Relative amount of work (frames); weights the total progress. */
  weight: number;
  status: JobStatus;
  progress: ExportProgress | null;
  error?: string;
  result?: JobResult;
  attempts: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface QueueState {
  jobs: ExportJob[];
  batch: number;
}

export type QueueAction =
  | { type: 'add'; jobs: ExportJob[] }
  | { type: 'start'; id: string; at?: number }
  | { type: 'progress'; id: string; progress: ExportProgress }
  | { type: 'complete'; id: string; result: JobResult; at?: number }
  | { type: 'fail'; id: string; error: string; at?: number }
  | { type: 'cancel'; id: string; at?: number }
  | { type: 'cancelled'; id: string; at?: number }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clearFinished' };

export const EMPTY_QUEUE: QueueState = { jobs: [], batch: 0 };

export const isActive = (s: JobStatus): boolean => s === 'queued' || s === 'running' || s === 'cancelling';
export const isFinished = (s: JobStatus): boolean => s === 'done' || s === 'failed' || s === 'cancelled';

/** True while any job is queued or running. */
export const isBusy = (state: QueueState): boolean => state.jobs.some((j) => isActive(j.status));

export const runningJob = (state: QueueState): ExportJob | undefined => state.jobs.find((j) => j.status === 'running' || j.status === 'cancelling');

/** The job to start next: the oldest queued job, but only when nothing is running. */
export function nextJob(state: QueueState): ExportJob | undefined {
  if (runningJob(state)) return undefined;
  return state.jobs.find((j) => j.status === 'queued');
}

const patch = (state: QueueState, id: string, fn: (j: ExportJob) => ExportJob | null): QueueState => {
  let changed = false;
  const jobs = state.jobs.map((j) => {
    if (j.id !== id) return j;
    const next = fn(j);
    if (!next || next === j) return j;
    changed = true;
    return next;
  });
  return changed ? { ...state, jobs } : state;
};

export function reduceQueue(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      if (action.jobs.length === 0) return state;
      const batch = isBusy(state) ? state.batch : state.batch + 1;
      const fresh = action.jobs.map((j) => ({ ...j, batch, status: 'queued' as const, progress: null, error: undefined, result: undefined }));
      return { jobs: [...state.jobs, ...fresh], batch };
    }
    case 'start': {
      const next = nextJob(state);
      if (!next || next.id !== action.id) return state;
      return patch(state, action.id, (j) => ({ ...j, status: 'running', startedAt: action.at ?? Date.now(), progress: null, attempts: j.attempts + 1 }));
    }
    case 'progress':
      return patch(state, action.id, (j) => (j.status === 'running' ? { ...j, progress: action.progress } : null));
    case 'complete':
      return patch(state, action.id, (j) => (j.status === 'running' || j.status === 'cancelling' ? { ...j, status: 'done', result: action.result, finishedAt: action.at ?? Date.now(), progress: j.progress ? { ...j.progress, ratio: 1, eta: 0 } : null } : null));
    case 'fail':
      return patch(state, action.id, (j) => (j.status === 'running' || j.status === 'cancelling' ? { ...j, status: 'failed', error: action.error, finishedAt: action.at ?? Date.now() } : null));
    case 'cancel':
      return patch(state, action.id, (j) => {
        if (j.status === 'queued') return { ...j, status: 'cancelled', finishedAt: action.at ?? Date.now() };
        if (j.status === 'running') return { ...j, status: 'cancelling' };
        return null;
      });
    case 'cancelled':
      return patch(state, action.id, (j) => (j.status === 'running' || j.status === 'cancelling' ? { ...j, status: 'cancelled', finishedAt: action.at ?? Date.now() } : null));
    case 'retry': {
      const job = state.jobs.find((j) => j.id === action.id);
      if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return state;
      const batch = isBusy(state) ? state.batch : state.batch + 1;
      // A retried job goes to the back of the queue.
      const others = state.jobs.filter((j) => j.id !== action.id);
      return { batch, jobs: [...others, { ...job, batch, status: 'queued', progress: null, error: undefined, result: undefined, startedAt: undefined, finishedAt: undefined }] };
    }
    case 'remove': {
      const job = state.jobs.find((j) => j.id === action.id);
      if (!job || job.status === 'running' || job.status === 'cancelling') return state;
      return { ...state, jobs: state.jobs.filter((j) => j.id !== action.id) };
    }
    case 'clearFinished': {
      const jobs = state.jobs.filter((j) => !isFinished(j.status));
      return jobs.length === state.jobs.length ? state : { ...state, jobs };
    }
    default:
      return state;
  }
}

export interface TotalProgress {
  /** 0..1 over the current batch. */
  ratio: number;
  /** Seconds left for the whole batch (0 when unknown). */
  eta: number;
  /** Jobs of the batch that are finished / all jobs of the batch (cancelled jobs excluded). */
  finished: number;
  total: number;
  running: boolean;
}

/** Progress of the current batch, weighted by each job's amount of work. */
export function totalProgress(state: QueueState): TotalProgress {
  const jobs = state.jobs.filter((j) => j.batch === state.batch && j.status !== 'cancelled');
  let sum = 0;
  let done = 0;
  let finished = 0;
  let speed = 0; // frames per second of the running job
  let runningEta = 0;
  let pendingWeight = 0;
  let running = false;
  for (const j of jobs) {
    const w = Math.max(1, j.weight);
    sum += w;
    if (j.status === 'done' || j.status === 'failed') {
      done += w;
      finished++;
    } else if (j.status === 'running' || j.status === 'cancelling') {
      running = true;
      const r = j.progress?.ratio ?? 0;
      done += w * r;
      speed = j.progress?.speed ?? 0;
      runningEta = j.progress?.eta ?? 0;
    } else if (j.status === 'queued') {
      pendingWeight += w;
    }
  }
  const eta = running && speed > 0 ? runningEta + pendingWeight / speed : 0;
  return { ratio: sum > 0 ? Math.min(1, done / sum) : 0, eta, finished, total: jobs.length, running };
}
