/**
 * Render-cache status on the timeline ruler: a thin bar along its bottom edge — green where the
 * preview plays from rendered files, amber where a section is too heavy for real time and
 * still needs rendering. Called from the ruler painter in Timeline.tsx.
 */

import { statusRuns, useRenderCache, type SegmentStatus } from '@/engine/cache/renderCache';
import { timeToX } from '../timeline/geometry';

const COLORS: Partial<Record<SegmentStatus, string>> = {
  cached: '#34d399',
  'needs-render': '#fbbf24',
};

let memo: { version: number; runs: ReturnType<typeof statusRuns> } | null = null;

export function paintCacheBar(ctx: CanvasRenderingContext2D, width: number, scrollLeft: number, pps: number, rulerH: number): void {
  const version = useRenderCache.getState().version;
  if (!memo || memo.version !== version) memo = { version, runs: statusRuns() };
  const job = useRenderCache.getState().job;
  for (const run of memo.runs) {
    const color = COLORS[run.status];
    if (!color) continue;
    const x0 = Math.max(0, timeToX(run.start, pps) - scrollLeft);
    const x1 = Math.min(width, timeToX(run.end, pps) - scrollLeft);
    if (x1 <= x0) continue;
    ctx.fillStyle = color;
    ctx.globalAlpha = run.status === 'needs-render' && job ? 0.55 : 0.95;
    ctx.fillRect(x0, rulerH - 4, x1 - x0, 3);
  }
  ctx.globalAlpha = 1;
}

/** Repaint the ruler whenever the cache status changes. */
export function onCacheStatus(cb: () => void): () => void {
  return useRenderCache.subscribe((s, prev) => {
    if (s.version !== prev.version || s.job !== prev.job) cb();
  });
}
