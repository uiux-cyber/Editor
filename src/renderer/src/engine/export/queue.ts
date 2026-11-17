/**
 * Background export queue. Jobs (project snapshot + settings + destination) run one after
 * another while the editor stays usable; progress drives the title-bar indicator and the
 * Windows taskbar. The state machine lives in `queueState.ts`.
 */

import { create } from 'zustand';
import { uid } from '@/core/factory';
import { engine } from '@/engine/engine';
import { api } from '@/platform/api';
import { useUI } from '@/store/ui';
import { ExportCancelled, exportProject } from './exporter';
import { EMPTY_QUEUE, isBusy, nextJob, reduceQueue, totalProgress, type ExportJob, type JobResult, type QueueAction, type QueueState } from './queueState';

export type PreviewMode = 'live' | 'paused';

interface QueueStore extends QueueState {
  /** While jobs run: keep the live preview interactive, or pause it for faster exports. */
  previewMode: PreviewMode;
  /** Job ids an open dialog is following (their completion is shown there instead of a toast). */
  watched: string[];
  dispatch: (action: QueueAction) => void;
}

export const useExportQueue = create<QueueStore>()((set, get) => ({
  ...EMPTY_QUEUE,
  previewMode: 'live',
  watched: [],
  dispatch: (action) => {
    const s = get();
    const next = reduceQueue({ jobs: s.jobs, batch: s.batch }, action);
    if (next.jobs !== s.jobs || next.batch !== s.batch) set(next);
  },
}));

const dispatch = (action: QueueAction): void => useExportQueue.getState().dispatch(action);

/** Live canvases of running jobs (not stored in state: DOM objects). */
const canvases = new Map<string, HTMLCanvasElement>();
const controllers = new Map<string, AbortController>();

export const jobCanvas = (id: string): HTMLCanvasElement | null => canvases.get(id) ?? null;

export type NewJob = Omit<ExportJob, 'id' | 'batch' | 'status' | 'progress' | 'attempts' | 'createdAt'>;

/** Add jobs to the queue; they start right away when the queue is idle. Returns their ids. */
export function enqueue(jobs: NewJob[], opts: { watch?: boolean } = {}): string[] {
  const now = Date.now();
  const full: ExportJob[] = jobs.map((j) => ({ ...j, id: uid('job_'), batch: 0, status: 'queued', progress: null, attempts: 0, createdAt: now }));
  dispatch({ type: 'add', jobs: full });
  const ids = full.map((j) => j.id);
  if (opts.watch) watch(ids);
  void pump();
  return ids;
}

export function watch(ids: string[]): void {
  useExportQueue.setState((s) => ({ watched: [...new Set([...s.watched, ...ids])] }));
}

export function unwatch(ids: string[]): void {
  const drop = new Set(ids);
  useExportQueue.setState((s) => ({ watched: s.watched.filter((id) => !drop.has(id)) }));
}

export function cancelJob(id: string): void {
  dispatch({ type: 'cancel', id });
  controllers.get(id)?.abort();
}

export function cancelAll(): void {
  for (const j of useExportQueue.getState().jobs) if (j.status === 'queued' || j.status === 'running') cancelJob(j.id);
}

export function retryJob(id: string): void {
  dispatch({ type: 'retry', id });
  void pump();
}

export const removeJob = (id: string): void => dispatch({ type: 'remove', id });
export const clearFinished = (): void => dispatch({ type: 'clearFinished' });

export function setPreviewMode(mode: PreviewMode): void {
  useExportQueue.setState({ previewMode: mode });
  void api.settings.set('export.previewMode', mode);
  if (running) suspendPreview(mode === 'paused');
}

/** Whether the queue (not someone else) suspended the live preview. */
let suspendedByQueue = false;
function suspendPreview(on: boolean): void {
  if (on === suspendedByQueue) return;
  suspendedByQueue = on;
  engine.setSuspended(on);
}

export const openOutput = (job: ExportJob): void => void api.app.openPath(job.output.path);

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

let running = false;
/** Outputs finished in the current run of the queue, announced together when it goes idle. */
let announce: string[] = [];

async function measure(job: ExportJob, bytesHint?: number): Promise<number> {
  if (bytesHint !== undefined) return bytesHint;
  try {
    if (job.output.kind === 'folder') return await api.call<number>('x:export:folderSize', job.output.path);
    const [info] = await api.fs.stat([job.output.path]);
    return info?.size ?? 0;
  } catch {
    return 0;
  }
}

const fileName = (p: string): string => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');

