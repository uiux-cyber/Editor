/**
 * Docked video scopes (waveform, RGB parade, vectorscope, histogram) next to the preview,
 * toggled from the preview transport. Fed by the frame tap (reduced-resolution GPU readback,
 * throttled while playing); drawing happens directly on canvases, outside React renders.
 */

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { engine } from '@/engine/engine';
import { computeScopes, DEFAULT_VECTOR_RANGE, type ScopeData } from '@/engine/scopes/analyze';
import { frameTap } from '@/engine/scopes/frameTap';
import { Segmented } from '../common/controls';
import { useColorAudioPrefs, type ScopeMode } from './prefs';
import { drawHistogram, drawVectorscope, drawWaveform } from './scopeDraw';

type ScopeKind = 'waveform' | 'parade' | 'vector' | 'histogram';
type Drawer = (d: ScopeData) => void;

const TITLES: Record<ScopeKind, string> = { waveform: 'Waveform', parade: 'RGB parade', vector: 'Vectorscope', histogram: 'Histogram' };

function ScopeCanvas({ kind, register, range }: { kind: ScopeKind; register: (kind: ScopeKind, d: Drawer | null) => void; range: number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<ScopeData | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw: Drawer = (d) => {
      last.current = d;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      if (w < 4 || h < 4) return;
      if (kind === 'waveform') drawWaveform(ctx, w, h, dpr, d, 'luma');
      else if (kind === 'parade') drawWaveform(ctx, w, h, dpr, d, 'parade');
      else if (kind === 'vector') drawVectorscope(ctx, w, h, dpr, d, range);
      else drawHistogram(ctx, w, h, dpr, d);
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (last.current) draw(last.current);
      }
    });
    ro.observe(canvas);
    register(kind, draw);
    return () => {
      ro.disconnect();
      register(kind, null);
    };
  }, [kind, register, range]);

  return (
    <div className="scope" data-scope={kind}>
      <span className="scope__title">{TITLES[kind]}</span>
      <canvas ref={ref} className="scope__canvas" />
    </div>
  );
}

const KINDS: Record<ScopeMode, ScopeKind[]> = {
  waveform: ['waveform'],
  parade: ['parade'],
  vector: ['vector'],
  histogram: ['histogram'],
  quad: ['waveform', 'vector', 'parade', 'histogram'],
};

export function ScopesPanel(): ReactNode {
  const mode = useColorAudioPrefs((s) => s.scopeMode);
  const zoom = useColorAudioPrefs((s) => s.vectorZoom);
  const width = useColorAudioPrefs((s) => s.scopesWidth);
  const set = useColorAudioPrefs((s) => s.set);
  const drawers = useRef(new Map<ScopeKind, Drawer>());
  const data = useRef<ScopeData | undefined>(undefined);
  const statsRef = useRef<HTMLSpanElement>(null);
  const range = DEFAULT_VECTOR_RANGE / zoom;
  const register = useRef((kind: ScopeKind, d: Drawer | null) => {
    if (d) {
      drawers.current.set(kind, d);
      if (data.current) d(data.current);
    } else drawers.current.delete(kind);
  }).current;

  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    return frameTap.subscribe((f) => {
      data.current = computeScopes(f.data, f.width, f.height, { columns: Math.min(f.width, 320), vectorRange: range }, data.current);
      for (const draw of drawers.current.values()) draw(data.current);
      const now = performance.now();
      const el = statsRef.current;
      if (!el) return;
      if (!engine.playing) {
        // Paused: scopes refresh on every edit; show the analysed size only.
        frames = 0;
        since = now;
        el.textContent = `${f.width}×${f.height}`;
      } else if (++frames && now - since > 500) {
        el.textContent = `${f.width}×${f.height} · ${Math.round((frames * 1000) / (now - since))} Hz`;
        frames = 0;
        since = now;
      }
    });
  }, [range]);

  const kinds = KINDS[mode];
  const resize = useRef<{ x: number; w: number } | null>(null);

  return (
    <aside className="scopes" style={{ width }} data-scopes>
      <div
        className="scopes__resizer"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          resize.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => {
          const r = resize.current;
          if (r) set({ scopesWidth: Math.min(720, Math.max(240, r.w - (e.clientX - r.x))) });
        }}
        onPointerUp={() => (resize.current = null)}
      />
      <header className="scopes__head">
        <Segmented<ScopeMode>
          value={mode}
          onChange={(v) => set({ scopeMode: v })}
          options={[
            { value: 'quad', label: '4-up', title: 'All four scopes' },
            { value: 'waveform', label: 'Wave', title: 'Luma waveform' },
            { value: 'parade', label: 'Parade', title: 'RGB parade' },
            { value: 'vector', label: 'Vector', title: 'Vectorscope' },
            { value: 'histogram', label: 'Histo', title: 'Histogram' },
          ]}
        />
        <button type="button" className="icon-btn icon-btn--sm" title="Close scopes" onClick={() => set({ scopesOpen: false })}>
          <X size={13} />
        </button>
      </header>
      <div className={`scopes__grid scopes__grid--${kinds.length === 4 ? 'quad' : 'single'}`}>
        {kinds.map((k) => (
          <ScopeCanvas key={k} kind={k} register={register} range={range} />
        ))}
      </div>
      <footer className="scopes__foot">
        <span ref={statsRef} className="mono">—</span>
        {kinds.includes('vector') && (
          <button type="button" className={`chip ${zoom === 2 ? 'is-active' : ''}`} title="Magnify the vectorscope" onClick={() => set({ vectorZoom: zoom === 2 ? 1 : 2 })}>
            Vector 2×
          </button>
        )}
      </footer>
    </aside>
  );
}

export function ScopesDock(): ReactNode {
  const open = useColorAudioPrefs((s) => s.scopesOpen);
  return open ? <ScopesPanel /> : null;
}
