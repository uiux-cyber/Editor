/**
 * Preview-transport controls of the performance & media area: the "Use proxies" toggle, the
 * "Render preview" button and a background-tasks indicator (proxies, preview rendering, FFmpeg
 * conversions) whose popover shows progress with cancel buttons. Also hosts the area's dialogs.
 */

import { Clapperboard, Settings2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cancelRender, renderPreview, useRenderCache } from '@/engine/cache/renderCache';
import { cancelConversion, useFfmpeg } from '@/engine/media/ffmpeg';
import { useMediaPrefs } from '@/engine/media/prefs';
import { cancelProxy, setUseProxies, useProxyJobs } from '@/engine/media/proxies';
import { useProjectStore } from '@/store/project';
import { exposeDebug } from '@/engine/media/debug';
import { importFiles } from '../library/MediaTab';
import { ConvertDialog } from './ConvertDialog';
import { MediaSettingsHost, openMediaSettings } from './SettingsHost';
import './media.css';

// Automated tests import through the same function as the Import button and file drops.
exposeDebug({ importFiles, openMediaSettings });

export function ProxyToggle(): ReactNode {
  const on = useMediaPrefs((s) => s.useProxies);
  const count = useProjectStore((s) => Object.values(s.project.assets).filter((a) => a.proxy).length);
  return (
    <button
      type="button"
      className={`mx-proxy ${on ? 'is-on' : ''}`}
      data-proxy-toggle
      aria-pressed={on}
      title={`${on ? 'Proxies on' : 'Proxies off'} — ${count ? `${count} clip${count === 1 ? '' : 's'} with a lightweight editing copy` : 'heavy media gets a lightweight editing copy'}.\nThe preview plays proxies when on; export always uses the original files.`}
      onClick={() => setUseProxies(!on)}
    >
      <span className="mx-proxy__dot" />
      Proxy
    </button>
  );
}

function useTasks(): { proxies: ReturnType<typeof useProxyJobs.getState>['jobs']; job: ReturnType<typeof useRenderCache.getState>['job']; conversions: ReturnType<typeof useFfmpeg.getState>['jobs'] } {
  const proxies = useProxyJobs((s) => s.jobs);
  const job = useRenderCache((s) => s.job);
  const conversions = useFfmpeg((s) => s.jobs);
  return { proxies, job, conversions };
}

function TasksPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }): ReactNode {
  const { proxies, job, conversions } = useTasks();
  const assets = useProjectStore((s) => s.project.assets);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  // Re-measure after every render (the list grows / shrinks); only update when it moved.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(window.innerWidth - 348, r.left - 8));
    const top = Math.max(8, r.top - h - 8);
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  });
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  const proxyList = Object.values(proxies);
  const convList = Object.values(conversions);
  const empty = !job && proxyList.length === 0 && convList.length === 0;
  return createPortal(
    <div ref={ref} className="mx-popover" role="dialog" aria-label="Background tasks" style={pos}>
      <h4>Background tasks</h4>
      {empty && <p className="hint">Nothing is running. Proxies, preview renders and conversions show up here.</p>}
      {job && (
        <div className="mx-task">
          <span className="mx-task__title truncate">{job.auto ? 'Rendering heavy sections (idle)' : 'Rendering preview'}</span>
          <button type="button" className="icon-btn icon-btn--sm" title="Stop rendering" onClick={cancelRender}>
            <X size={13} />
          </button>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <span className="mx-task__meta">
            {job.done} of {job.total} second{job.total === 1 ? '' : 's'} rendered · pauses while you play
          </span>
        </div>
      )}
      {proxyList.map((p) => (
        <div key={p.assetId} className={`mx-task ${p.state === 'error' ? 'mx-task--error' : ''}`}>
          <span className="mx-task__title truncate">Proxy · {assets[p.assetId]?.name ?? 'media'}</span>
          <button type="button" className="icon-btn icon-btn--sm" title={p.state === 'error' ? 'Dismiss' : 'Cancel'} onClick={() => cancelProxy(p.assetId)}>
            <X size={13} />
          </button>
          {p.state !== 'error' && (
            <div className="progress">
              <div className="progress__bar" style={{ width: `${Math.round(p.progress * 100)}%` }} />
            </div>
          )}
          <span className="mx-task__meta">{p.state === 'error' ? p.error : p.state === 'queued' ? `Queued · ${p.reason}` : `${Math.round(p.progress * 100)}% · ${p.reason}`}</span>
        </div>
      ))}
      {convList.map((c) => (
        <div key={c.id} className={`mx-task ${c.state === 'error' ? 'mx-task--error' : ''}`}>
          <span className="mx-task__title truncate">Converting · {c.name}</span>
          {c.state === 'running' && (
            <button type="button" className="icon-btn icon-btn--sm" title="Cancel conversion" onClick={() => void cancelConversion(c.id)}>
              <X size={13} />
            </button>
          )}
          {c.state === 'running' && (
            <div className="progress">
              <div className="progress__bar" style={{ width: `${Math.round(c.ratio * 100)}%` }} />
            </div>
          )}
          <span className="mx-task__meta">{c.state === 'error' ? c.error : `${Math.round(c.ratio * 100)}%${c.speed ? ` · ${c.speed.toFixed(1)}× real time` : ''} · FFmpeg`}</span>
        </div>
      ))}
      <div className="row-end" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            onClose();
            openMediaSettings();
          }}
        >
          <Settings2 size={13} /> Performance settings
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function BackgroundTasks(): ReactNode {
  const { proxies, job, conversions } = useTasks();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const proxyList = Object.values(proxies).filter((p) => p.state !== 'error');
  const convList = Object.values(conversions).filter((c) => c.state === 'running');
  const count = (job ? 1 : 0) + proxyList.length + convList.length;
  const errors = Object.values(proxies).length - proxyList.length + Object.values(conversions).length - convList.length;
  if (count === 0 && errors === 0 && !open) return null;
  // One headline: the render job, else the running proxy, else a conversion.
  let label = '';
  let pct: number | null = null;
  if (job) {
    label = 'Rendering';
    pct = job.progress;
  } else if (proxyList.length) {
    const running = proxyList.find((p) => p.state === 'running');
    label = proxyList.length > 1 ? `${proxyList.length} proxies` : 'Proxy';
    pct = running ? running.progress : 0;
  } else if (convList.length) {
    label = convList.length > 1 ? `${convList.length} conversions` : 'Converting';
    pct = convList[0].ratio;
  } else {
    label = 'Task failed';
  }
  return (
    <>
      <button ref={ref} type="button" className="mx-tasks" data-media-tasks title="Background tasks" onClick={() => setOpen((o) => !o)}>
        {count > 0 ? <span className="spinner" /> : null}
        <span className="truncate">{label}</span>
        {pct !== null && count > 0 && <span className="mx-tasks__pct">{Math.round(pct * 100)}%</span>}
      </button>
      {open && ref.current && <TasksPopover anchor={ref.current} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RenderPreviewButton(): ReactNode {
  const job = useRenderCache((s) => s.job);
  return (
    <button
      type="button"
      className={`icon-btn ${job && !job.auto ? 'is-active' : ''}`}
      data-render-preview
      title={job ? 'Rendering the preview… (click to stop)' : 'Render preview — pre-renders the in/out range, the selected clips or the whole timeline so heavy sections play smoothly'}
      onClick={() => (job ? cancelRender() : void renderPreview())}
    >
      <Clapperboard size={15} />
    </button>
  );
}

/** Everything the area adds to the transport (inserted by Preview.tsx). */
export function TransportMedia(): ReactNode {
  return (
    <>
      <span className="vdivider" />
      <ProxyToggle />
      <RenderPreviewButton />
      <BackgroundTasks />
      <ConvertDialog />
      <MediaSettingsHost />
    </>
  );
}
