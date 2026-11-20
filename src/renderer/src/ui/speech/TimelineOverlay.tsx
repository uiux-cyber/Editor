import { memo, type ReactNode } from 'react';
import { useProjectStore } from '@/store/project';
import { formatNumber, useLocale } from '../i18n';
import { timeToX } from '../timeline/geometry';
import { DOWNBEAT_COLOR, isBeatMarker } from './beats';
import { useSpeech } from './store';

/**
 * Timeline overlay for the speech & audio tools: detected silences (pending review) and the beat
 * grid from beat markers (downbeats emphasised). Purely visual — never intercepts the pointer.
 */
export const SpeechTimelineOverlay = memo(function SpeechTimelineOverlay({ pps, top, height, viewLeft, viewWidth }: { pps: number; top: number; height: number; viewLeft: number; viewWidth: number }): ReactNode {
  const silences = useSpeech((s) => s.silences);
  const fillers = useSpeech((s) => s.fillers);
  const markers = useProjectStore((s) => s.project.markers);
  useLocale(); // decimal separator of the silence lengths
  const lo = viewLeft - 400;
  const hi = viewLeft + viewWidth + 400;
  const beats = markers.filter(isBeatMarker);
  return (
    <div className="sp-overlay" style={{ top, height }} aria-hidden>
      {beats.map((m) => {
        const x = timeToX(m.time, pps);
        if (x < lo || x > hi) return null;
        const down = m.color === DOWNBEAT_COLOR;
        return <span key={m.id} className={`sp-beat ${down ? 'is-down' : ''}`} style={{ left: x }} />;
      })}
      {silences?.ranges.map((r, i) => {
        const x0 = timeToX(r.start, pps);
        const x1 = timeToX(r.end, pps);
        if (x1 < lo || x0 > hi) return null;
        return (
          <span key={`s${r.start}`} className={`sp-silence ${silences.selected[i] ? 'is-on' : ''}`} style={{ left: x0, width: Math.max(2, x1 - x0) }}>
            {x1 - x0 > 46 && <em>{formatNumber(r.end - r.start, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}s</em>}
          </span>
        );
      })}
      {fillers?.candidates.map((c, i) => {
        const x0 = timeToX(c.start, pps);
        const x1 = timeToX(c.end, pps);
        if (x1 < lo || x0 > hi) return null;
        return <span key={`f${c.start}`} className={`sp-filler ${fillers.selected[i] ? 'is-on' : ''}`} style={{ left: x0, width: Math.max(2, x1 - x0) }} title={c.text} />;
      })}
    </div>
  );
});
