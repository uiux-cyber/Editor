import {
  Blend,
  Bookmark,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addTrack,
  cleanupTransitions,
  clipKind,
  getIndex,
  isFree,
  maxDurationFromSource,
  nearestFreeStart,
  neighbours,
  pruneEmptyTracks,
  removeTrack,
} from '@/core/project';
import { clipEnd, formatTimecode, snapToFrame } from '@/core/time';
import type { Clip, ID, Project, TrackKind } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';
import { useAssetRuntime } from '@/engine/media/assets';
import { getSound, getTemplate } from '@/library';
import { soundAssetDuration } from '@/engine/media/sounds';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import {
  addAdjustment,
  addAsset,
  addGenerator,
  addMarker,
  addShape,
  addSound,
  addSticker,
  addText,
  addTrackOfKind,
  addTransition,
  applyEffect,
  applyFilter,
  applyTemplate,
  copySelection,
  cutSelection,
  deleteSelection,
  detachAudioFromSelection,
  duplicateSelection,
  fillSlotWith,
  paste,
  redo,
  splitAtPlayhead,
  splitClip,
  undo,
  type Placement,
} from '../actions';
import { useElementSize } from '../common/controls';
import { openContextMenu, type MenuItem } from '../common/overlays';
import { registerDropTarget, type DragPayload } from '../dnd';
import { ClipView } from './ClipView';
import { HEADER_W, LEFT_PAD, MAX_PPS, MIN_PPS, RIGHT_PAD, RULER_H, TOP_ZONE, TRACK_HEIGHT, layoutTracks, rowAt, rulerStep, timeToX, xToTime, type Layout, type TrackRow } from './geometry';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const SNAP_PX = 8;

function snapPoints(project: Project, exclude: ReadonlySet<ID>, includePlayhead = true): number[] {
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
function bestSnap(values: number[], points: number[], tol: number): { delta: number; at: number } | null {
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
function trackPointer(e: React.PointerEvent | PointerEvent, opts: { move: (ev: PointerEvent, moved: boolean) => void; end: (ev: PointerEvent, moved: boolean, cancelled: boolean) => void; threshold?: number }): void {
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

function payloadKind(p: DragPayload, project: Project): TrackKind {
  if (p.kind === 'sound') return 'audio';
  if (p.kind === 'asset') return project.assets[p.assetId]?.kind === 'audio' ? 'audio' : 'visual';
  return 'visual';
}

function payloadDuration(p: DragPayload, project: Project): number {
  if (p.kind === 'asset') {
    const a = project.assets[p.assetId];
    return a && a.duration > 0 ? a.duration : 5;
  }
  if (p.kind === 'sound') {
    const def = getSound(p.soundId);
    return def ? soundAssetDuration(def) : p.duration;
  }
  if (p.kind === 'template') return getTemplate(p.variation.templateId)?.duration ?? p.duration;
  return 5;
}

type DropPlan =
  | { type: 'clip'; kind: TrackKind; time: number; duration: number; row: TrackRow | null; zone: 'above' | 'below' | null }
  | { type: 'cut'; fromId: ID; toId: ID; time: number; row: TrackRow }
  | { type: 'onClip'; clipId: ID }
  | { type: 'template'; time: number; duration: number };

interface Hint {
  ghost: { left: number; width: number; top: number; height: number; label?: string } | null;
  clipId: ID | null;
  cut: { x: number; top: number; height: number } | null;
}

const NO_HINT: Hint = { ghost: null, clipId: null, cut: null };

// ---------------------------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------------------------

function drawRuler(canvas: HTMLCanvasElement, width: number, scrollLeft: number, pps: number, fps: number, duration: number, markers: { time: number; color: string }[], time: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.round(RULER_H * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, RULER_H);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, width, RULER_H);

  // Shade the area past the end of the project.
  const endX = timeToX(duration, pps) - scrollLeft;
  if (duration > 0 && endX < width) {
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    ctx.fillRect(Math.max(0, endX), 0, width - Math.max(0, endX), RULER_H);
  }

  const { major, minor, frames } = rulerStep(pps, fps);
  const t0 = Math.max(0, xToTime(scrollLeft, pps));
  const t1 = xToTime(scrollLeft + width, pps);
  ctx.font = '500 10.5px "Inter Variable", "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = Math.floor(t0 / minor); i * minor <= t1; i++) {
    const t = i * minor;
    const x = Math.round(timeToX(t, pps) - scrollLeft) + 0.5;
    ctx.moveTo(x, RULER_H - 5);
    ctx.lineTo(x, RULER_H);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.fillStyle = '#8f97a8';
  ctx.beginPath();
  for (let i = Math.floor(t0 / major); i * major <= t1; i++) {
    const t = i * major;
    const x = Math.round(timeToX(t, pps) - scrollLeft) + 0.5;
    ctx.moveTo(x, RULER_H - 11);
    ctx.lineTo(x, RULER_H);
    const label = frames ? formatTimecode(t, fps) : formatTimecode(t, fps).replace(/:\d+$/, '');
    ctx.fillText(label, x + 4, 6);
  }
  ctx.stroke();

  for (const m of markers) {
    const x = timeToX(m.time, pps) - scrollLeft;
    if (x < -8 || x > width + 8) continue;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(x - 4, RULER_H - 13);
    ctx.lineTo(x + 4, RULER_H - 13);
    ctx.lineTo(x + 4, RULER_H - 6);
    ctx.lineTo(x, RULER_H - 1);
    ctx.lineTo(x - 4, RULER_H - 6);
    ctx.closePath();
    ctx.fill();
  }

  // Playhead cap.
  const px = timeToX(time, pps) - scrollLeft;
  if (px > -10 && px < width + 10) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px + 6, 9);
    ctx.lineTo(px, 16);
    ctx.lineTo(px - 6, 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, RULER_H - 1, width, 1);
}

// ---------------------------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------------------------

const zoomToSlider = (pps: number): number => Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
const sliderToZoom = (v: number): number => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v);

