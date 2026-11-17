/**
 * Lift / gamma / gain / offset colour wheels. Drag anywhere on a wheel to push its puck (it
 * follows the pointer; Shift = fine), double-click to re-centre. The bar under each wheel sets
 * its luma (drag, mouse wheel, double-click to reset). Wheels are laid out like the vectorscope.
 */

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { hueToScopeAngle, isNeutralWheel, isNeutralWheels, scopeAngleToHue, WHEEL_IDS, wheelChroma, type WheelId } from '@/core/color/wheels';
import type { ID, VisualClip, WheelValue } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { clipWheels, resetWheels, setWheel } from './gradeEdit';

const LABELS: Record<WheelId, string> = { lift: 'Lift', gamma: 'Gamma', gain: 'Gain', offset: 'Offset' };
const TIPS: Record<WheelId, string> = {
  lift: 'Shadows: tint and raise / lower the blacks',
  gamma: 'Midtones: tint and brighten / darken the mids',
  gain: 'Highlights: tint and brighten / darken the whites',
  offset: 'Everything: shift the whole image',
};

/** Disc background: the Cb/Cr plane at mid luminance, fading to grey in the centre. */
const discCache = new Map<number, string>();
function discImage(px: number): string {
  const hit = discCache.get(px);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const R = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (x + 0.5 - R) / R;
      const dy = (R - y - 0.5) / R;
      const r = Math.hypot(dx, dy);
      const o = (y * px + x) * 4;
      if (r > 1.02) continue;
      const a = Math.atan2(dy, dx);
      // Muted chroma that grows towards the rim, on a dark neutral base (like a grading panel).
      const k = Math.pow(Math.min(1, r), 1.1) * 0.3;
      const cb = Math.cos(a) * k;
      const cr = Math.sin(a) * k;
      const Y = 0.26 + 0.06 * (1 - r);
      const rr = Y + 1.5748 * cr;
      const bb = Y + 1.8556 * cb;
      const gg = Y - 0.187324 * cb - 0.468124 * cr;
      const edge = Math.min(1, Math.max(0, (1.02 - r) * R));
      img.data[o] = Math.min(255, Math.max(0, rr * 255));
      img.data[o + 1] = Math.min(255, Math.max(0, gg * 255));
      img.data[o + 2] = Math.min(255, Math.max(0, bb * 255));
      img.data[o + 3] = 255 * edge;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  discCache.set(px, url);
  return url;
}

function puckOf(w: WheelValue): { x: number; y: number } {
  const a = (hueToScopeAngle(w.hue) * Math.PI) / 180;
  return { x: Math.cos(a) * w.amount, y: Math.sin(a) * w.amount };
}

