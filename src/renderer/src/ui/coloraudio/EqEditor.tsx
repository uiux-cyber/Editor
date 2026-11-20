/**
 * Parametric EQ editor: an interactive frequency-response graph (drag a node for frequency /
 * gain, mouse wheel for Q, double-click the graph to add a band, double-click a node to remove
 * it, right-click for the band type) above a precise band list, with presets.
 * The drawn response is computed with the exact Web Audio biquad formulas (core/audiofx/eq.ts).
 */

import { Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  bandResponseDb,
  defaultBandAt,
  EQ_MAX_BANDS,
  EQ_MAX_FREQ,
  EQ_MAX_GAIN,
  EQ_MAX_Q,
  EQ_MIN_FREQ,
  EQ_MIN_Q,
  EQ_PRESETS,
  EQ_TYPE_LABEL,
  EQ_TYPES,
  eqResponseDb,
  formatFrequency,
  getEqPreset,
  logFrequencies,
  sanitizeEq,
  typeHasGain,
  typeHasQ,
  type EqType,
} from '@/core/audiofx/eq';
import type { AudioClip, EqBand, ID, VideoClip } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { editClips } from '../actions';
import { NumberInput, Select } from '../common/controls';
import { openContextMenu } from '../common/overlays';
import { tk, tMaybe, useT } from '../i18n';

type MediaClip = VideoClip | AudioClip;

/** Band type names of EQ_TYPE_LABEL (core/audiofx/eq.ts), translated where shown. */
const TYPE_LABELS = new Set<string>([tk('High-pass'), tk('Low shelf'), tk('Bell'), tk('High shelf'), tk('Low-pass')]);
const typeLabel = (type: EqType): string => (TYPE_LABELS.has(EQ_TYPE_LABEL[type]) ? tMaybe(EQ_TYPE_LABEL[type]) : EQ_TYPE_LABEL[type]);

