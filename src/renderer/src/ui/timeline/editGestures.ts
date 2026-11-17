/**
 * Trim-mode gestures (trim, ripple, roll, slip, slide) for the timeline. Each pointer move asks
 * `core/editing` for the largest valid delta and rebuilds the live project from the gesture's
 * starting snapshot, so the whole drag is one undo step with a descriptive label.
 */

import { create } from 'zustand';
import { applyProposal, clampEdit, linkedPartners, proposeEdit, type EditOp } from '@/core/editing';
import { formatTimecode } from '@/core/time';
import type { ID, Project } from '@/core/types';
import { engine } from '@/engine/engine';
import { getProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { SNAP_PX, bestSnap, snapPoints, trackPointer } from './gestureUtils';
import { useTrimMonitor, type MonitorView } from './TrimMonitor';

// ---------------------------------------------------------------------------------------------
// Live readout
// ---------------------------------------------------------------------------------------------

export interface Readout {
  /** Pointer position (client px). */
  x: number;
  y: number;
  title: string;
  /** Applied delta, seconds. */
  delta: number;
  fps: number;
  /** The edit hit a limit (media, neighbour or minimum length). */
  limited: boolean;
  /** Optional extra line, e.g. the new clip length. */
  note?: string;
}

export const useEditReadout = create<{ readout: Readout | null }>(() => ({ readout: null }));

/** "+00:01:05" style signed timecode and "+35 f" frame count for a delta. */
export function formatDelta(delta: number, fps: number): { tc: string; frames: string } {
  const frames = Math.round(delta * fps);
  const sign = frames > 0 ? '+' : frames < 0 ? '−' : '±';
  return { tc: `${sign}${formatTimecode(Math.abs(frames) / fps, fps)}`, frames: `${sign}${Math.abs(frames)} f` };
}

// ---------------------------------------------------------------------------------------------
// Gesture runner
// ---------------------------------------------------------------------------------------------

export interface GestureContext {
  /** Timeline time under a client position. */
  timeAt: (clientX: number, clientY: number) => number;
  edgeScroll: (clientX: number) => void;
  setSnapLine: (time: number | null) => void;
  pps: () => number;
}

export interface EditGestureSpec {
  op: EditOp;
  /** Readout title and History label. */
  label: string;
  /** Timeline times that move with the pointer and may snap (e.g. the dragged edge). */
  snapEdges: number[];
  /** Clips whose edges are not snap targets (the ones being edited). */
  exclude: ID[];
  /** Playhead position to show for an applied delta (null = leave it). */
  seek?: (applied: number, project: Project) => number | null;
  /** Two-up monitor to show for an applied delta. */
  monitor?: (applied: number, project: Project) => MonitorView | null;
  /** Extra readout line. */
  note?: (applied: number, project: Project) => string | undefined;
}

export function startEditGesture(e: React.PointerEvent, ctx: GestureContext, spec: EditGestureSpec): void {
  const base = getProject();
  const fps = base.settings.fps;
  const t0 = ctx.timeAt(e.clientX, e.clientY);
  const points = snapPoints(base, new Set(spec.exclude));
  let started = false;
  engine.pause();

  trackPointer(e, {
    move: (ev, moved) => {
      if (!moved) return;
      const store = useProjectStore.getState();
      if (!started) {
        started = true;
        store.begin(spec.label);
      }
      ctx.edgeScroll(ev.clientX);
      let delta = ctx.timeAt(ev.clientX, ev.clientY) - t0;
      let line: number | null = null;
      if (spec.snapEdges.length && useUI.getState().snapping !== ev.altKey) {
        const snap = bestSnap(
          spec.snapEdges.map((x) => x + delta),
          points,
          SNAP_PX / ctx.pps(),
        );
        if (snap) {
          delta += snap.delta;
          line = snap.at;
        }
      }
      const applied = clampEdit(base, spec.op, delta, fps);
      const limited = Math.abs(applied - delta) > 0.5 / fps;
      if (limited) line = null;
      store.updateFromBase((p) => applyProposal(p, proposeEdit(base, spec.op, applied)));
      ctx.setSnapLine(line);
      const current = getProject();
      useEditReadout.setState({ readout: { x: ev.clientX, y: ev.clientY, title: spec.label, delta: applied, fps, limited, note: spec.note?.(applied, current) } });
      const at = spec.seek?.(applied, current);
      if (at !== null && at !== undefined) engine.seek(at);
      if (spec.monitor) useTrimMonitor.setState({ view: spec.monitor(applied, current) });
    },
    end: (_ev, _moved, cancelled) => {
      ctx.setSnapLine(null);
      useEditReadout.setState({ readout: null });
      useTrimMonitor.setState({ view: null });
      if (!started) return;
      const store = useProjectStore.getState();
      if (cancelled) store.cancel();
      else store.commit(spec.label);
    },
  });
}

/** Clip ids an edit on `clipId` touches directly: the clip and (when linked) its partners. */
export function editedIds(p: Project, clipId: ID, linked: boolean): ID[] {
  return [clipId, ...(linked ? linkedPartners(p, clipId).map((c) => c.id) : [])];
}

// ---------------------------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------------------------

/** White glyph with a dark outline, as an SVG cursor with a fallback keyword. */
function cursor(paths: string, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#000" stroke-width="4" opacity=".75">${paths}</g><g stroke="#fff" stroke-width="1.8">${paths}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`;
}

const CURSORS: Record<string, string> = {
  // Edge bracket with an arrow pushing the rest of the track.
  '--cur-ripple-r': cursor('<path d="M8 5v14M8 5h3M8 19h3M12 12h8M17 9l3 3-3 3"/>', 'e-resize'),
  '--cur-ripple-l': cursor('<path d="M16 5v14M16 5h-3M16 19h-3M12 12H4M7 9l-3 3 3 3"/>', 'w-resize'),
  // A cut with arrows to both sides.
  '--cur-roll': cursor('<path d="M12 4v16M9 6H7v12h2M15 6h2v12h-2M5 12H2M3.5 10.5 2 12l1.5 1.5M19 12h3M20.5 10.5 22 12l-1.5 1.5"/>', 'col-resize'),
  // Two fixed edges with the picture moving between them.
  '--cur-slip': cursor('<path d="M4 5v14M20 5v14M8 12h8M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/>', 'ew-resize'),
  // A clip moving between neighbours.
  '--cur-slide': cursor('<path d="M8 7h8v10H8zM5 12H2M3.5 10.5 2 12l1.5 1.5M19 12h3M20.5 10.5 22 12l-1.5 1.5"/>', 'ew-resize'),
};

let cursorsInstalled = false;

/** Publish the trim-mode cursors as CSS custom properties (used by timeline-editing.css). */
export function installEditCursors(): void {
  if (cursorsInstalled || typeof document === 'undefined') return;
  cursorsInstalled = true;
  for (const [name, value] of Object.entries(CURSORS)) document.documentElement.style.setProperty(name, value);
}
