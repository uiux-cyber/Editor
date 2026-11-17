/**
 * Settings sections of the performance & media area: Proxies, Render cache, FFmpeg and the
 * storage they use (all under the app's data folder).
 */

import { Gauge, HardDrive, Layers2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { FolderUsage, MediaFolder } from '@shared/media';
import { formatBytes } from '@/core/time';
import { clearRenderCache, reloadCacheIndex, renderPreview } from '@/engine/cache/renderCache';
import { detectFfmpeg, resetFfmpeg, useFfmpeg, hevcSupport } from '@/engine/media/ffmpeg';
import { useMediaPrefs, type ProxySize } from '@/engine/media/prefs';
import { autoProxy, clearAllProxies } from '@/engine/media/proxies';
import { api } from '@/platform/api';
import { getProject } from '@/store/project';
import { toast } from '@/store/ui';
import { Field, Segmented, Select, Toggle } from '../../common/controls';
import { FfmpegStatus } from '../../media/ConvertDialog';
import type { SettingsSectionDef } from '../index';
import '../../media/media.css';

function useUsage(folder: MediaFolder): [FolderUsage | null, () => void] {
  const [usage, setUsage] = useState<FolderUsage | null>(null);
  const refresh = useCallback(() => {
    void api
      .call<FolderUsage[]>('x:media:usage')
      .then((list) => setUsage(list.find((u) => u.folder === folder) ?? null))
      .catch(() => setUsage(null));
  }, [folder]);
  useEffect(refresh, [refresh]);
  return [usage, refresh];
}

function StorageRow({ folder, label, onClear, clearLabel }: { folder: MediaFolder; label: string; onClear: () => Promise<unknown>; clearLabel: string }): ReactNode {
  const [usage, refresh] = useUsage(folder);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-storage" data-storage={folder}>
      <div style={{ minWidth: 0 }}>
        <strong>{label}</strong>
        <br />
        <span>{usage ? `${usage.files} file${usage.files === 1 ? '' : 's'} · ${formatBytes(usage.bytes)}` : '…'}</span>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" title={usage?.path} onClick={() => void api.call('x:media:reveal', folder)}>
        Show folder
      </button>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        data-clear={folder}
        disabled={busy || !usage || usage.files === 0}
        onClick={() => {
          setBusy(true);
          void onClear()
            .then(() => toast('success', `${label} cleared`))
            .catch((err: Error) => toast('error', `Could not clear ${label.toLowerCase()}`, err.message))
            .finally(() => {
              setBusy(false);
              refresh();
            });
        }}
      >
        {clearLabel}
      </button>
    </div>
  );
}

function ProxiesSection(): ReactNode {
  const p = useMediaPrefs();
  return (
    <div className="mx-settings" data-settings-section="proxies">
      <Field label="Use proxies in the preview" title="Play lightweight copies of heavy media while editing. Export always uses the original files.">
        <Toggle value={p.useProxies} onChange={(v) => p.set({ useProxies: v })} />
      </Field>
      <Field label="Create automatically" title="Make proxies in the background for heavy media when it is imported.">
        <Toggle value={p.proxyAuto} onChange={(v) => p.set({ proxyAuto: v })} />
      </Field>
      <Field label="Heavy from resolution">
        <Select
          value={p.proxyMinShortSide}
          onChange={(v) => p.set({ proxyMinShortSide: v })}
          options={[
            { value: 1080, label: '1080p and above' },
            { value: 1440, label: '1440p and above' },
            { value: 2160, label: '4K (2160p) and above' },
            { value: 100000, label: 'Never by resolution' },
          ]}
        />
      </Field>
      <Field label="Heavy from bitrate">
        <Select
          value={p.proxyMinMbps}
          onChange={(v) => p.set({ proxyMinMbps: v })}
          options={[
            { value: 0, label: 'Ignore bitrate' },
            { value: 40, label: '40 Mbit/s and above' },
            { value: 60, label: '60 Mbit/s and above' },
            { value: 100, label: '100 Mbit/s and above' },
            { value: 200, label: '200 Mbit/s and above' },
          ]}
        />
      </Field>
      <Field label="10-bit HEVC is heavy" title="10-bit HEVC (phones, mirrorless cameras) is slow to decode on many PCs.">
        <Toggle value={p.proxyHevc10} onChange={(v) => p.set({ proxyHevc10: v })} />
      </Field>
      <Field label="Proxy size">
        <Segmented<ProxySize>
          value={p.proxySize}
          onChange={(v) => p.set({ proxySize: v })}
          options={[
            { value: 540, label: '540p', title: '960×540 — fastest' },
            { value: 720, label: '720p', title: '1280×720' },
            { value: 1080, label: '1080p', title: '1920×1080 — sharpest' },
          ]}
        />
      </Field>
      <div className="mx-settings__row">
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => {
            const videos = Object.values(getProject().assets).filter((a) => a.kind === 'video' && !a.proxy);
            void autoProxy(videos).then(() => toast('info', 'Heavy media in this project is queued for proxies'));
          }}
        >
          <Layers2 size={13} /> Create proxies for heavy media now
        </button>
      </div>
      <StorageRow
        folder="proxies"
        label="Proxy files"
        clearLabel="Delete all proxies"
        onClear={async () => {
          await clearAllProxies();
        }}
      />
    </div>
  );
}

