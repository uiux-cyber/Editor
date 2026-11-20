/**
 * Speed curve editor: the speed (log scale, 0.1×–16×) across the clip (0–100 %). Points can be
 * dragged (snapping to common speeds and the playhead; hold Alt to move freely), added with a
 * double-click on the curve and removed with a double-click / right-click on a point. Each drag
 * is one undo step; the clip keeps its source content, so its duration follows the curve.
 */

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { curveToRamp, rampSpeedAt, rampToCurve, type CurvePoint } from '@/core/timemap';
import { formatSeconds } from '@/core/time';
import type { AudioClip, ID, VideoClip } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';
import { useProjectStore } from '@/store/project';
import { useElementSize } from '../common/controls';
import { openContextMenu } from '../common/overlays';
import { useT } from '../i18n';
import { setClipSpeed } from './timeActions';
import './time.css';

const LOG_MIN = Math.log2(0.1);
const LOG_MAX = Math.log2(16);
const HEIGHT = 168;
const PAD = { l: 34, r: 12, t: 14, b: 20 };
const GRID = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16];
const SNAP_PX = 6;

export const formatSpeed = (v: number): string => `${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)}×`;

/** Normalised points for a clip (a flat curve at its constant speed when it has no ramp). */
export function clipCurve(clip: VideoClip | AudioClip): CurvePoint[] {
  if (clip.speedRamp?.length) return rampToCurve(clip.speedRamp, clip.duration);
  return [0, 0.25, 0.5, 0.75, 1].map((u) => ({ u, v: clip.speed }));
}

/** Small read-only drawing of a curve (preset tiles, timeline). */
export function CurveThumb({ points, width = 64, height = 26 }: { points: CurvePoint[]; width?: number; height?: number }): ReactNode {
  const ramp = curveToRamp(points, 1);
  const y = (v: number): number => 2 + ((LOG_MAX - Math.log2(v)) / (LOG_MAX - LOG_MIN)) * (height - 4);
  let d = '';
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    d += `${i ? 'L' : 'M'}${(u * width).toFixed(1)},${y(rampSpeedAt(ramp, u)).toFixed(1)}`;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="curve-thumb" aria-hidden="true">
      <line x1={0} x2={width} y1={y(1)} y2={y(1)} className="curve-thumb__one" />
      <path d={d} className="curve-thumb__line" />
    </svg>
  );
}

