/**
 * Pen tool and path editing on the preview canvas.
 *
 * - Pen tool (P): click to add corner points, press and drag to pull bezier handles, click the
 *   first point to close, Enter (or double-click) to finish an open line, Esc to cancel,
 *   Backspace removes the last point. Shift constrains to 45°, Alt disables snapping.
 * - A selected path shape shows its points and handles: drag them, Alt-click a point to toggle
 *   smooth / corner, double-click the outline to insert a point, Delete removes the selected point.
 *
 * Mounted by Preview.tsx inside the stage overlay; every edit is one undo step.
 */

import { PenTool } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { designSize } from '@/core/project';
import { clonePoints, constrain45, cubicSegments, insertPoint, isSmooth, nearestOnPath, removePoint, toggleSmooth, type AbsPoint, type Vec } from '@/core/path';
import type { ID, ShapeClip, ShapeStyle, Transform } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { useMenu } from '../../common/overlays';
import { createPathShape, designToFrame, designVecToFrame, editPath, frameToDesign, frameVecToDesign, shapeFrame, shapePoints, writePathPoints, type ShapeFrame } from './pathOps';
import './pen.css';

interface Guides {
  v: number | null;
  h: number | null;
}
const NO_GUIDES: Guides = { v: null, h: null };

/** Screen distance (px) within which a click on the first point closes the path. */
const CLOSE_PX = 9;
const SNAP_PX = 7;

interface StageProps {
  k: number;
  stageW: number;
  stageH: number;
}

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable) return true;
  if (node.tagName === 'INPUT') {
    const type = (node as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'color' && type !== 'button';
  }
  return false;
};