function CacheSection(): ReactNode {
  const p = useMediaPrefs();
  return (
    <div className="mx-settings" data-settings-section="cache">
      <p className="hint">
        Sections too heavy to play in real time are marked <span style={{ color: 'var(--amber)' }}>amber</span> on the timeline ruler. Render them (the clapperboard button below the preview) and they play back smoothly from the cache —{' '}
        <span style={{ color: 'var(--green)' }}>green</span>. Any edit re-renders only the seconds it touches.
      </p>
      <Field label="Render when idle" title="After a few seconds without edits, render amber sections near the playhead in the background.">
        <Toggle value={p.cacheAuto} onChange={(v) => p.set({ cacheAuto: v })} />
      </Field>
      <Field label="Cache size limit" title="Oldest render files are deleted when the cache grows beyond this.">
        <Select
          value={p.cacheLimitGB}
          onChange={(v) => p.set({ cacheLimitGB: v })}
          options={[2, 5, 10, 20, 50].map((g) => ({ value: g, label: `${g} GB` }))}
        />
      </Field>
      <div className="mx-settings__row">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void renderPreview()}>
          <Gauge size={13} /> Render preview now
        </button>
      </div>
      <StorageRow
        folder="cache"
        label="Render files"
        clearLabel="Delete render files"
        onClear={async () => {
          await clearRenderCache();
          await reloadCacheIndex();
        }}
      />
    </div>
  );
}

function FfmpegSection(): ReactNode {
  const info = useFfmpeg((s) => s.info);
  const hevc = useFfmpeg((s) => s.hevc);
  const codec = useMediaPrefs((s) => s.convertCodec);
  const setPrefs = useMediaPrefs((s) => s.set);
  useEffect(() => {
    void detectFfmpeg();
    void hevcSupport();
  }, []);
  const hevcOk = !!hevc?.main && !!info?.encoders.some((e) => e === 'libx265' || e.startsWith('hevc_'));
  return (
    <div className="mx-settings" data-settings-section="ffmpeg">
      <p className="hint">
        Optional. With FFmpeg installed, Kinora can convert media that this PC cannot decode (ProRes, DNxHD / DNxHR, CineForm, MXF…) into a high-quality copy when you import it. Kinora never downloads FFmpeg itself.
      </p>
      <FfmpegStatus />
      {info?.found && (
        <div className="mx-settings__row">
          {info.source === 'custom' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void resetFfmpeg()}>
              Use FFmpeg from PATH instead
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void detectFfmpeg(true)}>
            Check again
          </button>
        </div>
      )}
      <Field label="Convert to">
        <Select
          value={hevcOk ? codec : 'h264'}
          onChange={(v) => setPrefs({ convertCodec: v })}
          options={[{ value: 'h264', label: 'H.264 MP4 (high bitrate)' }, ...(hevcOk ? [{ value: 'hevc' as const, label: 'HEVC MP4 (smaller)' }] : [])]}
        />
      </Field>
      <StorageRow folder="converted" label="Converted files" clearLabel="Delete converted files" onClear={() => api.call('x:media:remove', 'converted')} />
    </div>
  );
}

const sections: SettingsSectionDef[] = [
  { id: 'proxies', title: 'Proxies', icon: <Layers2 size={15} />, order: 40, Component: ProxiesSection },
  { id: 'render-cache', title: 'Render cache', icon: <HardDrive size={15} />, order: 41, Component: CacheSection },
  { id: 'ffmpeg', title: 'FFmpeg', icon: <Wand2 size={15} />, order: 42, Component: FfmpegSection },
];

export default sections;