export function SpeedCurve({ clip, ids }: { clip: VideoClip | AudioClip; ids: ID[] }): ReactNode {
  const t = useT();
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const time = usePlayback((s) => s.time);
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const points = useMemo(() => clipCurve(clip), [clip]);
  const width = Math.max(200, Math.round(size.width || 280));
  const plotW = width - PAD.l - PAD.r;
  const plotH = HEIGHT - PAD.t - PAD.b;
  const xOf = (u: number): number => PAD.l + u * plotW;
  const yOf = (v: number): number => PAD.t + ((LOG_MAX - Math.log2(Math.min(16, Math.max(0.1, v)))) / (LOG_MAX - LOG_MIN)) * plotH;
  const vOf = (y: number): number => Math.pow(2, LOG_MAX - ((y - PAD.t) / plotH) * (LOG_MAX - LOG_MIN));
  const uPlay = clip.duration > 0 ? (time - clip.start) / clip.duration : -1;

  const ramp = useMemo(() => curveToRamp(points, 1), [points]);
  const path = useMemo(() => {
    let d = '';
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      d += `${i ? 'L' : 'M'}${xOf(u).toFixed(1)},${yOf(rampSpeedAt(ramp, u)).toFixed(1)}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ramp, width]);
  const area = `${path}L${xOf(1)},${PAD.t + plotH}L${xOf(0)},${PAD.t + plotH}Z`;

  const commitPoints = (next: CurvePoint[], gesture: boolean): void => setClipSpeed(ids, next, gesture ? {} : { coalesce: undefined });

  const localPos = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startDrag = (e: React.PointerEvent, index: number): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(index);
    setDragging(index);
    const store = useProjectStore.getState();
    store.begin();
    const base = points.map((p) => ({ ...p }));
    const isEnd = index === 0 || index === base.length - 1;
    const move = (ev: PointerEvent): void => {
      const { x, y } = localPos(ev);
      let v = vOf(Math.min(PAD.t + plotH, Math.max(PAD.t, y)));
      let u = base[index].u;
      if (!isEnd) {
        const lo = base[index - 1].u + 0.02;
        const hi = base[index + 1].u - 0.02;
        u = Math.min(hi, Math.max(lo, (x - PAD.l) / plotW));
      }
      if (!ev.altKey) {
        const snapV = GRID.find((g) => Math.abs(yOf(g) - y) < SNAP_PX);
        if (snapV) v = snapV;
        if (!isEnd && uPlay > 0 && uPlay < 1 && Math.abs(xOf(uPlay) - x) < SNAP_PX) u = Math.min(base[index + 1].u - 0.02, Math.max(base[index - 1].u + 0.02, uPlay));
      }
      v = Math.round(v * 100) / 100;
      const next = base.map((p, i) => (i === index ? { u, v } : p));
      commitPoints(next, true);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      setDragging(null);
      useProjectStore.getState().commit();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };

  const removePoint = (index: number): void => {
    if (index <= 0 || index >= points.length - 1) return;
    commitPoints(
      points.filter((_, i) => i !== index),
      false,
    );
    setActive(null);
  };

  const addPointAt = (u: number): void => {
    const clamped = Math.min(0.98, Math.max(0.02, u));
    if (points.some((p) => Math.abs(p.u - clamped) < 0.02)) return;
    const v = Math.round(rampSpeedAt(ramp, clamped) * 100) / 100;
    const next = [...points, { u: clamped, v }].sort((a, b) => a.u - b.u);
    commitPoints(next, false);
    setActive(next.findIndex((p) => p.u === clamped));
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    if ((e.target as Element).closest('[data-point]')) return;
    const { x } = localPos(e);
    addPointAt((x - PAD.l) / plotW);
  };

  const shown = dragging ?? active;
  return (
    <div className="speed-curve" ref={boxRef}>
      <svg ref={svgRef} width={width} height={HEIGHT} className="speed-curve__svg" onDoubleClick={onDoubleClick} onPointerDown={() => setActive(null)} data-speed-curve>
        {GRID.map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={width - PAD.r} y1={yOf(g)} y2={yOf(g)} className={g === 1 ? 'speed-curve__one' : 'speed-curve__grid'} />
            <text x={PAD.l - 6} y={yOf(g) + 3.5} className="speed-curve__axis" textAnchor="end">
              {g < 1 ? g : `${g}`}×
            </text>
          </g>
        ))}
        {[0.25, 0.5, 0.75].map((u) => (
          <line key={u} x1={xOf(u)} x2={xOf(u)} y1={PAD.t} y2={PAD.t + plotH} className="speed-curve__grid" />
        ))}
        <path d={area} className="speed-curve__area" />
        <path d={path} className="speed-curve__line" />
        {uPlay >= 0 && uPlay <= 1 && <line x1={xOf(uPlay)} x2={xOf(uPlay)} y1={PAD.t - 6} y2={PAD.t + plotH} className="speed-curve__playhead" />}
        <text x={PAD.l} y={HEIGHT - 5} className="speed-curve__axis">
          0
        </text>
        <text x={width - PAD.r} y={HEIGHT - 5} className="speed-curve__axis" textAnchor="end">
          {formatSeconds(clip.duration)}
        </text>
        {points.map((p, i) => {
          const x = xOf(p.u);
          const y = yOf(p.v);
          const on = shown === i;
          return (
            <g
              key={i}
              data-point={i}
              className={`speed-curve__point ${on ? 'is-active' : ''}`}
              onPointerDown={(e) => startDrag(e, i)}
              onDoubleClick={() => removePoint(i)}
              onContextMenu={(e) => {
                e.stopPropagation();
                setActive(i);
                openContextMenu(e, [
                  { label: t('Remove point'), icon: <Minus size={14} />, disabled: i === 0 || i === points.length - 1, run: () => removePoint(i) },
                  { label: t('Set to 1×'), run: () => commitPoints(points.map((q, k) => (k === i ? { ...q, v: 1 } : q)), false) },
                ]);
              }}
            >
              <circle cx={x} cy={y} r={11} className="speed-curve__hit" />
              <circle cx={x} cy={y} r={on ? 6 : 5} className="speed-curve__dot" />
              {(on || points.length <= 6) && (
                <g className={`speed-curve__label ${on ? 'is-on' : ''}`} transform={`translate(${Math.min(width - PAD.r - 18, Math.max(PAD.l + 18, x))},${y < PAD.t + 22 ? y + 20 : y - 12})`}>
                  <rect x={-18} y={-9} width={36} height={15} rx={4} />
                  <text y={2.5} textAnchor="middle">
                    {formatSpeed(p.v)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="speed-curve__bar">
        <button type="button" className="btn btn--sm btn--ghost" title={t('Add a point at the playhead')} disabled={!(uPlay > 0.02 && uPlay < 0.98)} onClick={() => addPointAt(uPlay)}>
          <Plus size={13} /> {t('Point')}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" title={t('Remove the selected point')} disabled={active === null || active === 0 || active === points.length - 1} onClick={() => active !== null && removePoint(active)}>
          <Minus size={13} /> {t('Point')}
        </button>
        <span className="speed-curve__readout mono">{active !== null && points[active] ? t('{speed} at {percent}%', { speed: formatSpeed(points[active].v), percent: Math.round(points[active].u * 100) }) : t('Double-click to add')}</span>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          title={t('Flatten the curve at 1×')}
          onClick={() => {
            commitPoints(
              points.map((p) => ({ ...p, v: 1 })),
              false,
            );
            engine.invalidate();
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}
