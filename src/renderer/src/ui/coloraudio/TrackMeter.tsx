/**
 * Live stereo peak meter for a timeline track header. Every meter is driven by one shared
 * animation loop that only runs while the preview plays; levels come from the track's bus in the
 * preview mixer (engine.trackLevels). Peaks hold for 1.5 s, then fall at 24 dB/s.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { ID, Project } from '@/core/types';
import { engine, usePlayback } from '@/engine/engine';

const FLOOR_DB = -60;
const HOLD_MS = 1500;
const FALL_DB_PER_S = 24;
const RELEASE_DB_PER_S = 26;

const toDb = (v: number): number => (v <= 1e-6 ? -120 : 20 * Math.log10(v));
/** Meter position 0..1 for a dBFS value (finer resolution near the top, like console meters). */
export function meterPos(db: number): number {
  if (db <= FLOOR_DB) return 0;
  if (db >= 0) return 1;
  const t = (db - FLOOR_DB) / -FLOOR_DB;
  return Math.pow(t, 1.6);
}

interface MeterEl {
  trackId: ID;
  root: HTMLElement;
  fills: [HTMLElement, HTMLElement];
  holds: [HTMLElement, HTMLElement];
  level: [number, number];
  peak: [number, number];
  peakAt: [number, number];
  lastFrame: number;
}

const meters = new Set<MeterEl>();
let raf = 0;

function frame(): void {
  raf = 0;
  const now = performance.now();
  let active = engine.playing;
  for (const m of meters) {
    const dt = Math.min(0.1, (now - m.lastFrame) / 1000);
    m.lastFrame = now;
    const lv = engine.trackLevels(m.trackId);
    for (let c = 0; c < 2; c++) {
      const db = lv ? toDb(lv[c]) : -120;
      // Instant attack, smooth release.
      m.level[c] = db > m.level[c] ? db : Math.max(db, m.level[c] - RELEASE_DB_PER_S * dt);
      if (db >= m.peak[c]) {
        m.peak[c] = db;
        m.peakAt[c] = now;
      } else if (now - m.peakAt[c] > HOLD_MS) {
        m.peak[c] = Math.max(-120, m.peak[c] - FALL_DB_PER_S * dt);
      }
      // Reveal a fixed gradient from the bottom so red only ever appears near 0 dBFS.
      m.fills[c].style.clipPath = `inset(${((1 - meterPos(m.level[c])) * 100).toFixed(2)}% 0 0 0)`;
      const hp = meterPos(m.peak[c]);
      m.holds[c].style.bottom = `${(hp * 100).toFixed(2)}%`;
      m.holds[c].style.opacity = hp > 0.001 ? '1' : '0';
      m.holds[c].classList.toggle('is-clip', m.peak[c] > -0.5);
      if (m.level[c] > -119 || m.peak[c] > -119) active = true;
    }
    m.root.dataset.level = Math.max(m.level[0], m.level[1]).toFixed(1);
    m.root.dataset.peak = Math.max(m.peak[0], m.peak[1]).toFixed(1);
  }
  if (active && meters.size) raf = requestAnimationFrame(frame);
}

function kick(): void {
  if (!raf && meters.size) raf = requestAnimationFrame(frame);
}

usePlayback.subscribe((s, prev) => {
  if (s.playing && !prev.playing) {
    for (const m of meters) m.lastFrame = performance.now();
    kick();
  }
});

/** Tracks that carry sound: every audio track, plus visual tracks holding video clips with audio. */
export function soundTrackIds(project: Project): Set<ID> {
  const out = new Set<ID>(project.tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
  for (const c of Object.values(project.clips)) {
    if (c.type === 'video' && project.assets[c.assetId]?.hasAudio) out.add(c.trackId);
  }
  return out;
}

export function TrackMeter({ trackId, muted }: { trackId: ID; muted: boolean }): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = (s: string): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(s));
    const fills = q('.track-meter__fill');
    const holds = q('.track-meter__hold');
    const m: MeterEl = {
      trackId,
      root: el,
      fills: [fills[0], fills[1]],
      holds: [holds[0], holds[1]],
      level: [-120, -120],
      peak: [-120, -120],
      peakAt: [0, 0],
      lastFrame: performance.now(),
    };
    meters.add(m);
    kick();
    return () => {
      meters.delete(m);
    };
  }, [trackId]);
  return (
    <div ref={root} className={`track-meter ${muted ? 'is-muted' : ''}`} data-track-meter={trackId} title={muted ? 'Track muted' : 'Track level (peak, dBFS)'} data-level="-120" data-peak="-120">
      {[0, 1].map((c) => (
        <span key={c} className="track-meter__ch">
          <span className="track-meter__fill" />
          <span className="track-meter__hold" />
        </span>
      ))}
    </div>
  );
}
