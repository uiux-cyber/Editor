/**
 * Compressor editor: presets, threshold / ratio / attack / release / make-up, a transfer graph
 * (the node's real knee curve) and a live gain-reduction meter while the preview plays.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { COMPRESSOR_LIMITS, COMPRESSOR_PRESETS, DEFAULT_COMPRESSOR, getCompressorPreset, sanitizeCompressor, staticCurveDb } from '@/core/audiofx/compressor';
import type { AudioClip, CompressorSettings, ID, VideoClip } from '@/core/types';
import { compressorReduction } from '@/engine/audio/ext/compressor';
import { usePlayback } from '@/engine/engine';
import { editClips } from '../actions';
import { Select, SliderField } from '../common/controls';
import { useT } from '../i18n';

type MediaClip = VideoClip | AudioClip;

export function setCompressor(ids: ID[], patch: Partial<CompressorSettings> | null, coalesce?: string): void {
  editClips(
    ids,
    (c) => {
      if (c.type !== 'video' && c.type !== 'audio') return;
      if (patch === null) delete c.compressor;
      else c.compressor = sanitizeCompressor({ ...(c.compressor ?? DEFAULT_COMPRESSOR), ...patch });
    },
    coalesce,
  );
}

const G = 116; // transfer graph size (SVG units)
const LO = -60;
const pos = (db: number): number => ((db - LO) / -LO) * G;

function TransferGraph({ s }: { s: CompressorSettings }): ReactNode {
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const inDb = LO + (i / 60) * -LO;
    const out = Math.min(6, staticCurveDb(s, inDb));
    d += `${i === 0 ? 'M' : 'L'}${pos(inDb).toFixed(1)},${(G - pos(out)).toFixed(1)}`;
  }
  return (
    <svg className="comp__graph" viewBox={`0 0 ${G} ${G}`} data-comp-graph>
      {[-48, -36, -24, -12].map((db) => (
        <g key={db}>
          <line className="eq__grid" x1={pos(db)} x2={pos(db)} y1={0} y2={G} />
          <line className="eq__grid" x1={0} x2={G} y1={G - pos(db)} y2={G - pos(db)} />
        </g>
      ))}
      <line className="comp__unity" x1={0} y1={G} x2={G} y2={0} />
      <line className="comp__thresh" x1={pos(s.threshold)} x2={pos(s.threshold)} y1={0} y2={G} />
      <path className={`comp__curve ${s.enabled ? '' : 'is-off'}`} d={d} />
    </svg>
  );
}

function ReductionMeter({ clipId }: { clipId: ID }): ReactNode {
  const t = useT();
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const playing = usePlayback((s) => s.playing);
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    const tick = (): void => {
      const r = playing ? (compressorReduction(clipId) ?? 0) : 0;
      shown = r > shown ? r : shown * 0.85 + r * 0.15;
      const pct = Math.min(1, shown / 24);
      if (fill.current) fill.current.style.transform = `scaleY(${pct.toFixed(3)})`;
      if (label.current) {
        label.current.textContent = shown > 0.05 ? `−${shown.toFixed(1)}` : '0.0';
        label.current.parentElement?.setAttribute('data-gr', shown.toFixed(2));
      }
      if (playing || shown > 0.01) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clipId]);
  return (
    <div className="comp__gr" title={t('Gain reduction (dB)')} data-gr="0">
      <div className="comp__gr-track">
        <div ref={fill} className="comp__gr-fill" />
        {[6, 12, 18].map((db) => (
          <span key={db} className="comp__gr-tick" style={{ top: `${(db / 24) * 100}%` }} />
        ))}
      </div>
      <span ref={label} className="comp__gr-val mono">
        0.0
      </span>
      <span className="comp__gr-cap">GR</span>
    </div>
  );
}

export function CompressorEditor({ clip, ids }: { clip: MediaClip; ids: ID[] }): ReactNode {
  const t = useT();
  const s = sanitizeCompressor(clip.compressor ?? { ...DEFAULT_COMPRESSOR, enabled: false });
  const on = !!clip.compressor && clip.compressor.enabled !== false;
  const L = COMPRESSOR_LIMITS;
  const edit = (patch: Partial<CompressorSettings>): void => setCompressor(ids, { ...patch, enabled: true });
  return (
    <div className={`comp ${on ? '' : 'is-off'}`}>
      <div className="comp__top">
        <TransferGraph s={{ ...s, enabled: on }} />
        <ReductionMeter clipId={clip.id} />
        <div className="comp__side">
          <Select
            value=""
            options={[{ value: '', label: t('Presets…') }, ...COMPRESSOR_PRESETS.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(id) => {
              const p = getCompressorPreset(id);
              if (p) setCompressor(ids, p.settings);
            }}
          />
          <div className="comp__summary mono">
            <span>{s.threshold.toFixed(0)} dB</span>
            <span>{s.ratio.toFixed(1)}:1</span>
            <span>+{s.makeup.toFixed(1)} dB</span>
          </div>
        </div>
      </div>
      <SliderField label={t('Threshold')} value={s.threshold} min={L.threshold.min} max={L.threshold.max} step={0.5} precision={1} suffix="dB" defaultValue={DEFAULT_COMPRESSOR.threshold} onChange={(v) => edit({ threshold: v })} />
      <SliderField label={t('Ratio')} value={s.ratio} min={L.ratio.min} max={L.ratio.max} step={0.1} precision={1} suffix=":1" defaultValue={DEFAULT_COMPRESSOR.ratio} onChange={(v) => edit({ ratio: v })} />
      <SliderField label={t('Attack')} value={s.attack} min={0.0005} max={0.1} step={0.0005} scale={1000} precision={1} suffix="ms" defaultValue={DEFAULT_COMPRESSOR.attack} onChange={(v) => edit({ attack: v })} />
      <SliderField label={t('Release')} value={s.release} min={L.release.min} max={L.release.max} step={0.005} scale={1000} precision={0} suffix="ms" defaultValue={DEFAULT_COMPRESSOR.release} onChange={(v) => edit({ release: v })} />
      <SliderField label={t('Make-up')} value={s.makeup} min={L.makeup.min} max={L.makeup.max} step={0.1} precision={1} suffix="dB" defaultValue={DEFAULT_COMPRESSOR.makeup} onChange={(v) => edit({ makeup: v })} />
    </div>
  );
}
