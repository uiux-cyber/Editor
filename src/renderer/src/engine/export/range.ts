/**
 * Export ranges: the whole project, the marked In–Out section (`project.inPoint / outPoint`) or
 * the span of the selected clips. Also the pure In / Out marking rules used by the I / O keys
 * and the ruler handles.
 *
 * Pure module (no DOM / GPU): unit tested in tests/export.test.ts.
 */

import { projectDuration } from '@/core/project';
import { clipEnd, snapToFrame } from '@/core/time';
import type { ID, Project } from '@/core/types';

export type RangeMode = 'all' | 'inout' | 'selection';

export interface ResolvedRange {
  mode: RangeMode;
  start: number;
  end: number;
  /** False when the range is empty (nothing marked / selected, or shorter than one frame). */
  valid: boolean;
  /** Why the range cannot be used, for the dialog. */
  reason?: string;
}

/** Whether the project has an In and / or Out mark. */
export const hasMarks = (p: Pick<Project, 'inPoint' | 'outPoint'>): boolean => p.inPoint !== undefined || p.outPoint !== undefined;

/** The marked section, with a missing In meaning 0 and a missing Out meaning the end. */
export function markedRange(p: Project): { start: number; end: number } | null {
  if (!hasMarks(p)) return null;
  const duration = projectDuration(p);
  const start = Math.min(Math.max(0, p.inPoint ?? 0), duration);
  const end = Math.min(Math.max(0, p.outPoint ?? duration), duration);
  return { start, end };
}

/** Span of the given clips (seconds), or null when none exist. */
export function selectionSpan(p: Project, ids: readonly ID[]): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const id of ids) {
    const c = p.clips[id];
    if (!c) continue;
    start = Math.min(start, c.start);
    end = Math.max(end, clipEnd(c));
  }
  return Number.isFinite(start) && end > start ? { start, end } : null;
}

export function resolveRange(p: Project, mode: RangeMode, selection: readonly ID[] = []): ResolvedRange {
  const duration = projectDuration(p);
  const minLen = 1 / Math.max(1, p.settings.fps);
  const make = (start: number, end: number, reason?: string): ResolvedRange => {
    const s = Math.min(Math.max(0, start), duration);
    const e = Math.min(Math.max(s, end), duration);
    if (reason) return { mode, start: s, end: e, valid: false, reason };
    if (e - s < minLen - 1e-6) return { mode, start: s, end: e, valid: false, reason: mode === 'all' ? 'The timeline is empty.' : 'The range is shorter than one frame.' };
    return { mode, start: s, end: e, valid: true };
  };
  if (mode === 'inout') {
    const r = markedRange(p);
    if (!r) return make(0, 0, 'Mark an In and / or Out point first (I / O at the playhead).');
    return make(r.start, r.end);
  }
  if (mode === 'selection') {
    const r = selectionSpan(p, selection);
    if (!r) return make(0, 0, 'Select one or more clips on the timeline first.');
    return make(r.start, r.end);
  }
  return make(0, duration);
}

/** The range mode the dialog should start with: In–Out when marks exist, else the whole project. */
export const defaultRangeMode = (p: Project): RangeMode => (markedRange(p) ? 'inout' : 'all');

// ---------------------------------------------------------------------------------------------
// Marking (mutates a draft; call inside updateProject)
// ---------------------------------------------------------------------------------------------

/** Set the In point. An Out at or before the new In is cleared (as in other editors). */
export function setInPoint(p: Project, time: number): void {
  const t = Math.max(0, snapToFrame(time, p.settings.fps));
  p.inPoint = t;
  if (p.outPoint !== undefined && p.outPoint <= t) delete p.outPoint;
}

/** Set the Out point. An In at or after the new Out is cleared. */
export function setOutPoint(p: Project, time: number): void {
  const t = Math.max(0, snapToFrame(time, p.settings.fps));
  p.outPoint = t;
  if (p.inPoint !== undefined && p.inPoint >= t) delete p.inPoint;
}

export function clearInOut(p: Project): void {
  delete p.inPoint;
  delete p.outPoint;
}

/** Move both marks by `delta` seconds, keeping the section inside [0, duration]. */
export function shiftInOut(p: Project, from: { start: number; end: number }, delta: number, duration: number): void {
  const len = from.end - from.start;
  const start = Math.min(Math.max(0, snapToFrame(from.start + delta, p.settings.fps)), Math.max(0, duration - len));
  p.inPoint = start;
  p.outPoint = start + len;
}
