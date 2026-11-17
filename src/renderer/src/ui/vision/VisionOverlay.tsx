/**
 * Preview overlay of the vision features (mounted inside the stage overlay by Preview.tsx):
 *   - box drawing for motion tracking (drag on the picture; the box can be moved afterwards);
 *   - the tracked path of the selected layer, coloured by tracking confidence;
 *   - a small progress panel for running analyses with a cancel button.
 * Everything is in design px relative to the composition centre, scaled by `k`.
 */

import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { usePlayback } from '@/engine/engine';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { useVision, type DesignBox } from '@/vision/store';
import { keyframePath, setDrawBox, stopDrawing } from '@/vision/tracking';
import '@/styles/vision.css';

interface Props {
  stageW: number;
  stageH: number;
  k: number;
}

function DrawLayer({ stageW, stageH, k }: Props): ReactNode {
  const draw = useVision((s) => s.draw);
  const drag = useRef<{ x0: number; y0: number; mode: 'new' | 'move'; box: DesignBox | null } | null>(null);
  if (!draw?.active) return null;
  const toDesign = (e: React.PointerEvent): { x: number; y: number } => {
    const host = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - host.left - stageW / 2) / k, y: (e.clientY - host.top - stageH / 2) / k };
  };
  const inBox = (p: { x: number; y: number }, b: DesignBox | null): boolean => !!b && Math.abs(p.x - b.cx) < b.w / 2 && Math.abs(p.y - b.cy) < b.h / 2;
  return (
    <div
      className="vision-draw"
      data-vision-draw
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = toDesign(e);
        drag.current = { x0: p.x, y0: p.y, mode: inBox(p, draw.box) ? 'move' : 'new', box: draw.box };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = toDesign(e);
        if (d.mode === 'move' && d.box) setDrawBox({ ...d.box, cx: d.box.cx + p.x - d.x0, cy: d.box.cy + p.y - d.y0 });
        else setDrawBox({ cx: (d.x0 + p.x) / 2, cy: (d.y0 + p.y) / 2, w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        const box = useVision.getState().draw?.box;
        if (d?.mode === 'new' && box && (box.w < 6 || box.h < 6)) setDrawBox(d.box);
        else if (box) stopDrawing();
      }}
      onKeyDown={(e) => e.key === 'Escape' && stopDrawing()}
    />
  );
}

function TrackBoxView({ stageW, stageH, k }: Props): ReactNode {
  const draw = useVision((s) => s.draw);
  const selected = useUI((s) => s.selection[0]);
  if (!draw?.box || (!draw.active && selected !== draw.followerId)) return null;
  const b = draw.box;
  return (
    <div
      className={`vision-box ${draw.active ? 'is-drawing' : ''}`}
      data-vision-box
      style={{ left: stageW / 2 + (b.cx - b.w / 2) * k, top: stageH / 2 + (b.cy - b.h / 2) * k, width: b.w * k, height: b.h * k }}
    >
      <span className="vision-box__label">Track</span>
    </div>
  );
}

function TrackPath({ stageW, stageH, k }: Props): ReactNode {
  const selected = useUI((s) => s.selection[0]);
  const track = useVision((s) => (selected ? s.tracks[selected] : undefined));
  const drawing = useVision((s) => s.draw?.followerId === selected);
  const clip = useProjectStore((s) => (selected ? s.project.clips[selected] : undefined));
  const fps = useProjectStore((s) => s.project.settings.fps);
  const time = usePlayback((s) => s.time);
  if (!selected || !clip || clip.type === 'audio') return null;
  // The freshly tracked path, or (while the tracking panel is in use) the keyframed path.
  const points = track?.points ?? (drawing ? keyframePath(clip, fps) : []);
  if (points.length < 2) return null;
  const sx = (x: number): number => stageW / 2 + x * k;
  const sy = (y: number): number => stageH / 2 + y * k;
  const step = Math.max(1, Math.floor(points.length / 600));
  const segs: ReactNode[] = [];
  for (let i = step; i < points.length; i += step) {
    const a = points[i - step];
    const b = points[i];
    const conf = Math.min(a.conf, b.conf);
    segs.push(<line key={i} x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)} className={conf >= 0.6 ? 'is-good' : conf >= 0.45 ? 'is-weak' : 'is-lost'} />);
  }
  const cur = points.reduce((best, p) => (Math.abs(p.T - time) < Math.abs(best.T - time) ? p : best), points[0]);
  return (
    <svg className="vision-path" width={stageW} height={stageH} data-vision-path={points.length}>
      {segs}
      <circle cx={sx(cur.x)} cy={sy(cur.y)} r={4} />
    </svg>
  );
}

function JobsHud(): ReactNode {
  const jobs = useVision((s) => s.jobs);
  const list = Object.values(jobs).filter((j) => j.kind !== 'cutout');
  if (!list.length) return null;
  return (
    <div className="vision-hud" data-vision-hud>
      {list.map((j) => (
        <div key={j.key} className="vision-hud__job">
          <span className="truncate">{j.detail ?? j.label}</span>
          <span className="mono">{j.progress < 0 ? '…' : `${Math.round(j.progress * 100)}%`}</span>
          <button type="button" className="icon-btn icon-btn--sm" title="Cancel" onClick={j.cancel}>
            <X size={12} />
          </button>
          <div className="vision-hud__bar" style={{ width: `${Math.max(0, j.progress) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export function VisionOverlay(props: Props): ReactNode {
  return (
    <>
      <TrackPath {...props} />
      <TrackBoxView {...props} />
      <DrawLayer {...props} />
      <JobsHud />
    </>
  );
}
