/**
 * Media-bin tile additions of the performance & media area: HDR / proxy / converted badges,
 * live proxy progress with cancel, and the proxy entries of the tile's context menu.
 */

import { FileVideo, Layers2, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MediaAsset } from '@/core/types';
import { useAssetRuntime } from '@/engine/media/assets';
import { useMediaPrefs } from '@/engine/media/prefs';
import { cancelProxy, deleteProxy, requestProxy, useProxyJobs } from '@/engine/media/proxies';
import { api } from '@/platform/api';
import type { MenuItem } from '../common/overlays';
import './media.css';

export function MediaTileBadges({ asset }: { asset: MediaAsset }): ReactNode {
  const job = useProxyJobs((s) => s.jobs[asset.id]);
  const proxyReady = useAssetRuntime((s) => !!s.items[asset.id]?.proxyUrl);
  const useProxies = useMediaPrefs((s) => s.useProxies);
  const proxy = asset.proxy;
  const running = job?.state === 'running';
  const queued = job?.state === 'queued';
  const failed = job?.state === 'error';
  const pct = Math.round((job?.progress ?? 0) * 100);
  return (
    <>
      <span className="mt-badges">
        {asset.hdr && (
          <span className="mt-badge mt-badge--hdr" title="High dynamic range source — tone-mapped to SDR in the preview and the export (Clip ▸ HDR to adjust)">
            HDR
          </span>
        )}
        {asset.transcodedFrom && (
          <span className="mt-badge mt-badge--conv" title={`Converted with FFmpeg from\n${asset.transcodedFrom}`}>
            <FileVideo size={10} /> Converted
          </span>
        )}
        {proxy && proxyReady && !job && (
          <span className={`mt-badge mt-badge--proxy ${useProxies ? '' : 'is-off'}`} title={`Proxy ${proxy.width}×${proxy.height}${useProxies ? ' — the preview plays this lightweight copy; export uses the original' : ' — proxies are off, the preview plays the original'}`}>
            <Zap size={10} /> Proxy
          </span>
        )}
        {queued && (
          <span className="mt-badge mt-badge--pending" title={`Waiting to create a proxy (${job.reason})`}>
            Proxy queued
          </span>
        )}
        {running && (
          <span className="mt-badge mt-badge--pending" title={`Creating a proxy (${job.reason})`}>
            <span className="spinner" style={{ width: 9, height: 9 }} /> Proxy {pct}%
          </span>
        )}
        {failed && (
          <span className="mt-badge mt-badge--error" title={job.error}>
            Proxy failed
          </span>
        )}
      </span>
      {(running || queued) && (
        <>
          <span className="mt-progress" aria-hidden="true">
            <span className="mt-progress__bar" style={{ width: `${running ? Math.max(2, pct) : 0}%` }} />
          </span>
          <button
            type="button"
            className="mt-cancel"
            title="Cancel proxy"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              cancelProxy(asset.id);
            }}
          >
            <X size={12} />
          </button>
        </>
      )}
    </>
  );
}

/** Proxy / conversion entries for a media tile's context menu. */
export function mediaTileMenu(asset: MediaAsset): MenuItem[] {
  if (asset.kind !== 'video' || asset.source.type !== 'file') return [];
  const job = useProxyJobs.getState().jobs[asset.id];
  const missing = useAssetRuntime.getState().items[asset.id]?.status === 'missing';
  const items: MenuItem[] = [{ type: 'separator' }];
  if (job && job.state !== 'error') {
    items.push({ label: 'Cancel proxy', icon: <X size={14} />, run: () => cancelProxy(asset.id) });
  } else if (asset.proxy) {
    items.push({ label: 'Re-create proxy', icon: <RefreshCw size={14} />, disabled: missing, run: () => requestProxy(asset.id, { force: true, reason: 'Requested' }) });
    items.push({ label: 'Delete proxy', icon: <Trash2 size={14} />, run: () => void deleteProxy(asset.id) });
  } else {
    items.push({ label: 'Create proxy', icon: <Layers2 size={14} />, disabled: missing, run: () => requestProxy(asset.id, { reason: 'Requested' }) });
  }
  if (asset.transcodedFrom) {
    items.push({ label: 'Show original in Explorer', icon: <FileVideo size={14} />, run: () => void api.app.showItemInFolder(asset.transcodedFrom!) });
  }
  return items;
}
