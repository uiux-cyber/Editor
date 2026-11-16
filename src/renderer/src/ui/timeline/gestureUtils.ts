/** Pointer and snapping helpers shared by the timeline gestures. */

import { clipEnd } from '@/core/time';
import type { ID, Project } from '@/core/types';
import { engine } from '@/engine/engine';

export const SNAP_PX = 8;

export function snapPoints(project: Project, exclude: ReadonlySet<ID>, includePlayhead = true): number[] {
  const pts: number[] = [0];
  if (includePlayhead) pts.push(engine.time);
  for (const clip of Object.values(project.clips)) {
    if (exclude.has(clip.id)) continue;
    pts.push(clip.start, clipEnd(clip));
  }
  for (const m of project.markers) pts.push(m.time);
  return pts;
}

/** Offset to add to one of `values` so it lands on the closest snap point within `tol`. */
export function bestSnap(values: number[], points: number[], tol: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const p of points) {
      const d = p - v;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: p };
    }
  }
  return best;
}

/** Track a pointer gesture on window until release. */
export function trackPointer(
  e: React.PointerEvent | PointerEvent,
  opts: { move: (ev: PointerEvent, moved: boolean) => void; end: (ev: PointerEvent, moved: boolean, cancelled: boolean) => void; threshold?: number },
): void {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const threshold = opts.threshold ?? 3;
  const move = (ev: PointerEvent): void => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) >= threshold) moved = true;
    opts.move(ev, moved);
  };
  const finish = (ev: PointerEvent, cancelled: boolean): void => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', key, true);
    opts.end(ev, moved, cancelled);
  };
  const up = (ev: PointerEvent): void => finish(ev, false);
  const cancel = (ev: PointerEvent): void => finish(ev, true);
  const key = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      finish(new PointerEvent('pointercancel', { clientX: x0, clientY: y0 }), true);
    }
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', key, true);
}
