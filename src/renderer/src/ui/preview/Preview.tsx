import { Activity, Camera, ChevronFirst, ChevronLast, Grid3x3, Maximize, Pause, Play, Repeat, StepBack, StepForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { propAt } from '@/core/keyframes';
import { designSize, projectDuration } from '@/core/project';
import { getSceneItems } from '@/core/scene';
import { formatTimecode } from '@/core/time';
import type { ID, VisualClip } from '@/core/types';
import type { LayerBox } from '@/engine/compositor';
import { engine, usePlayback } from '@/engine/engine';
import { api } from '@/platform/api';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast, useUI } from '@/store/ui';
import { addAdjustment, addAsset, addGenerator, addShape, addSound, addSticker, addText, applyEffect, applyFilter, applyTemplate, fillSlotWith, jumpToEdit } from '../actions';
import { Select, useElementSize } from '../common/controls';
import { registerDropTarget, type DragPayload } from '../dnd';
import { writeProp } from '../keyframeOps';
import { PenOverlay, PenToolButton } from './pen/PenOverlay';
import { VisionOverlay } from '../vision/VisionOverlay';
import { useColorAudioPrefs, toggleScopes } from '../coloraudio/prefs';
import { ScopesDock } from '../coloraudio/ScopesPanel';

const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type HandleId = (typeof HANDLE_IDS)[number];

interface Guides {
  v: number | null;
  h: number | null;
}

/** Is a design-space point inside a (rotated) layer box? */
function hit(box: LayerBox, x: number, y: number): boolean {
  const rad = (-box.rotation * Math.PI) / 180;
  const dx = x - box.cx;
  const dy = y - box.cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= box.w / 2 + 4 && Math.abs(ly) <= box.h / 2 + 4;
}

