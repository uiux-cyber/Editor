import {
  Blend,
  Bookmark,
  Copy,
  Eye,
  EyeOff,
  Group,
  Link2,
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
  Ungroup,
  Unlink2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { adjacentAfter, adjacentBefore, expandSelection, hasTrimIn, insertOnMain, mainInsertionCut, relocateOverlaps } from '@/core/editing';
import {
  addTrack,
  cleanupTransitions,
  clipKind,
  getIndex,
  isFree,
  isMagneticTrack,
  mainTrackId,
  nearestFreeStart,
  pruneEmptyTracks,
  removeTrack,
} from '@/core/project';
import { clipEnd, formatTimecode, snapToFrame } from '@/core/time';
import { maxStartExtension, retimeClip } from '@/core/timemap';
import type { Clip, ID, Project, TrackKind } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';
import { useAssetRuntime } from '@/engine/media/assets';
import { getSound, getTemplate } from '@/library';
import { soundAssetDuration } from '@/engine/media/sounds';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
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
  groupSelection,
  linkSelection,
  paste,
  redo,
  setTrackHeight,
  splitAtPlayhead,
  splitClip,
  toggleMagneticMain,
  undo,
  ungroupSelection,
  unlinkSelection,
  type Placement,
} from '../actions';
import { useElementSize } from '../common/controls';
import { openContextMenu, type MenuItem } from '../common/overlays';
import { registerDropTarget, type DragPayload } from '../dnd';
import { InOutMarks } from '../export/InOutMarks';
import { CompoundBar, onTimelineDoubleClick, timeMenuItems } from '../time/CompoundBar';
import { cachedThemeColor, useTheme } from '../theme';
import { SpeechTimelineOverlay } from '../speech/TimelineOverlay';
import { ClipView } from './ClipView';
import { EditReadout, HistoryButton, MagneticButton, TrimToolButtons } from './EditToolbar';
import { editedIds, installEditCursors, startEditGesture, useEditReadout, type GestureContext } from './editGestures';
import { SNAP_PX, bestSnap, snapPoints, trackPointer } from './gestureUtils';
import { HEADER_W, LEFT_PAD, MAX_PPS, MIN_PPS, RIGHT_PAD, RULER_H, TOP_ZONE, TRACK_HEIGHT, TRACK_SIZES, clampTrackHeight, layoutTracks, rowAt, rulerStep, timeToX, trackHeight, xToTime, type Layout, type TrackRow } from './geometry';
import { HistoryPanel } from './HistoryPanel';
import { MainMagnetIcon } from './icons';
import { TrimMonitor } from './TrimMonitor';
import './timeline-editing.css';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

installEditCursors();

/** Light colours that read on every clip colour; each group gets a stable one. */
const GROUP_COLORS = ['#fde68a', '#a5f3fc', '#f9a8d4', '#bbf7d0', '#ddd6fe', '#fecaca', '#bae6fd', '#ffffff'];