function Wheel({ id, clip, ids }: { id: WheelId; clip: VisualClip; ids: ID[] }): ReactNode {
  const w = clipWheels(clip)[id];
  const discRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'puck' | 'luma'; x: number; y: number; px: number; py: number; luma: number; moved: boolean } | null>(null);
  const puck = puckOf(w);
  const chroma = wheelChroma(w.hue, w.amount);
  const neutral = isNeutralWheel(w);

  // Mouse wheel on the luma bar (non-passive so the inspector does not scroll).
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const latest = clipWheels(useProjectStore.getState().project.clips[clip.id] as VisualClip)[id];
      const step = (e.shiftKey ? 0.002 : 0.01) * (e.deltaY < 0 ? 1 : -1);
      setWheel(ids, useProjectStore.getState().project.clips[clip.id] as VisualClip, id, { luma: Math.min(1, Math.max(-1, Math.round((latest.luma + step) * 1000) / 1000)) }, `wheel-luma-${id}`);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clip.id, id, ids]);

  const down = (kind: 'puck' | 'luma') => (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, px: puck.x, py: puck.y, luma: w.luma, moved: false };
  };
  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 2) return;
      d.moved = true;
      useProjectStore.getState().begin();
    }
    const fine = e.shiftKey ? 0.2 : 1;
    const latestClip = useProjectStore.getState().project.clips[clip.id] as VisualClip;
    if (d.kind === 'puck') {
      const R = (discRef.current?.clientWidth ?? 120) / 2;
      let x = d.px + ((e.clientX - d.x) / R) * fine;
      let y = d.py - ((e.clientY - d.y) / R) * fine;
      const r = Math.hypot(x, y);
      if (r > 1) {
        x /= r;
        y /= r;
      }
      const amount = Math.min(1, Math.hypot(x, y));
      const hue = amount > 1e-4 ? scopeAngleToHue((Math.atan2(y, x) * 180) / Math.PI) : clipWheels(latestClip)[id].hue;
      setWheel(ids, latestClip, id, { hue: Math.round(hue * 10) / 10, amount: Math.round(amount * 10000) / 10000 });
    } else {
      const width = barRef.current?.clientWidth ?? 100;
      const luma = Math.min(1, Math.max(-1, d.luma + ((e.clientX - d.x) / width) * 2 * fine));
      setWheel(ids, latestClip, id, { luma: Math.round(luma * 1000) / 1000 });
    }
  };
  const up = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d?.moved) useProjectStore.getState().commit();
  };

  const lumaPct = ((w.luma + 1) / 2) * 100;
  return (
    <div className={`wheel ${neutral ? '' : 'is-active'}`} data-wheel={id} title={TIPS[id]}>
      <div className="wheel__head">
        <span className="wheel__name">{LABELS[id]}</span>
        <button type="button" className="icon-btn icon-btn--sm wheel__reset" title={`Reset ${LABELS[id].toLowerCase()}`} disabled={neutral} onClick={() => setWheel(ids, clip, id, { hue: 0, amount: 0, luma: 0 })}>
          <RotateCcw size={11} />
        </button>
      </div>
      <div
        ref={discRef}
        className="wheel__disc"
        style={{ backgroundImage: `url(${discImage(192)})` }}
        onPointerDown={down('puck')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => setWheel(ids, clip, id, { amount: 0 })}
      >
        <span className="wheel__cross wheel__cross--h" />
        <span className="wheel__cross wheel__cross--v" />
        <span className="wheel__ring" />
        <span
          className="wheel__puck"
          style={{
            left: `${50 + puck.x * 50}%`,
            top: `${50 - puck.y * 50}%`,
            background: `rgb(${[0, 1, 2].map((c) => Math.round(Math.min(1, Math.max(0, 0.55 + chroma[c] * 0.9)) * 255)).join(',')})`,
          }}
        />
      </div>
      <div
        ref={barRef}
        className="wheel__luma"
        onPointerDown={down('luma')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => setWheel(ids, clip, id, { luma: 0 })}
        title="Luma: drag or scroll (Shift = fine), double-click to reset"
      >
        <span className="wheel__luma-fill" style={{ left: `${Math.min(50, lumaPct)}%`, width: `${Math.abs(lumaPct - 50)}%` }} />
        <span className="wheel__luma-knob" style={{ left: `${lumaPct}%` }} />
      </div>
      <div className="wheel__vals mono">
        <span title="Hue / amount">{w.amount > 0.0005 ? `${Math.round(w.hue)}° ${Math.round(w.amount * 100)}%` : '—'}</span>
        <span title="Luma">{`${w.luma >= 0 ? '+' : ''}${w.luma.toFixed(2)}`}</span>
      </div>
    </div>
  );
}

export function ColorWheels({ clip, ids }: { clip: VisualClip; ids: ID[] }): ReactNode {
  const neutral = isNeutralWheels(clipWheels(clip));
  return (
    <div className="wheels">
      <div className="wheels__grid">
        {WHEEL_IDS.map((id) => (
          <Wheel key={id} id={id} clip={clip} ids={ids} />
        ))}
      </div>
      <div className="wheels__foot">
        <span className="hint">Drag to tint · Shift = fine · double-click resets</span>
        {!neutral && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => resetWheels(ids)}>
            Reset all
          </button>
        )}
      </div>
    </div>
  );
}
