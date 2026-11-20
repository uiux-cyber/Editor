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
import { tMaybe, useT } from '../i18n';
import { importFiles } from '../library/MediaTab';
import { ConvertDialog } from './ConvertDialog';
import { MediaSettingsHost, openMediaSettings } from './SettingsHost';
import './media.css';

// Automated tests import through the same function as the Import button and file drops.
exposeDebug({ importFiles, openMediaSettings });

export function ProxyToggle(): ReactNode {
  const t = useT();
  const on = useMediaPrefs((s) => s.useProxies);
  const count = useProjectStore((s) => Object.values(s.project.assets).filter((a) => a.proxy).length);
  const state = on ? t('Proxies on') : t('Proxies off');
  const detail = count ? t('{count, plural, one {# clip with a lightweight editing copy} other {# clips with a lightweight editing copy}}', { count }) : t('heavy media gets a lightweight editing copy');
  return (
    <button
      type="button"
      className={`mx-proxy ${on ? 'is-on' : ''}`}
      data-proxy-toggle
      aria-pressed={on}
      title={`${state} — ${detail}.\n${t('The preview plays proxies when on; export always uses the original files.')}`}
      onClick={() => setUseProxies(!on)}
    >
      <span className="mx-proxy__dot" />
      {t('Proxy')}
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
  const t = useT();
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
    <div ref={ref} className="mx-popover" role="dialog" aria-label={t('Background tasks')} style={pos}>
      <h4>{t('Background tasks')}</h4>
      {empty && <p className="hint">{t('Nothing is running. Proxies, preview renders and conversions show up here.')}</p>}
      {job && (
        <div className="mx-task">
          <span className="mx-task__title truncate">{job.auto ? t('Rendering heavy sections (idle)') : t('Rendering preview')}</span>
          <button type="button" className="icon-btn icon-btn--sm" title={t('Stop rendering')} onClick={cancelRender}>
            <X size={13} />
          </button>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <span className="mx-task__meta">{t('{done} of {total, plural, one {# second} other {# seconds}} rendered · pauses while you play', { done: job.done, total: job.total })}</span>
        </div>
      )}
      {proxyList.map((p) => {
        const name = assets[p.assetId]?.name ?? t('media');
        const percent = Math.round(p.progress * 100);
        const reason = tMaybe(p.reason);
        return (
          <div key={p.assetId} className={`mx-task ${p.state === 'error' ? 'mx-task--error' : ''}`}>
            <span className="mx-task__title truncate">{t('Proxy · {name}', { name })}</span>
            <button type="button" className="icon-btn icon-btn--sm" title={p.state === 'error' ? t('Dismiss') : t('Cancel')} onClick={() => cancelProxy(p.assetId)}>
              <X size={13} />
            </button>
            {p.state !== 'error' && (
              <div className="progress">
                <div className="progress__bar" style={{ width: `${Math.round(p.progress * 100)}%` }} />
              </div>
            )}
            <span className="mx-task__meta">{p.state === 'error' ? p.error : p.state === 'queued' ? t('Queued · {reason}', { reason }) : t('{percent}% · {reason}', { percent, reason })}</span>
          </div>
        );
      })}
      {convList.map((c) => {
        const percent = Math.round(c.ratio * 100);
        const speed = c.speed ? c.speed.toFixed(1) : '';
        return (
          <div key={c.id} className={`mx-task ${c.state === 'error' ? 'mx-task--error' : ''}`}>
            <span className="mx-task__title truncate">{t('Converting · {name}', { name: c.name })}</span>
            {c.state === 'running' && (
              <button type="button" className="icon-btn icon-btn--sm" title={t('Cancel conversion')} onClick={() => void cancelConversion(c.id)}>
                <X size={13} />
              </button>
            )}
            {c.state === 'running' && (
              <div className="progress">
                <div className="progress__bar" style={{ width: `${Math.round(c.ratio * 100)}%` }} />
              </div>
            )}
            <span className="mx-task__meta">{c.state === 'error' ? c.error : speed ? t('{percent}% · {speed}× real time · FFmpeg', { percent, speed }) : t('{percent}% · FFmpeg', { percent })}</span>
          </div>
        );
      })}
      <div className="row-end" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            onClose();
            openMediaSettings();
          }}
        >
          <Settings2 size={13} /> {t('Performance settings')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function BackgroundTasks(): ReactNode {
  const t = useT();
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
    label = t('Rendering');
    pct = job.progress;
  } else if (proxyList.length) {
    const running = proxyList.find((p) => p.state === 'running');
    label = proxyList.length > 1 ? t('{count, plural, one {# proxy} other {# proxies}}', { count: proxyList.length }) : t('Proxy');
    pct = running ? running.progress : 0;
  } else if (convList.length) {
    label = convList.length > 1 ? t('{count, plural, one {# conversion} other {# conversions}}', { count: convList.length }) : t('Converting');
    pct = convList[0].ratio;
  } else {
    label = t('Task failed');
  }
  return (
    <>
      <button ref={ref} type="button" className="mx-tasks" data-media-tasks title={t('Background tasks')} onClick={() => setOpen((o) => !o)}>
        {count > 0 ? <span className="spinner" /> : null}
        <span className="truncate">{label}</span>
        {pct !== null && count > 0 && <span className="mx-tasks__pct">{Math.round(pct * 100)}%</span>}
      </button>
      {open && ref.current && <TasksPopover anchor={ref.current} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RenderPreviewButton(): ReactNode {
  const t = useT();
  const job = useRenderCache((s) => s.job);
  return (
    <button
      type="button"
      className={`icon-btn ${job && !job.auto ? 'is-active' : ''}`}
      data-render-preview
      title={job ? t('Rendering the preview… (click to stop)') : t('Render preview — pre-renders the in/out range, the selected clips or the whole timeline so heavy sections play smoothly')}
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