export const BAND_COLORS = ['#f472b6', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f87171'];

const W = 300;
const H = 150;
const DB_RANGE = 18;
const FREQS = logFrequencies(240);
const GRID_F = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

const xOf = (f: number): number => (Math.log(f / EQ_MIN_FREQ) / Math.log(EQ_MAX_FREQ / EQ_MIN_FREQ)) * W;
const fOf = (x: number): number => EQ_MIN_FREQ * Math.pow(EQ_MAX_FREQ / EQ_MIN_FREQ, Math.min(1, Math.max(0, x / W)));
const yOf = (db: number): number => H / 2 - (Math.max(-DB_RANGE * 1.4, Math.min(DB_RANGE * 1.4, db)) / DB_RANGE) * (H / 2 - 8);
const dbOf = (y: number): number => ((H / 2 - y) / (H / 2 - 8)) * DB_RANGE;

export function setEq(ids: ID[], bands: EqBand[], coalesce?: string): void {
  editClips(
    ids,
    (c) => {
      if (c.type !== 'video' && c.type !== 'audio') return;
      if (bands.length) c.eq = bands.map((b) => ({ ...b }));
      else delete c.eq;
    },
    coalesce,
  );
}

function curvePath(values: ArrayLike<number>): string {
  let d = '';
  for (let i = 0; i < FREQS.length; i++) d += `${i === 0 ? 'M' : 'L'}${xOf(FREQS[i]).toFixed(1)},${yOf(values[i]).toFixed(1)}`;
  return d;
}

function nodePos(b: EqBand): { x: number; y: number } {
  return { x: xOf(b.frequency), y: typeHasGain(b.type) ? yOf(b.gain) : yOf(bandResponseDb(b, b.frequency)) };
}

export function EqEditor({ clip, ids }: { clip: MediaClip; ids: ID[] }): ReactNode {
  const tr = useT();
  const bands = useMemo(() => sanitizeEq(clip.eq), [clip.eq]);
  const [selected, setSelected] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; x: number; y: number; f: number; g: number; moved: boolean; pointerId: number } | null>(null);
  const total = useMemo(() => eqResponseDb(bands, FREQS), [bands]);
  const sel = selected < bands.length ? selected : bands.length - 1;

  const latest = (): EqBand[] => {
    const c = useProjectStore.getState().project.clips[clip.id];
    return c && (c.type === 'video' || c.type === 'audio') ? sanitizeEq(c.eq) : bands;
  };
  const updateBand = (index: number, patch: Partial<EqBand>, coalesce?: string): void => {
    const next = latest().map((b, i) => (i === index ? { ...b, ...patch } : b));
    setEq(ids, sanitizeEq(next), coalesce);
  };
  const removeBand = (index: number): void => {
    setEq(ids, latest().filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };
  const addBand = (band: EqBand): void => {
    const cur = latest();
    if (cur.length >= EQ_MAX_BANDS) return;
    setEq(ids, [...cur, band]);
    setSelected(cur.length);
  };

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onNodeDown = (index: number) => (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelected(index);
    const b = bands[index];
    drag.current = { index, x: e.clientX, y: e.clientY, f: b.frequency, g: b.gain, moved: false, pointerId: e.pointerId };
  };
  const onNodeMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 2) return;
      d.moved = true;
      useProjectStore.getState().begin();
    }
    const r = svgRef.current!.getBoundingClientRect();
    const fine = e.shiftKey ? 0.2 : 1;
    const dx = ((e.clientX - d.x) / r.width) * W * fine;
    const dy = ((e.clientY - d.y) / r.height) * H * fine;
    const f = Math.round(Math.min(EQ_MAX_FREQ, Math.max(EQ_MIN_FREQ, fOf(xOf(d.f) + dx))));
    const band = latest()[d.index];
    if (!band) return;
    const patch: Partial<EqBand> = { frequency: f };
    if (typeHasGain(band.type)) patch.gain = Math.round(Math.min(EQ_MAX_GAIN, Math.max(-EQ_MAX_GAIN, dbOf(yOf(d.g) + dy))) * 10) / 10;
    updateBand(d.index, patch);
  };
  const onNodeUp = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved) useProjectStore.getState().commit();
  };
  // Mouse wheel over a node changes its Q (native listener: React's wheel events are passive).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => undefined);
  wheelRef.current = (e: WheelEvent): void => {
    const node = (e.target as Element).closest?.('[data-band]');
    if (!node) return;
    e.preventDefault();
    const index = Number(node.getAttribute('data-band'));
    const b = latest()[index];
    if (!b || !typeHasQ(b.type)) return;
    const k = Math.pow(1.12, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.25 : 1));
    setSelected(index);
    updateBand(index, { q: Math.round(Math.min(EQ_MAX_Q, Math.max(EQ_MIN_Q, b.q * k)) * 1000) / 1000 }, `eq-q-${clip.id}-${index}`);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fn = (e: WheelEvent): void => wheelRef.current(e);
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

  const typeMenu = (index: number, e: React.MouseEvent): void => {
    const b = bands[index];
    openContextMenu(e, [
      { type: 'label', label: tr('Band {number}', { number: index + 1 }) },
      ...EQ_TYPES.map((t) => ({ label: typeLabel(t), checked: b.type === t, run: () => updateBand(index, { type: t, q: t === 'peaking' ? 1 : 0.707 }) })),
      { type: 'separator' as const },
      { label: tr('Remove band'), danger: true, run: () => removeBand(index) },
    ]);
  };

  return (
    <div className="eq">
      <div className="eq__bar">
        <Select
          value=""
          style={{ flex: 1 }}
          options={[{ value: '', label: tr('Presets…') }, ...EQ_PRESETS.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(id) => {
            const p = getEqPreset(id);
            if (p) {
              setEq(ids, p.bands);
              setSelected(0);
            }
          }}
        />
        <button type="button" className="icon-btn icon-btn--sm" title={tr('Add a band')} disabled={bands.length >= EQ_MAX_BANDS} onClick={() => addBand(defaultBandAt(1000))}>
          <Plus size={13} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" title={tr('Remove all bands')} disabled={bands.length === 0} onClick={() => setEq(ids, [])}>
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="eq__graph">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          data-eq-graph
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('eq__bg')) return;
            const p = local(e);
            addBand(defaultBandAt(fOf(p.x), Math.max(-EQ_MAX_GAIN, Math.min(EQ_MAX_GAIN, dbOf(p.y)))));
          }}
        >
          <rect className="eq__bg" x={0} y={0} width={W} height={H} />
          {GRID_F.map((f) => (
            <g key={f}>
              <line className="eq__grid" x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} />
              <text className="eq__label" x={xOf(f) + 2} y={H - 3}>
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            </g>
          ))}
          {[-12, -6, 6, 12].map((db) => (
            <g key={db}>
              <line className="eq__grid" x1={0} x2={W} y1={yOf(db)} y2={yOf(db)} />
              <text className="eq__label" x={3} y={yOf(db) - 2}>
                {db > 0 ? `+${db}` : db}
              </text>
            </g>
          ))}
          <line className="eq__zero" x1={0} x2={W} y1={yOf(0)} y2={yOf(0)} />
          {bands.map((b, i) => {
            const single = FREQS.map((f) => bandResponseDb(b, f));
            return <path key={i} className={`eq__band ${i === sel ? 'is-selected' : ''}`} d={`${curvePath(single)}L${W},${yOf(0)}L0,${yOf(0)}Z`} style={{ fill: BAND_COLORS[i % BAND_COLORS.length], stroke: BAND_COLORS[i % BAND_COLORS.length] }} />;
          })}
          <path className="eq__total" d={curvePath(total)} />
          {bands.map((b, i) => {
            const p = nodePos(b);
            return (
              <g key={i} className={`eq__node ${i === sel ? 'is-selected' : ''}`} data-band={i} onPointerDown={onNodeDown(i)} onPointerMove={onNodeMove} onPointerUp={onNodeUp} onPointerCancel={onNodeUp} onDoubleClick={(e) => {
                e.stopPropagation();
                removeBand(i);
              }} onContextMenu={(e) => typeMenu(i, e)}>
                <circle cx={p.x} cy={Math.max(6, Math.min(H - 6, p.y))} r={9} className="eq__hit" />
                <circle cx={p.x} cy={Math.max(6, Math.min(H - 6, p.y))} r={i === sel ? 5.5 : 4.5} style={{ fill: BAND_COLORS[i % BAND_COLORS.length] }} />
                <text x={p.x} y={Math.max(6, Math.min(H - 6, p.y)) + 3} className="eq__num">
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
        {bands.length === 0 && <div className="eq__empty">{tr('Double-click to add a band, or pick a preset')}</div>}
      </div>
      {bands.length > 0 && (
        <div className="eq__bands">
          {bands.map((b, i) => (
            <div key={i} className={`eq__row ${i === sel ? 'is-selected' : ''}`} onPointerDown={() => setSelected(i)}>
              <span className="eq__dot" style={{ background: BAND_COLORS[i % BAND_COLORS.length] }}>
                {i + 1}
              </span>
              <Select<EqType> value={b.type} style={{ width: 84, flex: 'none', height: 24 }} options={EQ_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))} onChange={(t) => updateBand(i, { type: t, q: t === 'peaking' ? 1 : 0.707 })} />
              <NumberInput value={b.frequency} min={EQ_MIN_FREQ} max={EQ_MAX_FREQ} step={10} suffix="Hz" onChange={(v) => updateBand(i, { frequency: Math.round(v) }, `eq-f-${clip.id}-${i}`)} title={formatFrequency(b.frequency)} />
              <NumberInput value={b.gain} min={-EQ_MAX_GAIN} max={EQ_MAX_GAIN} step={0.5} precision={1} suffix="dB" disabled={!typeHasGain(b.type)} mixed={!typeHasGain(b.type)} onChange={(v) => updateBand(i, { gain: v }, `eq-g-${clip.id}-${i}`)} />
              <NumberInput value={b.q} min={EQ_MIN_Q} max={EQ_MAX_Q} step={0.05} precision={2} prefix="Q" disabled={!typeHasQ(b.type)} mixed={!typeHasQ(b.type)} title={typeHasQ(b.type) ? tr('Bandwidth (scroll a node to change)') : tr('Shelves use a fixed slope')} onChange={(v) => updateBand(i, { q: v }, `eq-q-${clip.id}-${i}`)} />
              <button type="button" className="icon-btn icon-btn--sm" title={tr('Remove band')} onClick={() => removeBand(i)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="hint">{tr('Drag nodes (Shift = fine) · scroll a node for Q · right-click for type')}</p>
    </div>
  );
}