/** Visible, selectable layers at the playhead, top-most first. */
function layersAtPlayhead(): { id: ID; box: LayerBox; clip: VisualClip }[] {
  const project = getProject();
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
  const out: { id: ID; box: LayerBox; clip: VisualClip }[] = [];
  for (const item of getSceneItems(project, engine.time).reverse()) {
    const refs = item.kind === 'layer' ? [item.layer] : [item.to, item.from];
    for (const ref of refs) {
      if (ref.clip.type === 'adjustment' || locked.has(ref.clip.trackId)) continue;
      const box = engine.layerBox(ref.clip.id);
      if (box) out.push({ id: ref.clip.id, box, clip: ref.clip });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Transform gizmo
// ---------------------------------------------------------------------------------------------

function Gizmo({ clipId, k, stageW, stageH, setGuides }: { clipId: ID; k: number; stageW: number; stageH: number; setGuides: (g: Guides) => void }): ReactNode {
  usePlayback((s) => s.layoutVersion);
  const clip = useProjectStore((s) => s.project.clips[clipId]);
  const settings = useProjectStore((s) => s.project.settings);
  const box = engine.layerBox(clipId);
  const drag = useRef<{
    mode: 'move' | 'rotate' | HandleId;
    px: number;
    py: number;
    x: number;
    y: number;
    sx: number;
    sy: number;
    rot: number;
    box: LayerBox;
    shapeW: number;
    shapeH: number;
    angle0: number;
    moved: boolean;
  } | null>(null);

  if (!clip || clip.type === 'audio' || clip.type === 'adjustment' || !box) return null;
  const { cw, ch } = designSize(settings);
  const cx = stageW / 2 + box.cx * k;
  const cy = stageH / 2 + box.cy * k;
  const w = Math.max(2, box.w * k);
  const h = Math.max(2, box.h * k);
  const cornersOnly = clip.type === 'text' || clip.type === 'sticker';

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const host = (e.currentTarget as HTMLElement).closest('.stage__overlay') as HTMLElement;
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const begin = (mode: 'move' | 'rotate' | HandleId) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toLocal(e);
    const lt = Math.min(Math.max(engine.time - clip.start, 0), clip.duration);
    drag.current = {
      mode,
      px: p.x,
      py: p.y,
      x: propAt(clip, 'x', lt),
      y: propAt(clip, 'y', lt),
      sx: propAt(clip, 'scaleX', lt),
      sy: propAt(clip, 'scaleY', lt),
      rot: propAt(clip, 'rotation', lt),
      box: { ...box },
      shapeW: clip.type === 'shape' ? clip.shape.width : 0,
      shapeH: clip.type === 'shape' ? clip.shape.height : 0,
      angle0: Math.atan2(p.y - cy, p.x - cx),
      moved: false,
    };
  };

  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = toLocal(e);
    const dx = (p.x - d.px) / k;
    const dy = (p.y - d.py) / k;
    if (!d.moved) {
      if (Math.hypot(p.x - d.px, p.y - d.py) < 2) return;
      d.moved = true;
      useProjectStore.getState().begin();
    }
    if (d.mode === 'move') {
      let nx = d.x + dx;
      let ny = d.y + dy;
      const guides: Guides = { v: null, h: null };
      if (!e.altKey) {
        // Snap the layer's centre and edges to the frame's centre and edges.
        const tol = 7 / k;
        const bx = d.box.cx + dx;
        const by = d.box.cy + dy;
        const rot = Math.abs(d.box.rotation % 180) < 0.5;
        const hw = rot ? d.box.w / 2 : 0;
        const hh = rot ? d.box.h / 2 : 0;
        const xs: [number, number][] = [[bx, 0], [bx - hw, -cw / 2], [bx + hw, cw / 2]];
        const ys: [number, number][] = [[by, 0], [by - hh, -ch / 2], [by + hh, ch / 2]];
        for (const [val, target] of xs) {
          if (Math.abs(val - target) < tol) {
            nx += target - val;
            guides.v = target;
            break;
          }
        }
        for (const [val, target] of ys) {
          if (Math.abs(val - target) < tol) {
            ny += target - val;
            guides.h = target;
            break;
          }
        }
      }
      if (e.shiftKey) {
        // Constrain to the dominant axis.
        if (Math.abs(dx) > Math.abs(dy)) ny = d.y;
        else nx = d.x;
      }
      setGuides(guides);
      updateProject((proj) => {
        const c = proj.clips[clipId];
        if (!c) return;
        writeProp(c, 'x', Math.round(nx * 10) / 10);
        writeProp(c, 'y', Math.round(ny * 10) / 10);
      });
    } else if (d.mode === 'rotate') {
      let deg = d.rot + ((Math.atan2(p.y - cy, p.x - cx) - d.angle0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        const near = Math.round(deg / 90) * 90;
        if (Math.abs(deg - near) < 3) deg = near;
      }
      updateProject((proj) => {
        const c = proj.clips[clipId];
        if (c) writeProp(c, 'rotation', Math.round(deg * 10) / 10);
      });
    } else {
      // Scale about the centre: compare pointer distances along the layer's own axes.
      const rad = (-d.box.rotation * Math.PI) / 180;
      const loc = (qx: number, qy: number): { x: number; y: number } => {
        const vx = qx - (stageW / 2 + d.box.cx * k);
        const vy = qy - (stageH / 2 + d.box.cy * k);
        return { x: vx * Math.cos(rad) - vy * Math.sin(rad), y: vx * Math.sin(rad) + vy * Math.cos(rad) };
      };
      const a = loc(d.px, d.py);
      const b = loc(p.x, p.y);
      const corner = d.mode.length === 2;
      const horizontal = d.mode === 'e' || d.mode === 'w';
      let fx = 1;
      let fy = 1;
      if (corner) {
        const f = Math.max(0.02, Math.hypot(b.x, b.y) / Math.max(1, Math.hypot(a.x, a.y)));
        fx = fy = f;
      } else if (horizontal) {
        fx = Math.max(0.02, Math.abs(b.x) / Math.max(1, Math.abs(a.x)));
      } else {
        fy = Math.max(0.02, Math.abs(b.y) / Math.max(1, Math.abs(a.y)));
      }
      updateProject((proj) => {
        const c = proj.clips[clipId];
        if (!c || c.type === 'audio') return;
        if (!corner && c.type === 'shape') {
          // Resize the shape itself so strokes and corner radii stay crisp.
          if (horizontal) c.shape.width = Math.max(4, Math.round(d.shapeW * fx));
          else c.shape.height = Math.max(4, Math.round(d.shapeH * fy));
          return;
        }
        if (fx !== 1) writeProp(c, 'scaleX', Math.round(d.sx * fx * 1000) / 1000);
        if (fy !== 1) writeProp(c, 'scaleY', Math.round(d.sy * fy * 1000) / 1000);
      });
    }
  };

  const end = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setGuides({ v: null, h: null });
    if (d?.moved) useProjectStore.getState().commit();
  };

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return (
    <div className="gizmo" style={{ width: w, height: h, transform: `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${box.rotation}deg)` }}>
      <div className="gizmo__body" onPointerDown={begin('move')} {...handlers} onDoubleClick={() => clip.type === 'text' && useUI.getState().set({ editingText: clip.id })} />
      {HANDLE_IDS.filter((id) => !cornersOnly || id.length === 2).map((id) => (
        <div key={id} className={`gizmo__handle gizmo__handle--${id}`} onPointerDown={begin(id)} {...handlers} />
      ))}
      <div className="gizmo__rotate" onPointerDown={begin('rotate')} {...handlers} title="Rotate (hold Shift for 15° steps)" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

function Timecode(): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const fps = useProjectStore((s) => s.project.settings.fps);
  const duration = useProjectStore((s) => projectDuration(s.project));
  useEffect(() => {
    const paint = (t: number): void => {
      if (ref.current) ref.current.textContent = formatTimecode(t, fps);
    };
    paint(engine.time);
    return engine.onTime(paint);
  }, [fps]);
  return (
    <div className="timecode mono" title="Current time / project duration">
      <span ref={ref} className="timecode__now" />
      <span className="timecode__sep">/</span>
      <span>{formatTimecode(duration, fps)}</span>
    </div>
  );
}

function Meter(): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback((s) => s.playing);
  useEffect(() => {
    if (!playing) {
      if (ref.current) ref.current.style.transform = 'scaleX(0)';
      return;
    }
    let raf = 0;
    let shown = 0;
    const tick = (): void => {
      const level = engine.level();
      // Fast attack, slow release.
      shown = level > shown ? level : shown * 0.9;
      if (ref.current) ref.current.style.transform = `scaleX(${Math.min(1, Math.pow(shown, 0.6)).toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return (
    <div className="meter" title="Output level">
      <div ref={ref} className="meter__fill" />
    </div>
  );
}

function Transport({ onFullscreen }: { onFullscreen: () => void }): ReactNode {
  const playing = usePlayback((s) => s.playing);
  const loop = useUI((s) => s.loop);
  const safeZones = useUI((s) => s.safeZones);
  const quality = useUI((s) => s.previewQuality);
  const volume = useUI((s) => s.masterVolume);
  const set = useUI((s) => s.set);
  const lastVolume = useRef(1);
  const scopesOpen = useColorAudioPrefs((s) => s.scopesOpen);

  const snapshot = async (): Promise<void> => {
    const blob = await engine.snapshot();
    if (!blob) return;
    const project = getProject();
    const path = await api.dialog.saveFile(`${project.name} frame.png`, [{ name: 'PNG image', extensions: ['png'] }]);
    if (!path) return;
    try {
      await api.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      useUI.getState().toast({ kind: 'success', message: 'Frame saved', action: { label: 'Show', run: () => void api.app.showItemInFolder(path) } });
    } catch (err) {
      toast('error', 'Could not save the frame', (err as Error).message);
    }
  };

  return (
    <div className="transport">
      <div className="transport__side">
        <Timecode />
      </div>
      <div className="transport__center">
        <button type="button" className="icon-btn" title="Previous edit point (↑)" onClick={() => jumpToEdit(-1)}>
          <ChevronFirst size={17} />
        </button>
        <button type="button" className="icon-btn" title="Previous frame (←)" onClick={() => engine.stepFrames(-1)}>
          <StepBack size={15} />
        </button>
        <button type="button" className="play-btn" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => engine.toggle()}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>
        <button type="button" className="icon-btn" title="Next frame (→)" onClick={() => engine.stepFrames(1)}>
          <StepForward size={15} />
        </button>
        <button type="button" className="icon-btn" title="Next edit point (↓)" onClick={() => jumpToEdit(1)}>
          <ChevronLast size={17} />
        </button>
      </div>
      <div className="transport__side transport__side--right">
        <Meter />
        <button
          type="button"
          className="icon-btn"
          title={volume > 0 ? 'Mute preview' : 'Unmute preview'}
          onClick={() => {
            if (volume > 0) {
              lastVolume.current = volume;
              set({ masterVolume: 0 });
            } else set({ masterVolume: lastVolume.current || 1 });
          }}
        >
          {volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          className="slider"
          style={{ width: 70, flex: 'none', ['--pct' as string]: `${Math.min(100, volume * 100)}%` }}
          min={0}
          max={1}
          step={0.01}
          value={Math.min(1, volume)}
          title="Preview volume (does not affect the export)"
          onChange={(e) => set({ masterVolume: parseFloat(e.target.value) })}
        />
        <span className="vdivider" />
        <PenToolButton />
        <button type="button" className={`icon-btn ${loop ? 'is-active' : ''}`} title="Loop playback" onClick={() => set({ loop: !loop })}>
          <Repeat size={15} />
        </button>
        <button type="button" className={`icon-btn ${safeZones ? 'is-active' : ''}`} title="Safe zones & centre guides" onClick={() => set({ safeZones: !safeZones })}>
          <Grid3x3 size={15} />
        </button>
        {/* colour-audio: video scopes dock */}
        <button type="button" className={`icon-btn ${scopesOpen ? 'is-active' : ''}`} title="Video scopes" data-action="toggle-scopes" onClick={toggleScopes}>
          <Activity size={15} />
        </button>
        <Select
          value={quality}
          onChange={(v) => set({ previewQuality: v })}
          style={{ width: 74, height: 26 }}
          options={[
            { value: 1, label: 'Full' },
            { value: 0.5, label: 'Half' },
            { value: 0.25, label: 'Quarter' },
          ]}
        />
        <button type="button" className="icon-btn" title="Save current frame as PNG" onClick={() => void snapshot()}>
          <Camera size={15} />
        </button>
        <button type="button" className="icon-btn" title="Fullscreen preview (F)" onClick={onFullscreen}>
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

export function Preview(): ReactNode {
  const settings = useProjectStore((s) => s.project.settings);
  const selection = useUI((s) => s.selection);
  const safeZones = useUI((s) => s.safeZones);
  const hasContent = useProjectStore((s) => Object.keys(s.project.clips).length > 0);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<Guides>({ v: null, h: null });
  const [dropOver, setDropOver] = useState(false);
  usePlayback((s) => s.layoutVersion);

  const { cw, ch } = designSize(settings);
  const stage = useMemo(() => {
    const pad = 20;
    const availW = Math.max(40, area.width - pad * 2);
    const availH = Math.max(40, area.height - pad * 2);
    const k = Math.min(availW / cw, availH / ch);
    return { w: Math.max(16, Math.floor(cw * k)), h: Math.max(16, Math.floor(ch * k)), k };
  }, [area.width, area.height, cw, ch]);

  useLayoutEffect(() => {
    if (canvasRef.current) engine.attach(canvasRef.current);
    return () => engine.detach();
  }, []);

  useEffect(() => {
    engine.setViewport(stage.w, stage.h, window.devicePixelRatio || 1);
  }, [stage.w, stage.h]);

  // Library drops: add at the playhead, or fill a template placeholder under the pointer.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const toDesign = (x: number, y: number): { x: number; y: number } => {
      const r = el.getBoundingClientRect();
      return { x: (x - r.left - r.width / 2) / stage.k, y: (y - r.top - r.height / 2) / stage.k };
    };
    const accepts = (p: DragPayload): boolean => p.kind !== 'transition';
    return registerDropTarget(el, {
      over: (p) => {
        const ok = accepts(p);
        setDropOver(ok);
        return ok;
      },
      leave: () => setDropOver(false),
      drop: (p, x, y) => {
        setDropOver(false);
        const pt = toDesign(x, y);
        const under = layersAtPlayhead().find((l) => hit(l.box, pt.x, pt.y));
        const project = getProject();
        switch (p.kind) {
          case 'asset': {
            const asset = project.assets[p.assetId];
            if (!asset) return;
            if (under && under.clip.type === 'shape' && under.clip.shape.slot && asset.kind !== 'audio') fillSlotWith(under.id, asset);
            else addAsset(asset, { time: engine.time });
            return;
          }
          case 'text':
            addText(p.presetId);
            return;
          case 'sticker':
            addSticker(p.stickerId);
            return;
          case 'shape':
            addShape(p.shape);
            return;
          case 'generator':
            addGenerator(p.generatorId, { time: engine.time });
            return;
          case 'adjustment':
            addAdjustment();
            return;
          case 'sound':
            void addSound(p.soundId);
            return;
          case 'effect':
            applyEffect(p.effectId, under?.id);
            return;
          case 'filter':
            applyFilter(p.filterId, under?.id);
            return;
          case 'template':
            applyTemplate(p.variation);
            return;
          default:
        }
      },
    });
  }, [stage.k]);

  const onStagePointerDown = useCallback(
    (e: React.PointerEvent): void => {
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) / stage.k;
      const y = (e.clientY - r.top - r.height / 2) / stage.k;
      const found = layersAtPlayhead().find((l) => hit(l.box, x, y));
      const ui = useUI.getState();
      if (!found) {
        ui.clearSelection();
        return;
      }
      if (e.shiftKey || e.ctrlKey) ui.toggleSelect(found.id);
      else ui.select([found.id]);
    },
    [stage.k],
  );

  const fullscreen = (): void => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };

  const primary = selection.length === 1 ? selection[0] : null;
  const others = selection.length > 1 ? selection : [];

  return (
    <div className="preview" ref={rootRef} data-preview>
      {/* colour-audio: the preview area shares its row with the docked scopes. */}
      <div className="preview__main">
      <div className="preview__area" ref={areaRef} onPointerDown={(e) => e.target === e.currentTarget && useUI.getState().clearSelection()}>
        <div className={`stage ${dropOver ? 'is-drop' : ''}`} style={{ width: stage.w, height: stage.h }}>
          <canvas ref={canvasRef} className="stage__canvas" />
          <div ref={overlayRef} className="stage__overlay" onPointerDown={onStagePointerDown}>
            {safeZones && (
              <>
                <div className="safe safe--action" />
                <div className="safe safe--title" />
                <div className="safe__cross safe__cross--v" />
                <div className="safe__cross safe__cross--h" />
              </>
            )}
            {guides.v !== null && <div className="guide guide--v" style={{ left: stage.w / 2 + guides.v * stage.k }} />}
            {guides.h !== null && <div className="guide guide--h" style={{ top: stage.h / 2 + guides.h * stage.k }} />}
            {others.map((id) => {
              const box = engine.layerBox(id);
              if (!box) return null;
              const w = box.w * stage.k;
              const h = box.h * stage.k;
              return <div key={id} className="gizmo gizmo--passive" style={{ width: w, height: h, transform: `translate(${stage.w / 2 + box.cx * stage.k - w / 2}px, ${stage.h / 2 + box.cy * stage.k - h / 2}px) rotate(${box.rotation}deg)` }} />;
            })}
            {primary && <Gizmo clipId={primary} k={stage.k} stageW={stage.w} stageH={stage.h} setGuides={setGuides} />}
            {/* Pen tool and path point editing (ui/preview/pen). */}
            <PenOverlay k={stage.k} stageW={stage.w} stageH={stage.h} />
            {/* Vision features: tracking box / path and analysis progress (ui/vision). */}
            <VisionOverlay stageW={stage.w} stageH={stage.h} k={stage.k} />
            {!hasContent && (
              <div className="stage__hint">
                <strong>Your canvas is ready</strong>
                <span>Add media, a template or text from the library on the left.</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <ScopesDock />
      </div>
      <Transport onFullscreen={fullscreen} />
    </div>
  );
}