function groupColor(groupId: ID): string {
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

/** Source timecode at a clip's first ('in') or last ('out') frame. */
function sourceTc(clip: Clip, which: 'in' | 'out', fps: number): string {
  const rate = clip.type === 'video' || clip.type === 'audio' ? clip.speed : 1;
  const first = hasTrimIn(clip) ? clip.trimIn : 0;
  const t = which === 'in' ? first : first + Math.max(0, clip.duration - 1 / fps) * rate;
  return formatTimecode(t, fps);
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
  ctx.fillStyle = cachedThemeColor('--ruler-bg', '#0d0f13'); // theme-aware (ui/theme.ts)
  ctx.fillRect(0, 0, width, RULER_H);

  // Shade the area past the end of the project.
  const endX = timeToX(duration, pps) - scrollLeft;
  if (duration > 0 && endX < width) {
    ctx.fillStyle = cachedThemeColor('--ruler-shade', 'rgba(255,255,255,0.018)');
    ctx.fillRect(Math.max(0, endX), 0, width - Math.max(0, endX), RULER_H);
  }

  const { major, minor, frames } = rulerStep(pps, fps);
  const t0 = Math.max(0, xToTime(scrollLeft, pps));
  const t1 = xToTime(scrollLeft + width, pps);
  ctx.font = '500 10.5px "Inter Variable", "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';

  ctx.strokeStyle = cachedThemeColor('--ruler-tick', 'rgba(255,255,255,0.14)');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = Math.floor(t0 / minor); i * minor <= t1; i++) {
    const t = i * minor;
    const x = Math.round(timeToX(t, pps) - scrollLeft) + 0.5;
    ctx.moveTo(x, RULER_H - 5);
    ctx.lineTo(x, RULER_H);
  }
  ctx.stroke();

  ctx.strokeStyle = cachedThemeColor('--ruler-tick-major', 'rgba(255,255,255,0.3)');
  ctx.fillStyle = cachedThemeColor('--ruler-text', '#8f97a8');
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
    ctx.fillStyle = cachedThemeColor('--playhead', '#ffffff');
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px + 6, 9);
    ctx.lineTo(px, 16);
    ctx.lineTo(px - 6, 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = cachedThemeColor('--ruler-line', 'rgba(255,255,255,0.07)');
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
        <button type="button" data-tool="select" className={`icon-btn ${tool === 'select' ? 'is-active' : ''}`} title="Select tool (V) — Shift-drag a clip edge to ripple trim, Alt-click to pick one clip of a group or link" onClick={() => set({ tool: 'select' })}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" data-tool="blade" className={`icon-btn ${tool === 'blade' ? 'is-active' : ''}`} title="Blade tool — click a clip to cut it (C)" onClick={() => set({ tool: 'blade' })}>
          <Scissors size={15} />
        </button>
        <TrimToolButtons />
        <span className="vdivider" />
        <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={15} />
        </button>
        <HistoryButton />
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
        <MagneticButton />
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
  /** Insertion point on the magnetic main track while a clip is dragged onto it. */
  const [insertMark, setInsertMark] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const layout = useMemo(() => layoutTracks(project.tracks), [project.tracks]);
  const mainId = project.magneticMain ? mainTrackId(project) : null;
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

  // The ruler is a canvas: repaint it when the colour theme changes.
  useEffect(() => useTheme.subscribe((s, prev) => s.resolved !== prev.resolved && requestAnimationFrame(paintRuler)), [paintRuler]);

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
    const base = getProject();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    // A grouped or linked clip brings its group and partners along; Alt+click takes just the one.
    const unit = e.altKey ? [clipId] : expandSelection(base, [clipId]);
    const wasSelected = ui.selection.includes(clipId);
    if (additive) {
      const sel = new Set(ui.selection);
      for (const id of unit) {
        if (wasSelected) sel.delete(id);
        else sel.add(id);
      }
      ui.select([...sel]);
    } else if (!wasSelected) ui.select(unit);
    // A plain click on a clip picked alone earlier (Alt) takes its group / partners again.
    else if (unit.some((id) => !ui.selection.includes(id))) ui.select([...new Set([...ui.selection, ...unit])]);

    const locked = new Set(base.tracks.filter((t) => t.locked).map((t) => t.id));
    const ids = (useUI.getState().selection.includes(clipId) ? useUI.getState().selection : [clipId]).filter((id) => base.clips[id] && !locked.has(base.clips[id].trackId));
    if (ids.length === 0 || additive) return;
    const lead = base.clips[clipId];
    if (!lead || locked.has(lead.trackId)) return;

    const origin = new Map(ids.map((id) => [id, { start: base.clips[id].start, trackId: base.clips[id].trackId, duration: base.clips[id].duration }]));
    const moving = new Set(ids);
    const kind = clipKind(lead);
    // Vertical moves take the clips on the lead's track along. That needs every selected clip of
    // the same kind to be on that track; linked sound on its own track simply follows in time.
    const canChangeTrack = ids.every((id) => clipKind(base.clips[id]) !== kind || origin.get(id)!.trackId === lead.trackId);
    const finalTrack = (id: ID, target: ID): ID => (canChangeTrack && origin.get(id)!.trackId === lead.trackId ? target : origin.get(id)!.trackId);
    const magneticId = base.magneticMain ? mainTrackId(base) : null;
    const grab = locate(e.clientX, e.clientY).time;
    const minStart = Math.min(...ids.map((id) => origin.get(id)!.start));
    const points = snapPoints(base, moving);
    const label = ids.length > 1 ? 'Move clips' : 'Move clip';
    let last = { dt: 0, trackId: lead.trackId };
    let zone: 'above' | 'below' | null = null;
    let started = false;

    trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        const store = useProjectStore.getState();
        if (!started) {
          started = true;
          store.begin(label);
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

        let targetId = lead.trackId;
        zone = null;
        if (canChangeTrack) {
          const row = pos.row;
          if (row === 'above' || row === 'below') {
            if ((row === 'above' && kind === 'visual') || (row === 'below' && kind === 'audio')) zone = row;
          } else if (row && row.kind === kind && !s.project.tracks[row.index]?.locked) {
            targetId = row.id;
          }
        }

        // Magnetic main track: the clips going onto it are inserted as one block at the nearest
        // cut and later clips make room; the rest of the selection follows by the same amount.
        const onMain = magneticId && !zone ? ids.filter((id) => finalTrack(id, targetId) === magneticId) : [];
        let applied = dt;
        if (onMain.length) {
          const blockStart = Math.min(...onMain.map((id) => origin.get(id)!.start));
          store.updateFromBase((p) => {
            applied = insertOnMain(p, onMain, Math.max(0, blockStart + dt), moving) - blockStart;
            const others = ids.filter((id) => !onMain.includes(id));
            for (const id of others) {
              const c = p.clips[id];
              c.start = Math.max(0, origin.get(id)!.start + applied);
              c.trackId = finalTrack(id, targetId);
            }
            relocateOverlaps(p, others);
          });
          last = { dt, trackId: targetId };
          setInsertMark(blockStart + applied);
          line = null;
        } else {
          setInsertMark(null);
          const fits = (d: number, track: ID): boolean =>
            ids.every((id) => finalTrack(id, track) === magneticId || isFree(base, finalTrack(id, track), origin.get(id)!.start + d, origin.get(id)!.duration, moving));
          if (!fits(dt, targetId)) {
            // Slide to the closest free position for the dragged clip, if that works for all.
            const o = origin.get(clipId)!;
            const near = nearestFreeStart(base, finalTrack(clipId, targetId), o.start + dt, o.duration, moving) - o.start;
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
          applied = dt;
          store.updateFromBase((p) => {
            for (const id of ids) {
              const c = p.clips[id];
              if (!c) continue;
              c.start = Math.max(0, origin.get(id)!.start + dt);
              c.trackId = finalTrack(id, targetId);
            }
          });
        }
        setSnapLine(line);
        setNewTrackZone(zone);
        useEditReadout.setState({ readout: { x: ev.clientX, y: ev.clientY, title: label, delta: applied, fps: s.fps, limited: false } });
      },
      end: (_ev, moved, cancelled) => {
        setSnapLine(null);
        setNewTrackZone(null);
        setInsertMark(null);
        useEditReadout.setState({ readout: null });
        const store = useProjectStore.getState();
        if (!started) {
          // A plain click on one clip of a multi-selection narrows the selection to it (and its
          // group / linked partners).
          if (!moved && !additive && wasSelected && useUI.getState().selection.length > unit.length) useUI.getState().select(unit);
          return;
        }
        if (cancelled) {
          store.cancel();
          return;
        }
        updateProject((p) => {
          if (zone) {
            const track = addTrack(p, kind);
            for (const id of ids) if (p.clips[id] && (!canChangeTrack || origin.get(id)!.trackId === lead.trackId)) p.clips[id].trackId = track.id;
          }
          cleanupTransitions(p);
          pruneEmptyTracks(p);
        });
        store.commit(label);
      },
    });
  };

  // Trim modes ----------------------------------------------------------------------------------

  const gestureCtx: GestureContext = {
    timeAt: (x, y) => locate(x, y).time,
    edgeScroll,
    setSnapLine,
    pps: () => stateRef.current.pps,
  };

  /** Drag a clip edge: a plain trim, or a ripple trim (Ripple tool, Shift, or the main track). */
  const startTrim = (e: React.PointerEvent, clipId: ID, edge: 'l' | 'r', ripple: boolean): void => {
    const base = getProject();
    const orig = base.clips[clipId];
    if (!orig) return;
    const linked = !e.altKey;
    const ids = editedIds(base, clipId, linked);
    useUI.getState().select(ids);
    const f = base.settings.fps;
    const rippling = ripple || isMagneticTrack(base, orig.trackId);
    startEditGesture(e, gestureCtx, {
      op: { kind: 'trim', clipId, edge, ripple: rippling, linked },
      label: rippling ? 'Ripple trim' : 'Trim',
      snapEdges: [edge === 'l' ? orig.start : clipEnd(orig)],
      exclude: ids,
      seek: (_d, p) => {
        const c = p.clips[clipId];
        if (!c) return null;
        return edge === 'l' ? c.start : Math.max(c.start, clipEnd(c) - 1 / f);
      },
      note: (_d, p) => (p.clips[clipId] ? `Length ${formatTimecode(p.clips[clipId].duration, f)}` : undefined),
    });
  };

  /** Roll the cut between two adjacent clips. */
  const startRoll = (e: React.PointerEvent, leftId: ID, rightId: ID): void => {
    const base = getProject();
    const left = base.clips[leftId];
    const right = base.clips[rightId];
    if (!left || !right) return;
    const linked = !e.altKey;
    const ids = [...new Set([...editedIds(base, leftId, linked), ...editedIds(base, rightId, linked)])];
    useUI.getState().select(ids);
    const f = base.settings.fps;
    const cut = right.start;
    startEditGesture(e, gestureCtx, {
      op: { kind: 'roll', leftId, rightId, linked },
      label: 'Roll edit',
      snapEdges: [cut],
      exclude: ids,
      seek: (d) => cut + d,
      note: (d) => `Cut at ${formatTimecode(cut + d, f)}`,
      monitor:
        left.type === 'audio'
          ? undefined
          : (_d, p) => {
              const l = p.clips[leftId];
              const r = p.clips[rightId];
              if (!l || !r) return null;
              return {
                mode: 'roll',
                left: { clipId: leftId, time: clipEnd(l) - 1 / f, title: 'Outgoing', detail: `Out ${sourceTc(l, 'out', f)}` },
                right: { clipId: rightId, time: r.start, title: 'Incoming', detail: `In ${sourceTc(r, 'in', f)}` },
              };
            },
    });
  };

  /** Slip a media clip's in / out points; its place and length stay. */
  const startSlip = (e: React.PointerEvent, clipId: ID): void => {
    const base = getProject();
    const clip = base.clips[clipId];
    if (!clip) return;
    if (!hasTrimIn(clip)) {
      useUI.getState().select([clipId]);
      toast('info', 'Nothing to slip in this clip', 'Slip changes which part of a video or audio clip plays. Use it on a video or audio clip.');
      return;
    }
    const linked = !e.altKey;
    const ids = editedIds(base, clipId, linked);
    useUI.getState().select(ids);
    const f = base.settings.fps;
    startEditGesture(e, gestureCtx, {
      op: { kind: 'slip', clipId, linked },
      label: 'Slip',
      snapEdges: [],
      exclude: ids,
      note: (_d, p) => (p.clips[clipId] ? `In ${sourceTc(p.clips[clipId], 'in', f)} · Out ${sourceTc(p.clips[clipId], 'out', f)}` : undefined),
      monitor:
        clip.type === 'audio'
          ? undefined
          : (_d, p) => {
              const c = p.clips[clipId];
              if (!c) return null;
              return {
                mode: 'slip',
                left: { clipId, time: c.start, title: 'In', detail: sourceTc(c, 'in', f) },
                right: { clipId, time: clipEnd(c) - 1 / f, title: 'Out', detail: sourceTc(c, 'out', f) },
              };
            },
    });
  };

  /** Slide a clip between its neighbours, which trim to compensate. */
  const startSlide = (e: React.PointerEvent, clipId: ID): void => {
    const base = getProject();
    const clip = base.clips[clipId];
    if (!clip) return;
    const linked = !e.altKey;
    const ids = editedIds(base, clipId, linked);
    const touching = ids.flatMap((id) => [adjacentBefore(base, base.clips[id]), adjacentAfter(base, base.clips[id])]).flatMap((c) => (c ? [c.id] : []));
    useUI.getState().select(ids);
    const f = base.settings.fps;
    startEditGesture(e, gestureCtx, {
      op: { kind: 'slide', clipId, linked },
      label: 'Slide',
      snapEdges: [clip.start, clipEnd(clip)],
      exclude: [...ids, ...touching],
      seek: (_d, p) => p.clips[clipId]?.start ?? null,
      note: (_d, p) => (p.clips[clipId] ? `Starts at ${formatTimecode(p.clips[clipId].start, f)}` : undefined),
    });
  };

  /** Drag the bottom edge of a track header to resize the track. */
  const startTrackResize = (e: React.PointerEvent, trackId: ID): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const track = getProject().tracks.find((t) => t.id === trackId);
    if (!track) return;
    const h0 = trackHeight(track);
    const y0 = e.clientY;
    let started = false;
    trackPointer(e, {
      threshold: 1,
      move: (ev, moved) => {
        if (!moved) return;
        const store = useProjectStore.getState();
        if (!started) {
          started = true;
          store.begin('Resize track');
        }
        const h = clampTrackHeight(track.kind, h0 + ev.clientY - y0);
        store.updateFromBase((p) => {
          const t = p.tracks.find((x) => x.id === trackId);
          if (t) t.height = h;
        });
      },
      end: (_ev, _moved, cancelled) => {
        if (!started) return;
        const store = useProjectStore.getState();
        if (cancelled) store.cancel();
        else store.commit('Resize track');
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
    // Boxed clips bring their groups and linked partners (Alt: only what the box touches).
    const related = !e.altKey;
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
        useUI.getState().select([...new Set([...before, ...(related ? expandSelection(s.project, hits) : hits)])]);
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
      const currentTool = useUI.getState().tool;
      if (currentTool === 'blade') {
        const s = stateRef.current;
        let t = locate(e.clientX, e.clientY).time;
        if (Math.abs(t - engine.time) < SNAP_PX / s.pps) t = engine.time;
        // Linked partners are cut too; Alt cuts only the clicked clip.
        splitClip(id, t, !e.altKey);
        return;
      }
      const handle = target.dataset.handle as 'l' | 'r' | undefined;
      if (handle) {
        if (currentTool === 'roll') {
          const p = getProject();
          const other = handle === 'r' ? adjacentAfter(p, clip) : adjacentBefore(p, clip);
          if (other) {
            startRoll(e, handle === 'r' ? id : other.id, handle === 'r' ? other.id : id);
            return;
          }
        }
        startTrim(e, id, handle, currentTool === 'ripple' || e.shiftKey);
      } else if (currentTool === 'slip') startSlip(e, id);
      else if (currentTool === 'slide') startSlide(e, id);
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
      if (!ui.selection.includes(id)) ui.select(e.altKey ? [id] : expandSelection(getProject(), [id]));
      const clip = getProject().clips[id];
      const sel = useUI.getState().selection.map((x) => getProject().clips[x]).filter(Boolean);
      const items: MenuItem[] = [
        { label: 'Split at playhead', icon: <SquareSplitHorizontal size={14} />, shortcut: 'S', run: splitAtPlayhead },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: 'Ctrl+D', run: duplicateSelection },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', run: cutSelection },
        { label: 'Copy', shortcut: 'Ctrl+C', run: () => void copySelection() },
        { label: 'Paste at playhead', shortcut: 'Ctrl+V', disabled: !ui.clipboard, run: paste },
        ...(clip?.type === 'video' ? [{ type: 'separator' as const }, { label: 'Detach audio', run: detachAudioFromSelection }] : []),
        ...timeMenuItems(clip),
        { type: 'separator' },
        sel.some((c) => c.groupId)
          ? { label: 'Ungroup', icon: <Ungroup size={14} />, shortcut: 'Ctrl+Shift+G', run: ungroupSelection }
          : { label: 'Group', icon: <Group size={14} />, shortcut: 'Ctrl+G', disabled: sel.length < 2, run: groupSelection },
        sel.some((c) => c.linkId)
          ? { label: 'Unlink', icon: <Unlink2 size={14} />, shortcut: 'Ctrl+Shift+L', run: unlinkSelection }
          : { label: 'Link', icon: <Link2 size={14} />, shortcut: 'Ctrl+L', disabled: sel.length < 2, run: linkSelection },
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
            { label: 'Delete track', danger: true, run: () => updateProject((p) => removeTrack(p, row.id), { label: 'Delete track' }) },
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
      if (usable && isMagneticTrack(s.project, usable.id)) {
        // Magnetic main track: insert at the nearest cut, later clips make room.
        const cut = mainInsertionCut(s.project, pos.time);
        return {
          plan: { type: 'clip', kind, time: cut, duration: dur, row: usable, zone: null },
          hint: { ghost: { left: timeToX(cut, s.pps), width: dur * s.pps, top: RULER_H + usable.top, height: usable.height, label: 'Insert' }, clipId: null, cut: { x: timeToX(cut, s.pps), top: RULER_H + usable.top, height: usable.height } },
        };
      }
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

  // Holding Shift over a clip edge with the Select tool shows the ripple cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => void sectionRef.current?.classList.toggle('is-shift', e.shiftKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const lo = view.left - 500;
  const hi = view.left + view.width + 500;
  const empty = Object.keys(project.clips).length === 0;
  const mainRow = mainId ? layout.byId.get(mainId) : undefined;

  return (
    <section ref={sectionRef} className={`timeline ${tool === 'blade' ? 'is-blade' : ''} tool-${tool}`} data-timeline>
      <Toolbar onZoom={(v) => setZoom(v)} onFit={fitZoom} />
      <CompoundBar />
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
              const isMain = row.id === mainId;
              const h = trackHeight(track);
              return (
                <div
                  key={row.id}
                  className={`tl-header tl-header--${row.kind} ${track.role === 'captions' ? 'tl-header--captions' : ''} ${track.locked ? 'is-locked' : ''} ${isMain ? 'is-main' : ''} ${row.height < 40 ? 'is-compact' : ''}`}
                  style={{ top: row.top, height: row.height }}
                  data-track-header={track.id}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      { label: 'Rename track', run: () => setRenaming(track.id) },
                      { label: row.kind === 'visual' ? 'Add video track above' : 'Add audio track below', icon: <Plus size={14} />, run: () => updateProject((p) => void addTrack(p, row.kind, { trackId: row.id, where: row.kind === 'visual' ? 'above' : 'below' }), { label: 'Add track' }) },
                      ...(row.kind === 'visual' && row.id === mainTrackId(project)
                        ? [{ label: 'Magnetic main track', icon: <MainMagnetIcon size={14} />, checked: !!project.magneticMain, run: toggleMagneticMain }]
                        : []),
                      { type: 'separator' },
                      { type: 'label', label: 'Track height' },
                      { label: 'Small', checked: h === TRACK_SIZES.small[row.kind], run: () => setTrackHeight(track.id, TRACK_SIZES.small[row.kind]) },
                      { label: 'Medium', checked: h === TRACK_SIZES.medium[row.kind], run: () => setTrackHeight(track.id, undefined) },
                      { label: 'Large', checked: h === TRACK_SIZES.large[row.kind], run: () => setTrackHeight(track.id, TRACK_SIZES.large[row.kind]) },
                      { type: 'separator' },
                      { label: 'Delete track', icon: <Trash2 size={14} />, danger: true, run: () => updateProject((p) => removeTrack(p, row.id), { label: 'Delete track' }) },
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
                  ) : isMain ? (
                    <span className="tl-header__name tl-header__name--main truncate" onDoubleClick={() => setRenaming(track.id)} title={`Main track (${track.name}) — magnetic: clips stay together with no gaps, and clips dropped here are inserted at the nearest cut. Double-click to rename.`}>
                      <MainMagnetIcon size={12} />
                      Main
                    </span>
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
                  <span
                    className="tl-header__resize"
                    data-track-resize={track.id}
                    title="Drag to resize the track · double-click to reset"
                    onPointerDown={(e) => startTrackResize(e, track.id)}
                    onDoubleClick={() => track.height !== undefined && setTrackHeight(track.id, undefined)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="tl-scroll" ref={scrollRef} onScroll={syncView}>
          <div className="tl-content" style={{ width: contentW, height: contentH }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => bladeRef.current && (bladeRef.current.style.display = 'none')} onContextMenu={onContextMenu} onDoubleClick={onTimelineDoubleClick}>
            <canvas ref={rulerRef} className="tl-ruler" style={{ width: view.width, height: RULER_H }} />
            {/* Export In / Out marks (ui/export/InOutMarks): range band + draggable handles on the ruler. */}
            <InOutMarks pps={pps} scrollEl={scrollRef} height={contentH} />

            {newTrackZone && <div className={`tl-zone tl-zone--${newTrackZone}`} style={newTrackZone === 'above' ? { top: RULER_H + 2, height: TOP_ZONE - 4 } : { top: RULER_H + layout.height - 36, height: 30 }}>New track</div>}

            {layout.rows.map((row) => {
              const track = project.tracks[row.index];
              if (!track) return null;
              const clips = idx.byTrack.get(row.id) ?? [];
              return (
                <div key={row.id} className={`tl-track tl-track--${row.kind} ${track.role === 'captions' ? 'tl-track--captions' : ''} ${track.locked ? 'is-locked' : ''} ${track.hidden ? 'is-hidden' : ''} ${row.id === mainId ? 'is-main' : ''}`} style={{ top: RULER_H + row.top, height: row.height }}>
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
                        groupColor={clip.groupId ? groupColor(clip.groupId) : undefined}
                        linked={!!clip.linkId}
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

            {/* Speech & audio tools: silences under review, filler words and the beat grid. */}
            <SpeechTimelineOverlay pps={pps} top={RULER_H} height={layout.height} viewLeft={view.left} viewWidth={view.width} />

            {hint.ghost && (
              <div className="tl-ghost" style={{ left: hint.ghost.left, width: Math.max(4, hint.ghost.width), top: hint.ghost.top, height: hint.ghost.height }}>
                {hint.ghost.label && <span>{hint.ghost.label}</span>}
              </div>
            )}
            {hint.cut && <div className="tl-cut" style={{ left: hint.cut.x, top: hint.cut.top, height: hint.cut.height }} />}
            {insertMark !== null && mainRow && <div className="tl-insert" data-insert-mark style={{ left: timeToX(insertMark, pps), top: RULER_H + mainRow.top - 4, height: mainRow.height + 8 }} />}
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
      <EditReadout />
      <TrimMonitor />
      <HistoryPanel />
    </section>
  );
}
