import { FolderOpen, Play, RotateCcw, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBytes, formatDuration } from '@/core/time';
import { cancelJob, openOutput, removeJob, retryJob } from '@/engine/export/queue';
import type { ExportJob } from '@/engine/export/queueState';
import { api } from '@/platform/api';

export const baseName = (p: string): string => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');

/** Small frame with the output's aspect ratio. */
export function AspectShape({ width, height, className, size = 26 }: { width: number; height: number; className?: string; size?: number }): ReactNode {
  const k = size / Math.max(width, height, 1);
  return <span className={className} style={{ width: Math.max(6, width * k), height: Math.max(6, height * k) }} />;
}

function statusLine(job: ExportJob): ReactNode {
  const p = job.progress;
  switch (job.status) {
    case 'queued':
      return <span>Waiting in the queue</span>;
    case 'running': {
      const pct = Math.round((p?.ratio ?? 0) * 100);
      return (
        <>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="mono">{pct}%</span>
          <span>{!p || p.phase === 'preparing' ? 'Preparing…' : p.phase === 'finalizing' ? 'Finishing…' : p.eta > 1 ? `${formatDuration(p.eta)} left` : 'Rendering…'}</span>
        </>
      );
    }
    case 'cancelling':
      return <span>Cancelling…</span>;
    case 'done':
      return (
        <span className="is-ok">
          Done · {formatBytes(job.result?.bytes ?? 0)} in {formatDuration(Math.max(1, job.result?.seconds ?? 0))}
          {job.result?.extraFiles.length ? ` · +${job.result.extraFiles.map((f) => f.slice(f.lastIndexOf('.') + 1).toUpperCase()).join(', ')}` : ''}
        </span>
      );
    case 'failed':
      return (
        <span className="is-err" title={job.error}>
          Failed — {job.error}
        </span>
      );
    case 'cancelled':
      return <span>Cancelled</span>;
    default:
      return null;
  }
}

/** One export job with its progress and actions (dialog and queue popover). */
export function JobRow({ job }: { job: ExportJob }): ReactNode {
  const s = job.settings;
  const audioOnly = s.container === 'mp3' || s.container === 'wav';
  return (
    <div className={`xq-job is-${job.status === 'cancelling' ? 'running' : job.status}`} data-job={job.id} data-status={job.status}>
      {audioOnly ? <AspectShape className="xq-job__shape" width={1} height={1} size={20} /> : <AspectShape className="xq-job__shape" width={s.width} height={s.height} />}
      <div className="xq-job__body">
        <div className="xq-job__title">
          <strong>{job.label}</strong>
          <span title={job.output.path}>{baseName(job.output.path)}</span>
        </div>
        <div className="xq-job__status">{statusLine(job)}</div>
      </div>
      <div className="xq-job__actions">
        {(job.status === 'queued' || job.status === 'running') && (
          <button type="button" className="icon-btn icon-btn--sm" title="Cancel this export" data-action="cancel" onClick={() => cancelJob(job.id)}>
            <X size={14} />
          </button>
        )}
        {job.status === 'done' && (
          <>
            <button type="button" className="icon-btn icon-btn--sm" title={job.output.kind === 'folder' ? 'Open the folder' : 'Open'} data-action="open" onClick={() => openOutput(job)}>
              <Play size={13} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" title="Show in folder" data-action="reveal" onClick={() => void api.app.showItemInFolder(job.output.path)}>
              <FolderOpen size={13} />
            </button>
          </>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button type="button" className="icon-btn icon-btn--sm" title="Try again" data-action="retry" onClick={() => retryJob(job.id)}>
            <RotateCcw size={13} />
          </button>
        )}
        {(job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && (
          <button type="button" className="icon-btn icon-btn--sm" title="Remove from the list" data-action="remove" onClick={() => removeJob(job.id)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
