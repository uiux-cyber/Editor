/**
 * Tone-curve editor (master + R / G / B). Click the graph to add a point on the curve, drag to
 * move it (Shift = fine), double-click or drag it out of the graph to remove it, arrow keys nudge
 * the selected point. The current preview frame's histogram is drawn behind the curve.
 */

import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCurvePoint,
  CURVE_CHANNELS,
  identityCurve,
  isDefaultCurves,
  isIdentityCurve,
  monotoneCubic,
  moveCurvePoint,
  removeCurvePoint,
  type CurveChannel,
} from '@/core/color/curves';
import type { CurvePoints, ID, VisualClip } from '@/core/types';
import { frameTap } from '@/engine/scopes/frameTap';
import { useProjectStore } from '@/store/project';
import { openContextMenu } from '../common/overlays';
import { tk, tMaybe, useT } from '../i18n';
import { clipCurves, setCurveChannel, setCurves } from './gradeEdit';
import { useColorAudioPrefs } from './prefs';
import { drawCurveHistogram } from './scopeDraw';

const CHANNEL_META: Record<CurveChannel, { label: string; color: string; hist: string; title: string }> = {
  master: { label: 'Y', color: '#f4f6fa', hist: 'rgba(220,226,240,0.16)', title: tk('Master (all channels)') },
  r: { label: 'R', color: '#ff6b74', hist: 'rgba(255,80,90,0.2)', title: tk('Red') },
  g: { label: 'G', color: '#4ade80', hist: 'rgba(60,220,110,0.18)', title: tk('Green') },
  b: { label: 'B', color: '#60a5fa', hist: 'rgba(70,130,255,0.24)', title: tk('Blue') },
};

const SIZE = 256; // SVG user units
const REMOVE_MARGIN = 0.12; // drag this far outside the graph to remove a point

function pathFor(points: CurvePoints): string {
  const f = monotoneCubic(points);
  let d = '';
  for (let i = 0; i <= 128; i++) {
    const x = i / 128;
    const y = Math.min(1, Math.max(0, f(x)));
    d += `${i === 0 ? 'M' : 'L'}${(x * SIZE).toFixed(2)},${((1 - y) * SIZE).toFixed(2)}`;
  }
  return d;
}

function useHistogram(canvas: React.RefObject<HTMLCanvasElement | null>, channel: CurveChannel): void {
  useEffect(() => {
    const bins = new Uint32Array(256);
    return frameTap.subscribe((f) => {
      const el = canvas.current;
      const ctx = el?.getContext('2d');
      if (!el || !ctx) return;
      bins.fill(0);
      const d = f.data;
      const c = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : -1;
      for (let i = 0; i < d.length; i += 4) {
        const v = c >= 0 ? d[i + c] : Math.min(255, Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]));
        bins[v]++;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      drawCurveHistogram(ctx, w, h, bins, CHANNEL_META[channel].hist);
    });
  }, [canvas, channel]);
}

interface Drag {
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  origin: [number, number];
  moved: boolean;
  removing: boolean;
}