function Toolbar({ onZoom, onFit }: { onZoom: (pps: number) => void; onFit: () => void }): ReactNode {
  const tool = useUI((s) => s.tool);
  const snapping = useUI((s) => s.snapping);
  const pps = useUI((s) => s.pxPerSec);
  const hasSelection = useUI((s) => s.selection.length > 0 || !!s.selectedTransition);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const set = useUI((s) => s.set);
  return (
    <div className="tl-toolbar">
      <div className="tl-toolbar__group">
        <button type="button" className={`icon-btn ${tool === 'select' ? 'is-active' : ''}`} title="Select tool (V)" onClick={() => set({ tool: 'select' })}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" className={`icon-btn ${tool === 'blade' ? 'is-active' : ''}`} title="Blade tool — click a clip to cut it (C)" onClick={() => set({ tool: 'blade' })}>
          <Scissors size={15} />
        </button>
        <span className="vdivider" />
        <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={15} />
        </button>
        <span className="vdivider" />
        <button type="button" className="icon-btn" title="Split at playhead (S)" onClick={splitAtPlayhead}>
          <SquareSplitHorizontal size={15} />
        </button>
        <button type="button" className="icon-btn" title="Duplicate (Ctrl+D)" disabled={!hasSelection} onClick={duplicateSelection}>
          <Copy size={15} />
        </button>
        <button type="button" className="icon-btn" title="Delete (Del) · Shift+Del closes the gap" disabled={!hasSelection} onClick={() => deleteSelection(false)}>
          <Trash2 size={15} />
        </button>
        <span className="vdivider" />
        <button type="button" className={`icon-btn ${snapping ? 'is-active' : ''}`} title="Snapping (N)" onClick={() => set({ snapping: !snapping })}>
          <Magnet size={15} />
        </button>
        <button type="button" className="icon-btn" title="Add marker at playhead (M)" onClick={addMarker}>
          <Bookmark size={15} />
        </button>
      </div>
      <div className="tl-toolbar__group">
        <button type="button" className="icon-btn" title="Zoom out (-)" onClick={() => onZoom(pps / 1.4)}>
          <ZoomOut size={15} />
        </button>
        <input
          type="range"
          className="slider"
          style={{ width: 110, flex: 'none', ['--pct' as string]: `${zoomToSlider(pps) * 100}%` }}
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(pps)}
          title="Timeline zoom (Ctrl + scroll)"
          onChange={(e) => onZoom(sliderToZoom(parseFloat(e.target.value)))}
        />
        <button type="button" className="icon-btn" title="Zoom in (+)" onClick={() => onZoom(pps * 1.4)}>
          <ZoomIn size={15} />
        </button>
        <button type="button" className="icon-btn" title="Fit the whole project (Shift+Z)" onClick={onFit}>
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

export function Timeline(): ReactNode {
  const project = useProjectStore((s) => s.project);
  const pps = useUI((s) => s.pxPerSec);
  const selection = useUI((s) => s.selection);
  const selectedTransition = useUI((s) => s.selectedTransition);
  const tool = useUI((s) => s.tool);
  const runtime = useAssetRuntime((s) => s.items);
  const playing = usePlayback((s) => s.playing);

  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const bladeRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ time: number; offset: number } | null>(null);

  const [view, setView] = useState({ left: 0, width: 1200 });
  const [hint, setHint] = useState<Hint>(NO_HINT);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [newTrackZone, setNewTrackZone] = useState<'above' | 'below' | null>(null);
  const [renaming, setRenaming] = useState<ID | null>(null);

  const layout = useMemo(() => layoutTracks(project.tracks), [project.tracks]);
  const idx = getIndex(project);
  const duration = idx.duration;
  const fps = project.settings.fps;
  const viewW = Math.max(100, bodySize.width - HEADER_W);
  const contentW = Math.max(viewW, LEFT_PAD + duration * pps + RIGHT_PAD + viewW * 0.4);
  const contentH = RULER_H + layout.height;
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const stateRef = useRef({ project, pps, layout, fps, duration });
  stateRef.current = { project, pps, layout, fps, duration };

  // -------------------------------------------------------------------------------------------
  // Scrolling, ruler, playhead
  // -------------------------------------------------------------------------------------------

  const paintRuler = useCallback((): void => {
    const el = scrollRef.current;
    const canvas = rulerRef.current;
    if (!el || !canvas) return;
    const s = stateRef.current;
    drawRuler(canvas, el.clientWidth, el.scrollLeft, s.pps, s.fps, s.duration, s.project.markers, engine.time);
  }, []);

  const placePlayhead = useCallback((time: number): void => {
    const x = timeToX(time, stateRef.current.pps);
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
  }, []);

  const syncView = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    if (headersRef.current) headersRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    const left = Math.floor(el.scrollLeft / 120) * 120;
    setView((v) => (v.left === left && v.width === el.clientWidth ? v : { left, width: el.clientWidth }));
    paintRuler();
  }, [paintRuler]);

  useEffect(() => {
    syncView();
  }, [syncView, bodySize.width, bodySize.height, pps, project.markers, duration, fps]);

  useEffect(() => {
    placePlayhead(engine.time);
    return engine.onTime((t) => {
      placePlayhead(t);
      const el = scrollRef.current;
      if (el && engine.playing) {
        const x = timeToX(t, stateRef.current.pps);
        if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 120);
      }
      paintRuler();
    });
  }, [placePlayhead, paintRuler]);

  useEffect(() => {
    placePlayhead(engine.time);
  }, [pps, placePlayhead]);

  // Keep the point under the cursor fixed while zooming.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, timeToX(a.time, pps) - a.offset);
    syncView();
  }, [pps, syncView]);

  const setZoom = useCallback((next: number, anchorClientX?: number): void => {
    const el = scrollRef.current;
    const s = stateRef.current;
    const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
    if (el) {
      const rect = el.getBoundingClientRect();
      // Zoom around the cursor, or around the playhead when it is on screen.
      const headX = timeToX(engine.time, s.pps) - el.scrollLeft;
      const offset = anchorClientX !== undefined ? anchorClientX - rect.left : headX >= 0 && headX <= el.clientWidth ? headX : el.clientWidth / 2;
      zoomAnchor.current = { time: xToTime(el.scrollLeft + offset, s.pps), offset };
    }
    useUI.getState().set({ pxPerSec: clamped });
  }, []);

  const fitZoom = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const d = Math.max(1, stateRef.current.duration);
    zoomAnchor.current = { time: 0, offset: LEFT_PAD };
    useUI.getState().set({ pxPerSec: Math.min(MAX_PPS, Math.max(MIN_PPS, (el.clientWidth - LEFT_PAD - 60) / d)) });
  }, []);

  useEffect(() => {
    const onFit = (): void => fitZoom();
    const onZoomBy = (e: Event): void => setZoom(stateRef.current.pps * (e as CustomEvent<number>).detail);
    window.addEventListener('kinora:timeline-fit', onFit);
    window.addEventListener('kinora:timeline-zoom', onZoomBy);
    return () => {
      window.removeEventListener('kinora:timeline-fit', onFit);
      window.removeEventListener('kinora:timeline-zoom', onZoomBy);
    };
  }, [fitZoom, setZoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(stateRef.current.pps * Math.exp(-e.deltaY * 0.0022), e.clientX);
      } else if (e.shiftKey || el.scrollHeight <= el.clientHeight + 1) {
        // Horizontal scroll with Shift, or whenever there is nothing to scroll vertically.
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // -------------------------------------------------------------------------------------------
  // Coordinates
  // -------------------------------------------------------------------------------------------

  const locate = useCallback((clientX: number, clientY: number): { time: number; x: number; y: number; row: ReturnType<typeof rowAt> } => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const s = stateRef.current;
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop - RULER_H;
    return { time: Math.max(0, xToTime(x, s.pps)), x, y, row: rowAt(s.layout, y) };
  }, []);

  const edgeScroll = useCallback((clientX: number): void => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (clientX > rect.right - 36) el.scrollLeft += 18;
    else if (clientX < rect.left + 36) el.scrollLeft -= 18;
  }, []);

  // -------------------------------------------------------------------------------------------
  // Gestures
  // -------------------------------------------------------------------------------------------

  const scrub = (e: React.PointerEvent): void => {
    engine.pause();
    const seekTo = (ev: { clientX: number; shiftKey: boolean }): void => {
      const s = stateRef.current;
      let t = locate(ev.clientX, 0).time;
      if (ev.shiftKey) {
        const snap = bestSnap([t], snapPoints(s.project, new Set(), false), SNAP_PX / s.pps);
        if (snap) t += snap.delta;
      }
      engine.seek(t);
    };
    seekTo(e);
    trackPointer(e, {
      threshold: 0,
      move: (ev) => {
        edgeScroll(ev.clientX);
        seekTo(ev);
      },
      end: () => undefined,
    });
  };

  const startMove = (e: React.PointerEvent, clipId: ID): void => {
    const ui = useUI.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const wasSelected = ui.selection.includes(clipId);
    if (additive) ui.toggleSelect(clipId);
    else if (!wasSelected) ui.select([clipId]);

    const base = getProject();
    const locked = new Set(base.tracks.filter((t) => t.locked).map((t) => t.id));
    const ids = (useUI.getState().selection.includes(clipId) ? useUI.getState().selection : [clipId]).filter((id) => base.clips[id] && !locked.has(base.clips[id].trackId));
    if (ids.length === 0 || additive) return;
    const lead = base.clips[clipId];
    if (!lead || locked.has(lead.trackId)) return;

    const origin = new Map(ids.map((id) => [id, { start: base.clips[id].start, trackId: base.clips[id].trackId, duration: base.clips[id].duration }]));
    const moving = new Set(ids);
    const singleTrack = new Set(ids.map((id) => base.clips[id].trackId)).size === 1;
    const kind = clipKind(lead);
    const sameKind = ids.every((id) => clipKind(base.clips[id]) === kind);
    const grab = locate(e.clientX, e.clientY).time;
    const minStart = Math.min(...ids.map((id) => origin.get(id)!.start));
    const points = snapPoints(base, moving);
    let last = { dt: 0, trackId: lead.trackId };
    let zone: 'above' | 'below' | null = null;
    let started = false;

    trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        if (!started) {
          started = true;
          useProjectStore.getState().begin();
        }
        edgeScroll(ev.clientX);
        const s = stateRef.current;
        const pos = locate(ev.clientX, ev.clientY);
        let dt = Math.max(-minStart, pos.time - grab);
        let line: number | null = null;
        if (useUI.getState().snapping !== ev.altKey) {
          const edges = ids.flatMap((id) => [origin.get(id)!.start + dt, origin.get(id)!.start + origin.get(id)!.duration + dt]);
          const snap = bestSnap(edges, points, SNAP_PX / s.pps);
          if (snap && minStart + dt + snap.delta >= -1e-6) {
            dt += snap.delta;
            line = snap.at;
          }
        }
        dt = snapToFrame(lead.start + dt, s.fps) - lead.start;

        // Vertical moves change track only when the whole selection lives on one track.
        let targetId = lead.trackId;
        zone = null;
        if (singleTrack && sameKind) {
          const row = pos.row;
          if (row === 'above' || row === 'below') {
            if ((row === 'above' && kind === 'visual') || (row === 'below' && kind === 'audio')) zone = row;
          } else if (row && row.kind === kind && !s.project.tracks[row.index]?.locked) {
            targetId = row.id;
          }
        }
        const current = getProject();
        const fits = (d: number, track: ID): boolean => ids.every((id) => isFree(current, singleTrack ? track : origin.get(id)!.trackId, origin.get(id)!.start + d, origin.get(id)!.duration, moving));
        if (!fits(dt, targetId)) {
          // Slide to the closest free position for the dragged clip, if that works for all.
          const o = origin.get(clipId)!;
          const near = nearestFreeStart(current, singleTrack ? targetId : o.trackId, o.start + dt, o.duration, moving) - o.start;
          if (minStart + near >= -1e-6 && fits(near, targetId)) {
            dt = near;
            line = null;
          } else {
            dt = last.dt;
            targetId = last.trackId;
            line = null;
          }
        }
        last = { dt, trackId: targetId };
        setSnapLine(line);
        setNewTrackZone(zone);
        updateProject((p) => {
          for (const id of ids) {
            const c = p.clips[id];
            if (!c) continue;
            c.start = Math.max(0, origin.get(id)!.start + dt);
            if (singleTrack) c.trackId = targetId;
          }
        });
      },
      end: (_ev, moved, cancelled) => {
        setSnapLine(null);
        setNewTrackZone(null);
        const store = useProjectStore.getState();
        if (!started) {
          // A plain click on one clip of a multi-selection narrows the selection to it.
          if (!moved && !additive && wasSelected && useUI.getState().selection.length > 1) useUI.getState().select([clipId]);
          return;
        }
        if (cancelled) {
          store.cancel();
          return;
        }
        updateProject((p) => {
          if (zone) {
            const track = addTrack(p, kind);
            for (const id of ids) if (p.clips[id]) p.clips[id].trackId = track.id;
          }
          cleanupTransitions(p);
          pruneEmptyTracks(p);
        });
        store.commit();
      },
    });
  };

  const startTrim = (e: React.PointerEvent, clipId: ID, edge: 'l' | 'r'): void => {
    const base = getProject();
    const orig = base.clips[clipId];
    if (!orig) return;
    useUI.getState().select([clipId]);
    const f = base.settings.fps;
    const min = 1 / f;
    const { prev, next } = neighbours(base, orig);
    const origEnd = clipEnd(orig);
    const media = orig.type === 'video' || orig.type === 'audio' ? orig : null;
    const minStart = Math.max(prev ? clipEnd(prev) : 0, media ? orig.start - media.trimIn / media.speed : 0);
    const maxEnd = Math.min(next ? next.start : Infinity, orig.start + maxDurationFromSource(orig, base.assets));
    const points = snapPoints(base, new Set([clipId]));
    let started = false;
    engine.pause();

    trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        if (!started) {
          started = true;
          useProjectStore.getState().begin();
        }
        edgeScroll(ev.clientX);
        const s = stateRef.current;
        let t = locate(ev.clientX, ev.clientY).time;
        let line: number | null = null;
        if (useUI.getState().snapping !== ev.altKey) {
          const snap = bestSnap([t], points, SNAP_PX / s.pps);
          if (snap) {
            t += snap.delta;
            line = snap.at;
          }
        }
        t = snapToFrame(t, f);
        if (edge === 'l') {
          const start = Math.min(Math.max(t, minStart), origEnd - min);
          const cut = start - orig.start;
          updateProject((p) => {
            const c = p.clips[clipId];
            if (!c) return;
            c.start = start;
            c.duration = origEnd - start;
            if ((c.type === 'video' || c.type === 'audio') && media) c.trimIn = Math.max(0, media.trimIn + cut * media.speed);
            if (orig.keyframes) {
              // Keyframes stay glued to the picture, not to the clip edge.
              c.keyframes = {};
              for (const [prop, frames] of Object.entries(orig.keyframes)) {
                if (frames) (c.keyframes as Record<string, typeof frames>)[prop] = frames.map((k) => ({ ...k, t: Math.max(0, k.t - cut) }));
              }
            }
          });
          setSnapLine(line !== null && Math.abs(line - start) < 1e-6 ? line : null);
          engine.seek(start);
        } else {
          const end = Math.max(orig.start + min, Math.min(t, maxEnd));
          updateProject((p) => {
            const c = p.clips[clipId];
            if (c) c.duration = end - orig.start;
          });
          setSnapLine(line !== null && Math.abs(line - end) < 1e-6 ? line : null);
          engine.seek(Math.max(orig.start, end - min));
        }
      },
      end: (_ev, _moved, cancelled) => {
        setSnapLine(null);
        if (!started) return;
        const store = useProjectStore.getState();
        if (cancelled) {
          store.cancel();
          return;
        }
        updateProject((p) => cleanupTransitions(p));
        store.commit();
      },
    });
  };

  const startMarquee = (e: React.PointerEvent): void => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX - rect.left + el.scrollLeft;
    const y0 = e.clientY - rect.top + el.scrollTop;
    const additive = e.shiftKey || e.ctrlKey;
    const before = additive ? useUI.getState().selection : [];
    trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        const s = stateRef.current;
        const x1 = ev.clientX - rect.left + el.scrollLeft;
        const y1 = ev.clientY - rect.top + el.scrollTop;
        const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        setMarquee(box);
        const hits: ID[] = [];
        for (const clip of Object.values(s.project.clips)) {
          const row = s.layout.byId.get(clip.trackId);
          if (!row) continue;
          const cx0 = timeToX(clip.start, s.pps);
          const cx1 = timeToX(clipEnd(clip), s.pps);
          const cy0 = RULER_H + row.top;
          if (cx1 > box.x && cx0 < box.x + box.w && cy0 + row.height > box.y && cy0 < box.y + box.h) hits.push(clip.id);
        }
        useUI.getState().select([...new Set([...before, ...hits])]);
      },
      end: (ev, moved) => {
        setMarquee(null);
        if (!moved) {
          // A plain click on empty space clears the selection and moves the playhead there.
          if (!additive) useUI.getState().clearSelection();
          engine.pause();
          engine.seek(locate(ev.clientX, ev.clientY).time);
        }
      },
    });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.tl-ruler')) {
      scrub(e);
      return;
    }
    const trans = target.closest<HTMLElement>('[data-transition]');
    if (trans) {
      useUI.getState().selectTransition(trans.dataset.transition!);
      return;
    }
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    if (clipEl) {
      const id = clipEl.dataset.clip!;
      const clip = getProject().clips[id];
      if (!clip) return;
      const track = getProject().tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;
      if (useUI.getState().tool === 'blade') {
        const s = stateRef.current;
        let t = locate(e.clientX, e.clientY).time;
        if (Math.abs(t - engine.time) < SNAP_PX / s.pps) t = engine.time;
        splitClip(id, t);
        return;
      }
      const handle = target.dataset.handle as 'l' | 'r' | undefined;
      if (handle) startTrim(e, id, handle);
      else startMove(e, id);
      return;
    }
    startMarquee(e);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const blade = bladeRef.current;
    if (!blade) return;
    if (tool !== 'blade') {
      blade.style.display = 'none';
      return;
    }
    const pos = locate(e.clientX, e.clientY);
    blade.style.display = pos.y > 0 ? 'block' : 'none';
    blade.style.transform = `translateX(${timeToX(snapToFrame(pos.time, fps), pps)}px)`;
  };

  const onContextMenu = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    const trans = target.closest<HTMLElement>('[data-transition]');
    if (trans) {
      const id = trans.dataset.transition!;
      useUI.getState().selectTransition(id);
      openContextMenu(e, [{ label: 'Remove transition', icon: <Trash2 size={14} />, danger: true, run: () => deleteSelection() }]);
      return;
    }
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    const pos = locate(e.clientX, e.clientY);
    if (clipEl) {
      const id = clipEl.dataset.clip!;
      const ui = useUI.getState();
      if (!ui.selection.includes(id)) ui.select([id]);
      const clip = getProject().clips[id];
      const items: MenuItem[] = [
        { label: 'Split at playhead', icon: <SquareSplitHorizontal size={14} />, shortcut: 'S', run: splitAtPlayhead },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: 'Ctrl+D', run: duplicateSelection },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', run: cutSelection },
        { label: 'Copy', shortcut: 'Ctrl+C', run: () => void copySelection() },
        { label: 'Paste at playhead', shortcut: 'Ctrl+V', disabled: !ui.clipboard, run: paste },
        ...(clip?.type === 'video' ? [{ type: 'separator' as const }, { label: 'Detach audio', run: detachAudioFromSelection }] : []),
        { type: 'separator' },
        { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, run: () => deleteSelection(false) },
        { label: 'Delete and close gap', shortcut: 'Shift+Del', danger: true, run: () => deleteSelection(true) },
      ];
      openContextMenu(e, items);
      return;
    }
    const row = typeof pos.row === 'object' && pos.row ? pos.row : null;
    openContextMenu(e, [
      { label: 'Paste here', shortcut: 'Ctrl+V', disabled: !useUI.getState().clipboard, run: () => { engine.seek(pos.time); paste(); } },
      { label: 'Add marker here', icon: <Bookmark size={14} />, run: () => { engine.seek(pos.time); addMarker(); } },
      { type: 'separator' },
      { label: 'Add video track', icon: <Plus size={14} />, run: () => addTrackOfKind('visual') },
      { label: 'Add audio track', icon: <Plus size={14} />, run: () => addTrackOfKind('audio') },
      ...(row
        ? [
            { type: 'separator' as const },
            { label: 'Select all clips on this track', run: () => useUI.getState().select((getIndex(getProject()).byTrack.get(row.id) ?? []).map((c) => c.id)) },
            { label: 'Delete track', danger: true, run: () => updateProject((p) => removeTrack(p, row.id)) },
          ]
        : []),
    ]);
  };

  // -------------------------------------------------------------------------------------------
  // Library drops
  // -------------------------------------------------------------------------------------------

  const planDrop = useCallback(
    (payload: DragPayload, clientX: number, clientY: number): { plan: DropPlan; hint: Hint } | null => {
      const s = stateRef.current;
      const pos = locate(clientX, clientY);
      const row = typeof pos.row === 'object' && pos.row ? pos.row : null;
      const clipUnder = (): Clip | null => {
        if (!row) return null;
        return (getIndex(s.project).byTrack.get(row.id) ?? []).find((c) => pos.time >= c.start && pos.time < clipEnd(c)) ?? null;
      };

      if (payload.kind === 'transition') {
        // Nearest cut on the hovered track.
        let best: { fromId: ID; toId: ID; time: number; row: TrackRow } | null = null;
        const rows = row ? [row] : s.layout.rows.filter((r) => r.kind === 'visual');
        for (const r of rows) {
          const clips = getIndex(s.project).byTrack.get(r.id) ?? [];
          for (let i = 0; i + 1 < clips.length; i++) {
            if (Math.abs(clipEnd(clips[i]) - clips[i + 1].start) > 1e-3) continue;
            const cut = clips[i + 1].start;
            if (Math.abs(cut - pos.time) * s.pps > 70) continue;
            if (!best || Math.abs(cut - pos.time) < Math.abs(best.time - pos.time)) best = { fromId: clips[i].id, toId: clips[i + 1].id, time: cut, row: r };
          }
        }
        if (!best) return null;
        return { plan: { type: 'cut', ...best }, hint: { ghost: null, clipId: null, cut: { x: timeToX(best.time, s.pps), top: RULER_H + best.row.top, height: best.row.height } } };
      }

      const under = clipUnder();
      if ((payload.kind === 'effect' || payload.kind === 'filter') && under && under.type !== 'audio') {
        return { plan: { type: 'onClip', clipId: under.id }, hint: { ghost: null, clipId: under.id, cut: null } };
      }
      if (payload.kind === 'asset' && under && under.type === 'shape' && under.shape.slot && s.project.assets[payload.assetId]?.kind !== 'audio') {
        return { plan: { type: 'onClip', clipId: under.id }, hint: { ghost: null, clipId: under.id, cut: null } };
      }

      const dur = payloadDuration(payload, s.project);
      let time = pos.time;
      const snap = useUI.getState().snapping ? bestSnap([time, time + dur], snapPoints(s.project, new Set()), SNAP_PX / s.pps) : null;
      if (snap && time + snap.delta >= 0) time += snap.delta;
      time = snapToFrame(Math.max(0, time), s.fps);

      if (payload.kind === 'template') {
        return {
          plan: { type: 'template', time, duration: dur },
          hint: { ghost: { left: timeToX(time, s.pps), width: dur * s.pps, top: RULER_H + 2, height: TOP_ZONE - 4, label: 'New tracks' }, clipId: null, cut: null },
        };
      }

      const kind = payloadKind(payload, s.project);
      const usable = row && row.kind === kind && !s.project.tracks[row.index]?.locked ? row : null;
      if (usable) {
        const start = nearestFreeStart(s.project, usable.id, time, dur);
        return {
          plan: { type: 'clip', kind, time: start, duration: dur, row: usable, zone: null },
          hint: { ghost: { left: timeToX(start, s.pps), width: dur * s.pps, top: RULER_H + usable.top, height: usable.height }, clipId: null, cut: null },
        };
      }
      const zone = kind === 'visual' ? 'above' : 'below';
      const top = zone === 'above' ? RULER_H + 2 : RULER_H + s.layout.height - 34;
      return {
        plan: { type: 'clip', kind, time, duration: dur, row: null, zone },
        hint: { ghost: { left: timeToX(time, s.pps), width: dur * s.pps, top, height: zone === 'above' ? TOP_ZONE - 4 : TRACK_HEIGHT.audio - 14, label: 'New track' }, clipId: null, cut: null },
      };
    },
    [locate],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    return registerDropTarget(el, {
      over: (payload, x, y) => {
        const r = planDrop(payload, x, y);
        setHint(r ? r.hint : NO_HINT);
        return !!r;
      },
      leave: () => setHint(NO_HINT),
      drop: (payload, x, y) => {
        setHint(NO_HINT);
        const r = planDrop(payload, x, y);
        if (!r) return;
        const { plan } = r;
        const project = getProject();
        if (plan.type === 'cut') {
          if (payload.kind === 'transition') addTransition(payload.type, plan.fromId, plan.toId);
          return;
        }
        if (plan.type === 'onClip') {
          if (payload.kind === 'effect') applyEffect(payload.effectId, plan.clipId);
          else if (payload.kind === 'filter') applyFilter(payload.filterId, plan.clipId);
          else if (payload.kind === 'asset' && project.assets[payload.assetId]) fillSlotWith(plan.clipId, project.assets[payload.assetId]);
          return;
        }
        if (plan.type === 'template') {
          if (payload.kind === 'template') applyTemplate(payload.variation, plan.time);
          return;
        }
        const where: Placement = plan.row ? { time: plan.time, trackId: plan.row.id } : { time: plan.time, newTrack: true };
        switch (payload.kind) {
          case 'asset':
            if (project.assets[payload.assetId]) addAsset(project.assets[payload.assetId], where);
            break;
          case 'text':
            addText(payload.presetId, where);
            break;
          case 'sticker':
            addSticker(payload.stickerId, where);
            break;
          case 'shape':
            addShape(payload.shape, where);
            break;
          case 'generator':
            addGenerator(payload.generatorId, where);
            break;
          case 'adjustment':
            addAdjustment(where);
            break;
          case 'effect':
            addAdjustment(where, { effectId: payload.effectId });
            break;
          case 'filter':
            addAdjustment(where, { filterId: payload.filterId });
            break;
          case 'sound':
            void addSound(payload.soundId, where);
            break;
          default:
        }
      },
    });
  }, [planDrop]);

  // -------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------

  const toggleTrack = (id: ID, key: 'muted' | 'hidden' | 'locked'): void =>
    updateProject((p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) t[key] = !t[key];
    });

  const lo = view.left - 500;
  const hi = view.left + view.width + 500;
  const empty = Object.keys(project.clips).length === 0;

  return (
    <section className={`timeline ${tool === 'blade' ? 'is-blade' : ''}`} data-timeline>
      <Toolbar onZoom={(v) => setZoom(v)} onFit={fitZoom} />
      <div className="tl-body" ref={bodyRef}>
        <div className="tl-headers" style={{ width: HEADER_W }}>
          <div className="tl-headers__corner" style={{ height: RULER_H }}>
            <button type="button" className="icon-btn icon-btn--sm" title="Add video track" onClick={() => addTrackOfKind('visual')}>
              <Plus size={13} />
            </button>
            <span>Tracks</span>
          </div>
          <div className="tl-headers__list" ref={headersRef} style={{ height: layout.height }}>
            {layout.rows.map((row) => {
              const track = project.tracks[row.index];
              if (!track) return null;
              return (
                <div
                  key={row.id}
                  className={`tl-header tl-header--${row.kind} ${track.locked ? 'is-locked' : ''}`}
                  style={{ top: row.top, height: row.height }}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      { label: 'Rename track', run: () => setRenaming(track.id) },
                      { label: row.kind === 'visual' ? 'Add video track above' : 'Add audio track below', icon: <Plus size={14} />, run: () => updateProject((p) => void addTrack(p, row.kind, { trackId: row.id, where: row.kind === 'visual' ? 'above' : 'below' })) },
                      { type: 'separator' },
                      { label: 'Delete track', icon: <Trash2 size={14} />, danger: true, run: () => updateProject((p) => removeTrack(p, row.id)) },
                    ])
                  }
                >
                  {renaming === track.id ? (
                    <input
                      autoFocus
                      className="input tl-header__rename"
                      defaultValue={track.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name) updateProject((p) => void (p.tracks.find((t) => t.id === track.id)!.name = name.slice(0, 24)));
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                        e.stopPropagation();
                      }}
                    />
                  ) : (
                    <span className="tl-header__name truncate" onDoubleClick={() => setRenaming(track.id)} title="Double-click to rename">
                      {track.name}
                    </span>
                  )}
                  <span className="tl-header__btns">
                    {row.kind === 'visual' && (
                      <button type="button" className={`icon-btn icon-btn--sm ${track.hidden ? 'is-active' : ''}`} title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => toggleTrack(track.id, 'hidden')}>
                        {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    )}
                    <button type="button" className={`icon-btn icon-btn--sm ${track.muted ? 'is-active' : ''}`} title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggleTrack(track.id, 'muted')}>
                      {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                    <button type="button" className={`icon-btn icon-btn--sm ${track.locked ? 'is-active' : ''}`} title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggleTrack(track.id, 'locked')}>
                      {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="tl-scroll" ref={scrollRef} onScroll={syncView}>
          <div className="tl-content" style={{ width: contentW, height: contentH }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => bladeRef.current && (bladeRef.current.style.display = 'none')} onContextMenu={onContextMenu}>
            <canvas ref={rulerRef} className="tl-ruler" style={{ width: view.width, height: RULER_H }} />

            {newTrackZone && <div className={`tl-zone tl-zone--${newTrackZone}`} style={newTrackZone === 'above' ? { top: RULER_H + 2, height: TOP_ZONE - 4 } : { top: RULER_H + layout.height - 36, height: 30 }}>New track</div>}

            {layout.rows.map((row) => {
              const track = project.tracks[row.index];
              if (!track) return null;
              const clips = idx.byTrack.get(row.id) ?? [];
              return (
                <div key={row.id} className={`tl-track tl-track--${row.kind} ${track.locked ? 'is-locked' : ''} ${track.hidden ? 'is-hidden' : ''}`} style={{ top: RULER_H + row.top, height: row.height }}>
                  {clips.map((clip) => {
                    const x0 = timeToX(clip.start, pps);
                    const x1 = timeToX(clipEnd(clip), pps);
                    if (x1 < lo || x0 > hi) return null;
                    const asset = 'assetId' in clip ? project.assets[clip.assetId] : undefined;
                    const rt = asset ? runtime[asset.id] : undefined;
                    return (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        asset={asset}
                        pps={pps}
                        viewLeft={view.left}
                        viewWidth={view.width}
                        height={row.height}
                        selected={selectedSet.has(clip.id)}
                        missing={rt?.status === 'missing'}
                        locked={track.locked}
                        dimmed={track.hidden || (row.kind === 'audio' && track.muted)}
                        dropTarget={hint.clipId === clip.id}
                        thumb={rt?.thumb ?? null}
                      />
                    );
                  })}
                  {clips.map((clip) => {
                    const tr = idx.transIn.get(clip.id);
                    if (!tr) return null;
                    const w = Math.max(22, tr.duration * pps);
                    const x = timeToX(clip.start, pps);
                    if (x < lo || x > hi) return null;
                    return (
                      <button key={tr.id} type="button" className={`tl-trans ${selectedTransition === tr.id ? 'is-selected' : ''}`} data-transition={tr.id} style={{ left: x - w / 2, width: w }} title="Transition — click to edit, Del to remove">
                        <Blend size={12} />
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {hint.ghost && (
              <div className="tl-ghost" style={{ left: hint.ghost.left, width: Math.max(4, hint.ghost.width), top: hint.ghost.top, height: hint.ghost.height }}>
                {hint.ghost.label && <span>{hint.ghost.label}</span>}
              </div>
            )}
            {hint.cut && <div className="tl-cut" style={{ left: hint.cut.x, top: hint.cut.top, height: hint.cut.height }} />}
            {snapLine !== null && <div className="tl-snap" style={{ left: timeToX(snapLine, pps), top: RULER_H, height: layout.height }} />}
            {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
            <div ref={bladeRef} className="tl-blade" style={{ top: RULER_H, height: layout.height, display: 'none' }} />
            <div ref={playheadRef} className={`tl-playhead ${playing ? 'is-playing' : ''}`} style={{ height: contentH }} />

            {empty && (
              <div className="tl-empty" style={{ top: RULER_H + TOP_ZONE, width: view.width }}>
                Drag media, templates and text here — or just click them in the library.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
