import { useEffect, useRef, useState, type ReactNode } from 'react';
import { projectDuration } from '@/core/project';
import { clipEnd, formatTimecode, snapToFrame } from '@/core/time';
import { engine } from '@/engine/engine';
import { setInPoint, setOutPoint, shiftInOut } from '@/engine/export/range';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { openContextMenu } from '../common/overlays';
import { RULER_H, timeToX, xToTime } from '../timeline/geometry';
import { clearMarks, goToIn, goToOut, openExportDialog } from './actions';
import './export.css';

const SNAP_PX = 8;

/** Snap `t` to the playhead, clip edges and markers when snapping is on. */
function snapTime(t: number, pps: number): number {
  if (!useUI.getState().snapping) return t;
  const p = getProject();
  const pts = [0, engine.time, projectDuration(p), ...p.markers.map((m) => m.time)];
  for (const c of Object.values(p.clips)) pts.push(c.start, clipEnd(c));
  let best = t;
  let dist = SNAP_PX / pps;
  for (const x of pts) {
    if (Math.abs(x - t) < dist) {
      dist = Math.abs(x - t);
      best = x;
    }
  }
  return best;
}

/**
 * In / Out marks on the timeline ruler: a range band with draggable handles (and a bar to move
 * the whole section), plus dashed guides through the tracks. Rendered inside `.tl-content`;
 * follows vertical scrolling so it stays on the sticky ruler.
 */
export function InOutMarks({ pps, scrollEl, height }: { pps: number; scrollEl: React.RefObject<HTMLDivElement | null>; height: number }): ReactNode {
  const inPoint = useProjectStore((s) => s.project.inPoint);
  const outPoint = useProjectStore((s) => s.project.outPoint);
  const duration = useProjectStore((s) => projectDuration(s.project));
  const fps = useProjectStore((s) => s.project.settings.fps);
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'in' | 'out' | 'both' | null>(null);

  // Stay on the (sticky) ruler while the tracks scroll vertically.
  useEffect(() => {
    const el = scrollEl.current;
    if (!el) return;
    const sync = (): void => {
      if (layer.current) layer.current.style.transform = `translateY(${el.scrollTop}px)`;
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => el.removeEventListener('scroll', sync);
  }, [scrollEl, inPoint, outPoint]);

  if (inPoint === undefined && outPoint === undefined) return null;
  const a = Math.min(inPoint ?? 0, duration);
  const b = Math.max(a, Math.min(outPoint ?? duration, duration));
  const x0 = timeToX(a, pps);
  const x1 = timeToX(b, pps);

  const timeAt = (clientX: number): number => {
    const content = layer.current?.parentElement;
    const left = content ? content.getBoundingClientRect().left : 0;
    return Math.min(Math.max(0, xToTime(clientX - left, pps)), projectDuration(getProject()));
  };

  const startDrag = (e: React.PointerEvent, which: 'in' | 'out' | 'both'): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const store = useProjectStore.getState();
    const from = { start: a, end: b };
    const t0 = timeAt(e.clientX);
    store.begin();
    setDrag(which);
    const move = (ev: PointerEvent): void => {
      const f = getProject().settings.fps;
      const t = timeAt(ev.clientX);
      if (which === 'both') {
        const delta = snapTime(from.start + (t - t0), pps) - from.start;
        updateProject((p) => shiftInOut(p, from, delta, projectDuration(p)));
        return;
      }
      const snapped = snapToFrame(snapTime(t, pps), f);
      updateProject((p) => {
        const minLen = 1 / f;
        if (which === 'in') setInPoint(p, Math.min(snapped, (p.outPoint ?? projectDuration(p)) - minLen));
        else setOutPoint(p, Math.max(snapped, (p.inPoint ?? 0) + minLen));
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      setDrag(null);
      useProjectStore.getState().commit();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };

  const menu = (e: React.MouseEvent): void => {
    e.stopPropagation();
    openContextMenu(e, [
      { label: 'Export this range…', run: openExportDialog },
      { type: 'separator' },
      { label: 'Go to In', shortcut: 'Shift+I', disabled: inPoint === undefined, run: goToIn },
      { label: 'Go to Out', shortcut: 'Shift+O', disabled: outPoint === undefined, run: goToOut },
      { label: 'Clear In / Out', shortcut: 'Alt+X', run: clearMarks },
    ]);
  };

  const len = b - a;
  return (
    <div className="io-layer" ref={layer} data-inout>
      <div className="io-band" style={{ left: x0, width: Math.max(1, x1 - x0) }}>
        <div className="io-bar" title={`In–Out ${formatTimecode(len, fps)} — drag to move, right-click for options`} onPointerDown={(e) => startDrag(e, 'both')} onContextMenu={menu} />
      </div>
      <div className="io-line" style={{ left: x0, height: Math.max(0, height - RULER_H) }} />
      <div className="io-line" style={{ left: x1, height: Math.max(0, height - RULER_H) }} />
      {inPoint !== undefined && (
        <div className={`io-handle io-handle--in ${drag === 'in' ? 'is-dragging' : ''}`} style={{ left: x0 }} data-handle="in" title={`In ${formatTimecode(a, fps)} (I)`} onPointerDown={(e) => startDrag(e, 'in')} onContextMenu={menu} />
      )}
      {outPoint !== undefined && (
        <div className={`io-handle io-handle--out ${drag === 'out' ? 'is-dragging' : ''}`} style={{ left: x1 }} data-handle="out" title={`Out ${formatTimecode(b, fps)} (O)`} onPointerDown={(e) => startDrag(e, 'out')} onContextMenu={menu} />
      )}
      {drag && (
        <div className="io-tip" style={{ left: drag === 'out' ? x1 : x0, top: RULER_H + 4 }}>
          {drag === 'both' ? `${formatTimecode(a, fps)} → ${formatTimecode(b, fps)}` : formatTimecode(drag === 'in' ? a : b, fps)}
        </div>
      )}
    </div>
  );
}