export function CurvesEditor({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const t = useT();
  const channel = useColorAudioPrefs((s) => s.curveChannel);
  const setPrefs = useColorAudioPrefs((s) => s.set);
  const curves = useMemo(() => clipCurves(clip), [clip]);
  const points = curves[channel];
  const svgRef = useRef<SVGSVGElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<number>(-1);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  useHistogram(histRef, channel);

  // Keep the selection valid when the channel or points change.
  useEffect(() => {
    if (selected >= points.length) setSelected(-1);
  }, [points.length, selected]);

  const meta = CHANNEL_META[channel];
  const write = (next: CurvePoints, coalesce?: string): void => setCurveChannel(ids, curves, channel, next, coalesce);

  const toUnit = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };

  const startDrag = (e: React.PointerEvent, index: number, pts: CurvePoints, alreadyBegun: boolean): void => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { index, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: [pts[index][0], pts[index][1]], moved: alreadyBegun, removing: false };
    setSelected(index);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    svgRef.current?.focus();
    const u = toUnit(e);
    const r = svgRef.current!.getBoundingClientRect();
    // Hit test the existing points first (8 px radius).
    let hit = -1;
    let best = Infinity;
    points.forEach(([px, py], i) => {
      const dx = (px - u.x) * r.width;
      const dy = (py - u.y) * r.height;
      const d = Math.hypot(dx, dy);
      if (d < 9 && d < best) {
        best = d;
        hit = i;
      }
    });
    if (hit >= 0) {
      startDrag(e, hit, points, false);
      return;
    }
    // Add a point on the curve under the pointer and drag it straight away (one undo step).
    const y = Math.min(1, Math.max(0, monotoneCubic(points)(u.x)));
    const added = addCurvePoint(points, u.x, y);
    if (added.index < 0) return;
    useProjectStore.getState().begin();
    write(added.points);
    startDrag(e, added.index, added.points, true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const u = toUnit(e);
    setHover(u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1 ? u : null);
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const r = svgRef.current!.getBoundingClientRect();
    const fine = e.shiftKey ? 0.2 : 1;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 2) return;
      d.moved = true;
      useProjectStore.getState().begin();
    }
    const nx = d.origin[0] + ((e.clientX - d.startX) / r.width) * fine;
    const ny = d.origin[1] - ((e.clientY - d.startY) / r.height) * fine;
    const pts = clipCurves(useProjectStore.getState().project.clips[clip.id] as VisualClip)[channel];
    const interior = d.index > 0 && d.index < pts.length - 1;
    const out = u.y < -REMOVE_MARGIN || u.y > 1 + REMOVE_MARGIN || u.x < -REMOVE_MARGIN || u.x > 1 + REMOVE_MARGIN;
    d.removing = interior && out;
    setRemoving(d.removing);
    if (d.removing) return;
    write(moveCurvePoint(pts, d.index, nx, ny));
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setRemoving(false);
    if (d.removing) {
      const pts = clipCurves(useProjectStore.getState().project.clips[clip.id] as VisualClip)[channel];
      write(removeCurvePoint(pts, d.index));
      setSelected(-1);
    }
    if (d.moved) useProjectStore.getState().commit();
  };

  const removeAt = (index: number): void => {
    write(removeCurvePoint(points, index));
    setSelected(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (selected < 0 || selected >= points.length) return;
    const step = (e.shiftKey ? 10 : 1) / 255;
    const [x, y] = points[selected];
    let next: [number, number] | null = null;
    if (e.key === 'ArrowUp') next = [x, y + step];
    else if (e.key === 'ArrowDown') next = [x, y - step];
    else if (e.key === 'ArrowLeft') next = [x - step, y];
    else if (e.key === 'ArrowRight') next = [x + step, y];
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeAt(selected);
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setSelected((selected + (e.shiftKey ? points.length - 1 : 1)) % points.length);
      return;
    }
    if (next) {
      e.preventDefault();
      write(moveCurvePoint(points, selected, next[0], next[1]), `curve-nudge-${clip.id}`);
    }
  };

  const others = CURVE_CHANNELS.filter((ch) => ch !== channel && !isIdentityCurve(curves[ch]));
  const sel = selected >= 0 && selected < points.length ? points[selected] : null;
  const readout = drag.current && sel ? sel : hover ? [hover.x, monotoneCubic(points)(hover.x)] : sel;

  return (
    <div className="curves">
      <div className="curves__bar">
        <div className="segmented curves__tabs">
          {CURVE_CHANNELS.map((ch) => (
            <button key={ch} type="button" title={tMaybe(CHANNEL_META[ch].title)} className={ch === channel ? 'is-active' : ''} data-channel={ch} onClick={() => setPrefs({ curveChannel: ch })}>
              <span className="curves__dot" style={{ background: CHANNEL_META[ch].color }} />
              {CHANNEL_META[ch].label}
              {!isIdentityCurve(curves[ch]) && <span className="curves__mod" />}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn icon-btn--sm" title={t('Reset the {channel, select, master {master (all channels)} r {red} g {green} other {blue}} curve', { channel })} disabled={points.length <= 2 && isIdentityCurve(points)} onClick={() => write(identityCurve())}>
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="curves__graph" onContextMenu={(e) => e.preventDefault()}>
        <canvas ref={histRef} className="curves__hist" />
        <svg
          ref={svgRef}
          className={`curves__svg ${removing ? 'is-removing' : ''}`}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="none"
          tabIndex={0}
          data-curve-editor
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
          onDoubleClick={(e) => {
            const u = toUnit(e);
            const r = svgRef.current!.getBoundingClientRect();
            const i = points.findIndex(([px, py]) => Math.hypot((px - u.x) * r.width, (py - u.y) * r.height) < 9);
            if (i >= 0) removeAt(i);
          }}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f} className="curves__grid">
              <line x1={f * SIZE} y1={0} x2={f * SIZE} y2={SIZE} />
              <line x1={0} y1={f * SIZE} x2={SIZE} y2={f * SIZE} />
            </g>
          ))}
          <line className="curves__diag" x1={0} y1={SIZE} x2={SIZE} y2={0} />
          {others.map((ch) => (
            <path key={ch} d={pathFor(curves[ch])} className="curves__other" style={{ stroke: CHANNEL_META[ch].color }} />
          ))}
          <path d={pathFor(points)} className="curves__path" style={{ stroke: meta.color }} />
          {points.map(([x, y], i) => (
            <circle
              key={i}
              cx={x * SIZE}
              cy={(1 - y) * SIZE}
              r={i === selected ? 5 : 4}
              className={`curves__pt ${i === selected ? 'is-selected' : ''} ${i === selected && removing ? 'is-removing' : ''}`}
              style={{ stroke: meta.color, fill: i === selected ? meta.color : undefined }}
              onContextMenu={(e) => {
                e.stopPropagation();
                openContextMenu(e, [
                  { label: i === 0 || i === points.length - 1 ? t('Reset end point') : t('Delete point'), run: () => removeAt(i) },
                  { label: t('Reset {channel, select, master {master (all channels)} r {red} g {green} other {blue}} curve', { channel }), run: () => write(identityCurve()) },
                ]);
              }}
            />
          ))}
        </svg>
        {readout && (
          <div className="curves__readout mono">
            <span>{t('In {value}', { value: Math.round(readout[0] * 255) })}</span>
            <span>{t('Out {value}', { value: Math.round(Math.min(1, Math.max(0, readout[1])) * 255) })}</span>
          </div>
        )}
      </div>
      <div className="curves__foot">
        <span className="hint">{t('Click to add · drag (Shift = fine) · double-click or drag out to delete')}</span>
        {!isDefaultCurves(curves) && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCurves(ids, { master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() })}>
            {t('Reset all')}
          </button>
        )}
      </div>
    </div>
  );
}