/** Keyboard events the canvas tools may handle (editor visible, nothing modal, not typing). */
const canvasKey = (e: KeyboardEvent): boolean => {
  const ui = useUI.getState();
  return ui.screen === 'editor' && !ui.modal && !useMenu.getState().open && !isTyping(e.target) && !e.ctrlKey && !e.metaKey;
};

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** SVG path data for points already in stage pixels. */
function pathD(points: AbsPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  const f = (v: number): string => v.toFixed(2);
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (const [, c1, c2, p] of cubicSegments(points, closed)) d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p.x)},${f(p.y)}`;
  if (closed && points.length > 2) d += ' Z';
  return d;
}

/** Snap a design-space point to the frame's centre / edges and to other points. */
function snapPoint(p: Vec, others: Vec[], cw: number, ch: number, k: number): { p: Vec; guides: Guides } {
  const tol = SNAP_PX / k;
  const out = { ...p };
  const guides: Guides = { v: null, h: null };
  let best = tol;
  for (const x of [0, -cw / 2, cw / 2, ...others.map((o) => o.x)]) {
    const d = Math.abs(x - p.x);
    if (d < best) {
      best = d;
      out.x = x;
      guides.v = x;
    }
  }
  best = tol;
  for (const y of [0, -ch / 2, ch / 2, ...others.map((o) => o.y)]) {
    const d = Math.abs(y - p.y);
    if (d < best) {
      best = d;
      out.y = y;
      guides.h = y;
    }
  }
  return { p: out, guides };
}

function GuideLines({ guides, k, stageW, stageH }: StageProps & { guides: Guides }): ReactNode {
  return (
    <>
      {guides.v !== null && <div className="guide guide--v" style={{ left: stageW / 2 + guides.v * k }} />}
      {guides.h !== null && <div className="guide guide--h" style={{ top: stageH / 2 + guides.h * k }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Drawing a new path
// ---------------------------------------------------------------------------------------------

function PenDraw({ k, stageW, stageH }: StageProps): ReactNode {
  const settings = useProjectStore((s) => s.project.settings);
  const { cw, ch } = designSize(settings);
  const rootRef = useRef<HTMLDivElement>(null);
  const [points, setPointsState] = useState<AbsPoint[]>([]);
  const pointsRef = useRef<AbsPoint[]>([]);
  const [hover, setHover] = useState<Vec | null>(null);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const drag = useRef<{ index: number; origin: Vec; moved: boolean } | null>(null);

  const setPoints = (next: AbsPoint[]): void => {
    pointsRef.current = next;
    setPointsState(next);
  };

  const fromEvent = (e: { clientX: number; clientY: number }): Vec => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - r.width / 2) / k, y: (e.clientY - r.top - r.height / 2) / k };
  };

  const exit = (): void => {
    setPoints([]);
    setHover(null);
    setGuides(NO_GUIDES);
    useUI.getState().setTool('select');
  };

  const finish = (closed: boolean): void => {
    const pts = pointsRef.current;
    const ok = pts.length >= 2;
    if (ok) {
      try {
        createPathShape(pts, closed && pts.length >= 3);
      } catch (err) {
        toast('error', 'Could not create the path', (err as Error).message);
      }
    }
    exit();
  };

  // Keyboard: Enter finishes, Esc cancels, Backspace / Delete removes the last point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!canvasKey(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exit();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && pointsRef.current.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setPoints(pointsRef.current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const place = (raw: Vec, e: { shiftKey: boolean; altKey: boolean }): { p: Vec; guides: Guides } => {
    const pts = pointsRef.current;
    if (e.shiftKey && pts.length) return { p: constrain45(pts[pts.length - 1], raw), guides: NO_GUIDES };
    if (e.altKey) return { p: raw, guides: NO_GUIDES };
    return snapPoint(raw, pts, cw, ch, k);
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = fromEvent(e);
    const pts = pointsRef.current;
    if (pts.length >= 3 && dist(raw, pts[0]) * k <= CLOSE_PX) {
      finish(true);
      return;
    }
    const { p } = place(raw, e);
    const next = [...pts, { x: p.x, y: p.y, in: null, out: null }];
    setPoints(next);
    drag.current = { index: next.length - 1, origin: p, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const raw = fromEvent(e);
    const d = drag.current;
    if (d) {
      let v = { x: raw.x - d.origin.x, y: raw.y - d.origin.y };
      if (e.shiftKey) v = constrain45({ x: 0, y: 0 }, v);
      if (!d.moved && Math.hypot(v.x, v.y) * k < 3) return;
      d.moved = true;
      const next = clonePoints(pointsRef.current);
      const pt = next[d.index];
      if (!pt) return;
      pt.out = { ...v };
      pt.in = { x: -v.x, y: -v.y };
      setPoints(next);
      setHover(null);
      setGuides(NO_GUIDES);
      return;
    }
    const placed = place(raw, e);
    setHover(placed.p);
    setGuides(placed.guides);
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    // The second click of a double-click added a duplicate of the last point.
    let pts = pointsRef.current;
    if (pts.length >= 2 && dist(pts[pts.length - 1], pts[pts.length - 2]) * k < 4) pts = pts.slice(0, -1);
    pointsRef.current = pts;
    if (pts.length >= 2) finish(false);
  };

  const toStage = (v: Vec): Vec => ({ x: stageW / 2 + v.x * k, y: stageH / 2 + v.y * k });
  const stagePts: AbsPoint[] = points.map((p) => ({
    ...toStage(p),
    in: p.in ? { x: p.in.x * k, y: p.in.y * k } : null,
    out: p.out ? { x: p.out.x * k, y: p.out.y * k } : null,
  }));
  const last = stagePts[stagePts.length - 1];
  const closing = !!hover && points.length >= 3 && dist(hover, points[0]) * k <= CLOSE_PX;
  let rubber: string | null = null;
  if (last && hover && !drag.current) {
    const target = closing ? stagePts[0] : toStage(hover);
    rubber = last.out
      ? `M${last.x},${last.y} C${last.x + last.out.x},${last.y + last.out.y} ${target.x},${target.y} ${target.x},${target.y}`
      : `M${last.x},${last.y} L${target.x},${target.y}`;
  }
  const active = drag.current ? stagePts[drag.current.index] : last;

  return (
    <div
      ref={rootRef}
      className="pen-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => !drag.current && setHover(null)}
      onDoubleClick={onDoubleClick}
      data-pen-layer
    >
      <svg className="pen-svg" width={stageW} height={stageH}>
        {stagePts.length > 1 && <path className="pen-path" d={pathD(stagePts, false)} />}
        {rubber && <path className={`pen-rubber ${closing ? 'is-closing' : ''}`} d={rubber} />}
        {active && (active.in || active.out) && (
          <g className="pen-handles">
            {active.in && <line x1={active.x} y1={active.y} x2={active.x + active.in.x} y2={active.y + active.in.y} />}
            {active.out && <line x1={active.x} y1={active.y} x2={active.x + active.out.x} y2={active.y + active.out.y} />}
            {active.in && <circle cx={active.x + active.in.x} cy={active.y + active.in.y} r={3.5} />}
            {active.out && <circle cx={active.x + active.out.x} cy={active.y + active.out.y} r={3.5} />}
          </g>
        )}
        {stagePts.map((p, i) => (
          <rect key={i} className={`pen-anchor ${i === 0 ? 'is-first' : ''} ${i === 0 && closing ? 'is-closing' : ''}`} x={p.x - (i === 0 ? 5 : 4)} y={p.y - (i === 0 ? 5 : 4)} width={i === 0 ? 10 : 8} height={i === 0 ? 10 : 8} rx={i === 0 ? 5 : 1.5} />
        ))}
      </svg>
      <GuideLines guides={guides} k={k} stageW={stageW} stageH={stageH} />
      <div className="pen-hint">
        {points.length === 0 ? (
          <>
            <b>Pen</b> Click to add points · drag to curve
          </>
        ) : points.length < 3 ? (
          <>
            <kbd>Enter</kbd> finish line · <kbd>Esc</kbd> cancel · <kbd>Shift</kbd> 45°
          </>
        ) : (
          <>
            Click the first point to close · <kbd>Enter</kbd> finish line · <kbd>Esc</kbd> cancel
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editing a selected path
// ---------------------------------------------------------------------------------------------

interface EditDrag {
  kind: 'point' | 'handle';
  index: number;
  side: 'in' | 'out';
  start: Vec;
  frame: ShapeFrame;
  points: AbsPoint[];
  closed: boolean;
  localTime: number;
  snapshot: { shape: ShapeStyle; transform: Transform; keyframes: ShapeClip['keyframes'] };
  moved: boolean;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function PathEditor({ clipId, k, stageW, stageH }: StageProps & { clipId: ID }): ReactNode {
  usePlayback((s) => s.layoutVersion);
  usePlayback((s) => s.time);
  const clip = useProjectStore((s) => s.project.clips[clipId]);
  const settings = useProjectStore((s) => s.project.settings);
  const rootRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const drag = useRef<EditDrag | null>(null);
  const { cw, ch } = designSize(settings);

  useEffect(() => setSel(null), [clipId]);

  const localTime = (c: ShapeClip): number => Math.min(Math.max(engine.time - c.start, 0), c.duration);
  const current = (): { clip: ShapeClip; frame: ShapeFrame; t: number } | null => {
    const c = getProject().clips[clipId];
    const box = engine.layerBox(clipId);
    if (!c || c.type !== 'shape' || c.shape.kind !== 'path' || !c.shape.path || !box) return null;
    const t = localTime(c);
    return { clip: c, frame: shapeFrame(c, box, t), t };
  };
  const fromEvent = (e: { clientX: number; clientY: number }): Vec => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - r.width / 2) / k, y: (e.clientY - r.top - r.height / 2) / k };
  };

  // Delete removes the selected point; Esc deselects it.
  useEffect(() => {
    if (sel === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!canvasKey(e)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        let removed = false;
        editPath([clipId], (pts, closed) => {
          const r = sel < pts.length ? removePoint(pts, closed, sel) : null;
          removed = !!r;
          return r;
        });
        if (!removed) toast('info', 'A path needs at least two points', 'Delete the whole shape to remove it.');
        setSel(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, clipId]);

  // Double-click on the outline inserts a point there.
  useEffect(() => {
    const host = rootRef.current?.closest('.stage__overlay') as HTMLElement | null;
    if (!host) return;
    const onDbl = (e: MouseEvent): void => {
      const cur = current();
      if (!cur || (e.target as Element | null)?.closest?.('[data-anchor],[data-handle]')) return;
      const pos = fromEvent(e);
      const pts = shapePoints(cur.clip).map((p) => ({
        ...frameToDesign(cur.frame, p),
        in: p.in ? frameVecToDesign(cur.frame, p.in) : null,
        out: p.out ? frameVecToDesign(cur.frame, p.out) : null,
      }));
      const hit = nearestOnPath(pts, cur.clip.shape.path!.closed, pos);
      if (!hit || hit.dist * k > 8) return;
      e.preventDefault();
      e.stopPropagation();
      editPath([clipId], (p, closed) => ({ points: insertPoint(p, closed, hit.index, hit.t), closed }));
      setSel(hit.index + 1);
    };
    host.addEventListener('dblclick', onDbl, true);
    return () => host.removeEventListener('dblclick', onDbl, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, k]);

  const begin = (kind: EditDrag['kind'], index: number, side: EditDrag['side'] = 'out') => (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = current();
    if (!cur) return;
    if (kind === 'point') {
      setSel(index);
      if (e.altKey) {
        editPath([clipId], (pts, closed) => ({ points: toggleSmooth(pts, closed, index), closed }));
        return;
      }
    }
    drag.current = {
      kind,
      index,
      side,
      start: fromEvent(e),
      frame: cur.frame,
      points: shapePoints(cur.clip),
      closed: cur.clip.shape.path!.closed,
      localTime: cur.t,
      snapshot: { shape: clone(cur.clip.shape), transform: { ...cur.clip.transform }, keyframes: cur.clip.keyframes ? clone(cur.clip.keyframes) : undefined },
      moved: false,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const pos = fromEvent(e);
    if (!d.moved) {
      if (dist(pos, d.start) * k < 2) return;
      d.moved = true;
      useProjectStore.getState().begin();
    }
    const pts = clonePoints(d.points);
    const p0 = d.points[d.index];
    let g = NO_GUIDES;
    if (d.kind === 'point') {
      const anchor = frameToDesign(d.frame, p0);
      let target = { x: anchor.x + pos.x - d.start.x, y: anchor.y + pos.y - d.start.y };
      if (e.shiftKey) target = constrain45(anchor, target);
      else if (!e.altKey) {
        const others = d.points.filter((_, i) => i !== d.index).map((p) => frameToDesign(d.frame, p));
        const s = snapPoint(target, others, cw, ch, k);
        target = s.p;
        g = s.guides;
      }
      const sp = designToFrame(d.frame, target);
      pts[d.index].x = sp.x;
      pts[d.index].y = sp.y;
    } else {
      const anchor = frameToDesign(d.frame, p0);
      const h0 = p0[d.side] ?? { x: 0, y: 0 };
      const tip0 = frameVecToDesign(d.frame, h0);
      let tip = { x: anchor.x + tip0.x + pos.x - d.start.x, y: anchor.y + tip0.y + pos.y - d.start.y };
      if (e.shiftKey) tip = constrain45(anchor, tip);
      const hv = designVecToFrame(d.frame, { x: tip.x - anchor.x, y: tip.y - anchor.y });
      pts[d.index][d.side] = hv;
      // Smooth points keep their handles collinear (hold Alt to break them apart).
      const other = d.side === 'in' ? 'out' : 'in';
      const o0 = p0[other];
      const len = Math.hypot(hv.x, hv.y);
      if (!e.altKey && o0 && p0[d.side] && len > 1e-6) {
        const ol = Math.hypot(o0.x, o0.y);
        pts[d.index][other] = { x: (-hv.x / len) * ol, y: (-hv.y / len) * ol };
      }
    }
    setGuides(g);
    updateProject((p) => {
      const c = p.clips[clipId];
      if (!c || c.type !== 'shape') return;
      c.shape = clone(d.snapshot.shape);
      c.transform = { ...d.snapshot.transform };
      if (d.snapshot.keyframes) c.keyframes = clone(d.snapshot.keyframes);
      else delete c.keyframes;
      writePathPoints(c, pts, d.closed, d.localTime);
    });
  };

  const end = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setGuides(NO_GUIDES);
    if (d?.moved) useProjectStore.getState().commit();
  };

  const cur = current();
  if (!clip || !cur) return <div ref={rootRef} className="path-edit" />;
  const toStage = (v: Vec): Vec => ({ x: stageW / 2 + v.x * k, y: stageH / 2 + v.y * k });
  const pts = shapePoints(cur.clip);
  const stagePts: AbsPoint[] = pts.map((p) => {
    const vin = p.in ? frameVecToDesign(cur.frame, p.in) : null;
    const vout = p.out ? frameVecToDesign(cur.frame, p.out) : null;
    return { ...toStage(frameToDesign(cur.frame, p)), in: vin ? { x: vin.x * k, y: vin.y * k } : null, out: vout ? { x: vout.x * k, y: vout.y * k } : null };
  });
  const closed = cur.clip.shape.path!.closed;
  const n = stagePts.length;
  const showHandles = (i: number): boolean => n <= 24 || sel === null || Math.abs(i - sel) <= 1 || (closed && Math.abs(i - sel) === n - 1);
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div ref={rootRef} className="path-edit" data-path-edit={clipId}>
      <svg width={stageW} height={stageH}>
        <path className="path-edit__outline" d={pathD(stagePts, closed)} />
        {stagePts.map((p, i) =>
          showHandles(i) ? (
            <g key={`h${i}`} className="path-edit__handles">
              {(['in', 'out'] as const).map((side) => {
                const h = p[side];
                if (!h || Math.hypot(h.x, h.y) < 0.5) return null;
                return (
                  <g key={side} data-handle={`${i}-${side}`} onPointerDown={begin('handle', i, side)} {...handlers}>
                    <line className="path-edit__arm" x1={p.x} y1={p.y} x2={p.x + h.x} y2={p.y + h.y} />
                    <circle className="path-edit__hit" cx={p.x + h.x} cy={p.y + h.y} r={7} />
                    <circle className="path-edit__knob" cx={p.x + h.x} cy={p.y + h.y} r={3.5} />
                  </g>
                );
              })}
            </g>
          ) : null,
        )}
        {stagePts.map((p, i) => {
          const smooth = isSmooth(pts[i]);
          return (
            <g key={`a${i}`} data-anchor={i} className={`path-edit__anchor ${sel === i ? 'is-selected' : ''} ${smooth ? 'is-smooth' : ''}`} onPointerDown={begin('point', i)} {...handlers}>
              <title>{smooth ? 'Smooth point — Alt-click for a corner' : 'Corner point — Alt-click to make it smooth'}</title>
              <circle className="path-edit__hit" cx={p.x} cy={p.y} r={8} />
              {smooth ? <circle className="path-edit__dot" cx={p.x} cy={p.y} r={4.5} /> : <rect className="path-edit__dot" x={p.x - 4} y={p.y - 4} width={8} height={8} rx={1.5} />}
            </g>
          );
        })}
      </svg>
      <GuideLines guides={guides} k={k} stageW={stageW} stageH={stageH} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Mount points
// ---------------------------------------------------------------------------------------------

/** Pen drawing layer, or the point editor of the selected path shape. */
export function PenOverlay({ k, stageW, stageH }: StageProps): ReactNode {
  const tool = useUI((s) => s.tool);
  const selection = useUI((s) => s.selection);
  const target = useProjectStore((s) => {
    if (selection.length !== 1) return null;
    const c = s.project.clips[selection[0]];
    if (!c || c.type !== 'shape' || c.shape.kind !== 'path' || !c.shape.path) return null;
    return s.project.tracks.find((t) => t.id === c.trackId)?.locked ? null : c.id;
  });

  // P switches to the pen tool (also registered as the `graphics.penTool` command).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'p' || e.altKey || e.shiftKey || !canvasKey(e)) return;
      e.preventDefault();
      useUI.getState().setTool('pen');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (tool === 'pen') return <PenDraw k={k} stageW={stageW} stageH={stageH} />;
  if (target && tool === 'select') return <PathEditor key={target} clipId={target} k={k} stageW={stageW} stageH={stageH} />;
  return null;
}

/** Transport button that toggles the pen tool. */
export function PenToolButton(): ReactNode {
  const active = useUI((s) => s.tool === 'pen');
  return (
    <button type="button" className={`icon-btn ${active ? 'is-active' : ''}`} title="Pen tool — draw a shape or a line (P)" data-pen-tool onClick={() => useUI.getState().setTool(active ? 'select' : 'pen')}>
      <PenTool size={15} />
    </button>
  );
}