async function runJob(job: ExportJob): Promise<void> {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  dispatch({ type: 'start', id: job.id });
  let lastPush = 0;
  try {
    const res = await exportProject(
      job.project,
      job.settings,
      job.output.path,
      (progress) => {
        // The exporter reports every few frames; store updates are throttled to ~6 per second.
        const now = performance.now();
        if (now - lastPush < 160 && progress.phase === 'rendering' && progress.ratio < 1) return;
        lastPush = now;
        dispatch({ type: 'progress', id: job.id, progress });
      },
      controller.signal,
      (h) => canvases.set(job.id, h.canvas),
    );
    const result: JobResult = { seconds: res.seconds, frames: res.frames, bytes: await measure(job, res.bytes), extraFiles: res.extraFiles ?? [] };
    dispatch({ type: 'complete', id: job.id, result });
    // Finished exports nobody is watching are announced once the queue is idle (one toast).
    if (!useExportQueue.getState().watched.includes(job.id)) announce.push(job.output.path);
  } catch (err) {
    if (err instanceof ExportCancelled || controller.signal.aborted) {
      dispatch({ type: 'cancelled', id: job.id });
    } else {
      console.error('[export]', err);
      const message = (err as Error)?.message || 'The export failed.';
      dispatch({ type: 'fail', id: job.id, error: message });
      if (!useExportQueue.getState().watched.includes(job.id)) {
        useUI.getState().toast({ kind: 'error', message: `Export failed: ${job.label}`, detail: message, action: { label: 'Retry', run: () => retryJob(job.id) } });
      }
    }
  } finally {
    controllers.delete(job.id);
    canvases.delete(job.id);
  }
}

/** Run queued jobs one after another until the queue is empty. */
async function pump(): Promise<void> {
  if (running) return;
  const first = nextJob(useExportQueue.getState());
  if (!first) return;
  running = true;
  if (useExportQueue.getState().previewMode === 'paused') suspendPreview(true);
  void api.app.keepAwake(true);
  try {
    for (let job = nextJob(useExportQueue.getState()); job; job = nextJob(useExportQueue.getState())) {
      await runJob(job);
    }
  } finally {
    running = false;
    suspendPreview(false);
    void api.app.keepAwake(false);
    void api.app.setProgress(-1);
    const done = announce;
    announce = [];
    if (done.length === 1) {
      useUI.getState().toast({ kind: 'success', message: `Exported “${fileName(done[0])}”`, action: { label: 'Show in folder', run: () => void api.app.showItemInFolder(done[0]) } });
    } else if (done.length > 1) {
      useUI.getState().toast({ kind: 'success', message: `${done.length} exports finished`, detail: done.map(fileName).join(' · '), action: { label: 'Show in folder', run: () => void api.app.showItemInFolder(done[0]) } });
    }
  }
}

export const isQueueRunning = (): boolean => running;

// ---------------------------------------------------------------------------------------------
// Taskbar progress, preferences, quitting while exporting
// ---------------------------------------------------------------------------------------------

let lastTaskbar = -2;
useExportQueue.subscribe((s) => {
  const busy = isBusy(s);
  const value = busy ? Math.round(totalProgress(s).ratio * 200) / 200 : -1;
  if (value !== lastTaskbar) {
    lastTaskbar = value;
    void api.app.setProgress(value);
  }
});

let installed = false;

/** Load preferences and guard against closing the window mid-export. Call once at startup. */
export function initExportQueue(): void {
  if (installed) return;
  installed = true;
  // Handle for automated tests and DevTools, next to the app's own `window.__kinora`.
  const dbg = (window as unknown as { __kinora?: Record<string, unknown> }).__kinora;
  if (dbg) dbg.exportQueue = { useExportQueue, enqueue, cancelJob, retryJob, removeJob, clearFinished, setPreviewMode };
  void api.settings.get<PreviewMode>('export.previewMode').then((mode) => {
    if (mode === 'live' || mode === 'paused') useExportQueue.setState({ previewMode: mode });
  });
  let allowClose = false;
  window.addEventListener('beforeunload', (e) => {
    if (allowClose || !isBusy(useExportQueue.getState())) return;
    // Cancel this close and ask; quitting would lose the running exports.
    e.preventDefault();
    e.returnValue = false;
    void api.dialog
      .message({ type: 'warning', title: 'Exports in progress', message: 'Exports are still running.', detail: 'Quitting now cancels them and removes the unfinished files.', buttons: ['Keep exporting', 'Quit anyway'] })
      .then((choice) => {
        if (choice !== 1) return;
        allowClose = true;
        cancelAll();
        void api.app.confirmClose();
      });
  });
}
