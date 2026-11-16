/**
 * Export-related editor actions: In / Out marks (I, O, Alt+X, Shift+I / Shift+O), opening the
 * export dialog and the queue. Used by the shortcuts, the command palette and the ruler marks.
 */

import { projectDuration } from '@/core/project';
import { snapToFrame } from '@/core/time';
import { engine } from '@/engine/engine';
import { clearInOut, selectionSpan, setInPoint, setOutPoint } from '@/engine/export/range';
import { getProject, updateProject } from '@/store/project';
import { toast, useUI } from '@/store/ui';

const playhead = (): number => snapToFrame(engine.time, getProject().settings.fps);

export function markIn(time = playhead()): void {
  if (projectDuration(getProject()) <= 0) return;
  updateProject((p) => setInPoint(p, time));
}

export function markOut(time = playhead()): void {
  if (projectDuration(getProject()) <= 0) return;
  updateProject((p) => setOutPoint(p, time));
}

export function clearMarks(): void {
  const p = getProject();
  if (p.inPoint === undefined && p.outPoint === undefined) return;
  updateProject((d) => clearInOut(d));
}

/** Set In / Out around the selected clips. */
export function markSelection(): void {
  const span = selectionSpan(getProject(), useUI.getState().selection);
  if (!span) {
    toast('info', 'Select one or more clips to mark their range.');
    return;
  }
  updateProject((p) => {
    p.inPoint = snapToFrame(span.start, p.settings.fps);
    p.outPoint = snapToFrame(span.end, p.settings.fps);
  });
}

export function goToIn(): void {
  const p = getProject();
  if (p.inPoint !== undefined) engine.seek(p.inPoint);
}

export function goToOut(): void {
  const p = getProject();
  if (p.outPoint !== undefined) engine.seek(p.outPoint);
}

export function openExportDialog(): void {
  engine.pause();
  useUI.getState().openModal('export');
}

/** Opens the queue popover from the title bar (handled by ExportQueueButton). */
export function openExportQueue(): void {
  window.dispatchEvent(new CustomEvent('kinora:export-queue'));
}
