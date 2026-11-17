/**
 * Timeline clip decorations for time remapping and compound clips: the speed-ramp curve drawn
 * across a clip, its time tags, and the stacked mini summary of a compound clip's contents.
 */

import { memo, type ReactNode } from 'react';
import { clipEnd } from '@/core/time';
import { rampSpeedAt } from '@/core/timemap';
import type { Clip, CompoundClip } from '@/core/types';
import { formatSpeed } from './SpeedCurve';
import './time.css';

const LOG_MIN = Math.log2(0.1);
const LOG_MAX = Math.log2(16);

/** Small tags shown next to the clip name. */
export function TimeTags({ clip }: { clip: Clip }): ReactNode {
  if (clip.type === 'compound') {
    const n = Object.keys(clip.sequence.clips).length;
    return <span className="clip__tag">{n} clips</span>;
  }
  if (clip.type !== 'video' && clip.type !== 'audio') return null;
  if (clip.freeze) return <span className="clip__tag clip__tag--freeze">FREEZE</span>;
  return (
    <>
      {clip.speedRamp?.length ? (
        <span className="clip__tag clip__tag--time" title="Speed ramp">
          RAMP
        </span>
      ) : (
        Math.abs(clip.speed - 1) > 0.001 && <span className="clip__tag mono">{formatSpeed(clip.speed)}</span>
      )}
      {clip.reverse && (
        <span className="clip__tag" title="Reversed">
          ◀◀
        </span>
      )}
    </>
  );
}

/** The speed curve drawn along the bottom of a ramped clip (only the part on screen). */
export const RampOverlay = memo(function RampOverlay({ clip, pps, from, to, height }: { clip: Clip; pps: number; from: number; to: number; height: number }): ReactNode {
  if ((clip.type !== 'video' && clip.type !== 'audio') || !clip.speedRamp?.length || clip.freeze) return null;
  const ramp = clip.speedRamp;
  const h = Math.min(22, Math.max(10, height * 0.4));
  const y = (v: number): number => 2 + ((LOG_MAX - Math.log2(Math.min(16, Math.max(0.1, v)))) / (LOG_MAX - LOG_MIN)) * (h - 4);
  const a = Math.max(0, from);
  const b = Math.min(clip.duration * pps, to);
  if (b <= a) return null;
  const step = 3;
  let d = '';
  for (let x = a; x <= b + step; x += step) {
    const xx = Math.min(x, b);
    d += `${d ? 'L' : 'M'}${(xx - a).toFixed(1)},${y(rampSpeedAt(ramp, xx / pps)).toFixed(1)}`;
  }
  return (
    <svg className="clip__ramp" style={{ left: a, width: b - a, height: h }} width={b - a} height={h}>
      <line x1={0} x2={b - a} y1={y(1)} y2={y(1)} />
      <path d={d} />
    </svg>
  );
});

const TYPE_COLORS: Record<Clip['type'], string> = {
  video: 'var(--clip-video)',
  image: 'var(--clip-image)',
  audio: 'var(--clip-audio)',
  text: 'var(--clip-text)',
  sticker: 'var(--clip-sticker)',
  shape: 'var(--clip-shape)',
  generator: 'var(--clip-generator)',
  adjustment: 'var(--clip-adjustment)',
  compound: 'var(--clip-compound, #e3b341)',
};

/** Mini map of a compound clip's nested tracks and clips (visible window only). */
export const CompoundMini = memo(function CompoundMini({ clip, pps, from, to, height }: { clip: CompoundClip; pps: number; from: number; to: number; height: number }): ReactNode {
  const seq = clip.sequence;
  const used = new Set(Object.values(seq.clips).map((c) => c.trackId));
  const rows = seq.tracks.filter((t) => used.has(t.id));
  if (!rows.length || height < 36) return <span className="clip__stack" />;
  // Rows (one per nested track, top track first) centred in the space under the label.
  const area = height - 26;
  const shown = Math.max(1, Math.min(rows.length, Math.floor(area / 6)));
  const gap = Math.min(9, area / shown);
  const offset = Math.max(0, (area - gap * shown) / 2);
  const bars: ReactNode[] = [];
  const t0 = clip.trimIn;
  const t1 = clip.trimIn + clip.duration;
  rows.slice(0, shown).forEach((track, r) => {
    for (const c of Object.values(seq.clips)) {
      if (c.trackId !== track.id || clipEnd(c) <= t0 || c.start >= t1) continue;
      const x0 = (Math.max(c.start, t0) - t0) * pps;
      const x1 = (Math.min(clipEnd(c), t1) - t0) * pps;
      if (x1 < from || x0 > to || bars.length > 300) continue;
      bars.push(<i key={c.id} style={{ left: x0 + 1, width: Math.max(2, x1 - x0 - 2), top: offset + r * gap + (gap - 5) / 2, ['--k' as string]: TYPE_COLORS[c.type] }} />);
    }
  });
  return (
    <>
      <span className="clip__stack" />
      <span className="clip__mini">{bars}</span>
    </>
  );
});
