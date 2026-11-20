import { ListVideo } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration } from '@/core/time';
import { cancelAll, clearFinished, initExportQueue, setPreviewMode, useExportQueue } from '@/engine/export/queue';
import { isBusy, isFinished, totalProgress } from '@/engine/export/queueState';
import { Segmented } from '../common/controls';
import { useT } from '../i18n';
import { JobRow } from './JobRow';
import { loadExportPrefs } from './prefs';
import './export.css';

const R = 9;
const CIRC = 2 * Math.PI * R;

function Ring({ ratio, state }: { ratio: number; state: 'running' | 'done' | 'failed' | 'idle' }): ReactNode {
  return (
    <span className={`xq-ring is-${state}`}>
      <svg className="xq-ring__arc" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <defs>
          <linearGradient id="xq-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9d85ff" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle className="xq-ring__track" cx="11" cy="11" r={R} fill="none" strokeWidth="2" />
        <circle className="xq-ring__value" cx="11" cy="11" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - Math.min(1, Math.max(0, ratio)))} />
      </svg>
      <ListVideo size={11} />
    </span>
  );
}

/** The queue popover, anchored under the title-bar button. */
function QueuePopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }): ReactNode {
  const tr = useT();
  const jobs = useExportQueue((s) => s.jobs);
  const batch = useExportQueue((s) => s.batch);
  const previewMode = useExportQueue((s) => s.previewMode);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const total = totalProgress({ jobs, batch });
  const busy = isBusy({ jobs, batch });
  const finished = jobs.filter((j) => isFinished(j.status)).length;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div className="xq-pop" ref={ref} role="dialog" aria-label={tr('Export queue')} style={{ top: pos.top, right: pos.right }}>
      <div className="xq-pop__head">
        <span className="xq-pop__title">{tr('Export queue')}</span>
        <span className="xq-pop__total">
          {busy
            ? total.eta > 1
              ? tr('{done} of {total} done · {percent}% · {time} left', { done: total.finished, total: total.total, percent: Math.round(total.ratio * 100), time: formatDuration(total.eta) })
              : tr('{done} of {total} done · {percent}%', { done: total.finished, total: total.total, percent: Math.round(total.ratio * 100) })
            : jobs.length
              ? tr('{count, plural, one {# export} other {# exports}}', { count: jobs.length })
              : ''}
        </span>
        {busy ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={cancelAll}>
            {tr('Cancel all')}
          </button>
        ) : (
          <button type="button" className="btn btn--sm btn--ghost" disabled={finished === 0} onClick={clearFinished}>
            {tr('Clear finished')}
          </button>
        )}
      </div>
      {busy && (
        <div className="xq-pop__overall">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${Math.round(total.ratio * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="xq-pop__body">
        {jobs.length === 0 ? (
          <div className="xq-pop__empty">{tr('No exports yet. Add one from the Export dialog.')}</div>
        ) : (
          <div className="xq-list">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </div>
      <div className="xq-pop__foot">
        <span title={tr('Rendering the preview while exporting shares the GPU with the export.')}>{tr('Preview while exporting')}</span>
        <Segmented
          value={previewMode}
          options={[
            { value: 'live', label: tr('Live'), title: tr('Keep the preview playable while exports run') },
            { value: 'paused', label: tr('Paused (faster)'), title: tr('Pause the preview so exports finish sooner') },
          ]}
          onChange={setPreviewMode}
        />
      </div>
    </div>,
    document.body,
  );
}

/** Title-bar entry point of the export queue: progress ring, total percentage and popover. */
export function ExportQueueButton(): ReactNode {
  const tr = useT();
  const jobs = useExportQueue((s) => s.jobs);
  const batch = useExportQueue((s) => s.batch);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    initExportQueue();
    // Remembered export dialog choices (read once at startup).
    void loadExportPrefs();
    const onOpen = (): void => setOpen(true);
    window.addEventListener('kinora:export-queue', onOpen);
    return () => window.removeEventListener('kinora:export-queue', onOpen);
  }, []);

  if (jobs.length === 0 && !open) return null;
  const state = { jobs, batch };
  const total = totalProgress(state);
  const busy = isBusy(state);
  const batchJobs = jobs.filter((j) => j.batch === batch);
  const failed = batchJobs.some((j) => j.status === 'failed');
  const ringState = busy ? 'running' : failed ? 'failed' : batchJobs.some((j) => j.status === 'done') ? 'done' : 'idle';
  const label = busy ? `${Math.round(total.ratio * 100)}%` : failed ? tr('Failed') : ringState === 'done' ? tr('Done') : tr('Exports');
  const progress = { current: Math.min(total.total, total.finished + 1), total: total.total, percent: Math.round(total.ratio * 100), time: formatDuration(total.eta) };
  const title = busy ? (total.eta > 1 ? tr('Exporting {current} of {total} — {percent}%, {time} left', progress) : tr('Exporting {current} of {total} — {percent}%', progress)) : tr('Export queue');

  return (
    <>
      <button ref={setAnchor} type="button" className={`xq-btn ${open ? 'is-open' : ''}`} title={title} data-export-queue onClick={() => setOpen((o) => !o)}>
        <Ring ratio={busy ? total.ratio : ringState === 'idle' ? 0 : 1} state={ringState} />
        <span className="xq-btn__pct">{label}</span>
      </button>
      {open && anchor && <QueuePopover anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}
