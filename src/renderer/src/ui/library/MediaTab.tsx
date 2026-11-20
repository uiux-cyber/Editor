import { AlertTriangle, FileAudio, FolderOpen, Image as ImageIcon, ImagePlay, Music, Plus, Trash2, Upload, Video } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { formatDuration } from '@/core/time';
import type { MediaAsset } from '@/core/types';
import { ImportError, importMediaFiles, relinkAsset, removeAsset, useAssetRuntime } from '@/engine/media/assets';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { toast } from '@/store/ui';
import { addAsset } from '../actions';
import { openContextMenu } from '../common/overlays';
import { startDrag } from '../dnd';
import { t, useT } from '../i18n';
import { MediaTileBadges, mediaTileMenu } from '../media/MediaTile';
import { offerConversion } from '@/engine/media/ffmpeg';
import type { FileInfo } from '@shared/ipc';
import { AnimatedThumb, AnimationBadge } from './animatedThumb';

/** Import files into the media bin and report the outcome. */
export async function importFiles(files: FileInfo[]): Promise<MediaAsset[]> {
  if (files.length === 0) return [];
  const result = await importMediaFiles(files);
  // Files FFmpeg could convert get the conversion dialog instead of an error toast.
  const convertible = result.failures.filter((f) => f.convertible && f.path);
  const failures = result.failures.filter((f) => !(f.convertible && f.path));
  if (convertible.length) offerConversion(convertible.map((f) => ({ name: f.name, path: f.path!, reason: f.reason })));
  if (failures.length) {
    const first = failures[0];
    toast('error', failures.length === 1 ? t('Could not import "{name}"', { name: first.name }) : t('{count, plural, one {# file could not be imported} other {# files could not be imported}}', { count: failures.length }), first.reason);
  }
  return result.assets;
}

export async function importViaDialog(): Promise<MediaAsset[]> {
  return importFiles(await api.dialog.openMedia());
}

type Filter = 'all' | 'video' | 'image' | 'audio';

export function MediaTab(): ReactNode {
  const t = useT();
  const assets = useProjectStore((s) => s.project.assets);
  const runtime = useAssetRuntime((s) => s.items);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);

  const list = useMemo(
    () =>
      Object.values(assets)
        // Animated GIFs / Lottie files are listed with the images.
        .filter((a) => a.source.type === 'file' && (filter === 'all' || a.kind === filter || (filter === 'image' && a.kind === 'animation')))
        .sort((a, b) => b.addedAt - a.addedAt),
    [assets, filter],
  );
  const total = useMemo(() => Object.values(assets).filter((a) => a.source.type === 'file').length, [assets]);

  const doImport = async (): Promise<void> => {
    setBusy(true);
    try {
      await importViaDialog();
    } finally {
      setBusy(false);
    }
  };

  const relink = async (asset: MediaAsset): Promise<void> => {
    const file = await api.dialog.locateMedia(asset.name);
    if (!file) return;
    try {
      await relinkAsset(asset.id, file);
      toast('success', t('Relinked "{name}"', { name: asset.name }));
    } catch (err) {
      toast('error', t('Could not relink the file'), err instanceof ImportError ? err.message : undefined);
    }
  };

  return (
    <div className="lib">
      <header className="lib__head">
        <h3>{t('Media')}</h3>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void doImport()} disabled={busy}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Upload size={13} />} {t('Import')}
        </button>
      </header>
      {total > 0 && (
        <div className="lib__chips">
          {(['all', 'video', 'image', 'audio'] as Filter[]).map((f) => (
            <button key={f} type="button" className={`chip ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? t('All') : f === 'video' ? t('Video') : f === 'image' ? t('Images') : t('Audio')}
            </button>
          ))}
        </div>
      )}
      <div className="lib__scroll">
        {total === 0 ? (
          <button type="button" className="dropzone" onClick={() => void doImport()}>
            <span className="empty__icon">
              <FolderOpen size={20} />
            </span>
            <span className="empty__title">{t('Import your media')}</span>
            <span>
              {t('Drop videos, photos and audio here,')}
              <br />
              {t('or click to browse.')}
            </span>
          </button>
        ) : list.length === 0 ? (
          <div className="empty">
            <p>{filter === 'image' ? t('No images in this project yet.') : filter === 'video' ? t('No video in this project yet.') : t('No audio in this project yet.')}</p>
          </div>
        ) : (
          <div className="grid grid--media">
            {list.map((asset) => {
              const rt = runtime[asset.id];
              const missing = rt?.status === 'missing';
              return (
                <div
                  key={asset.id}
                  className={`media-tile ${missing ? 'is-missing' : ''}`}
                  title={missing ? t('{name} — file not found. Right-click to relink.', { name: asset.name }) : `${asset.name}\n${t('Click to add at the playhead, or drag to the timeline')}`}
                  onPointerDown={(e) => !missing && startDrag(e, { kind: 'asset', assetId: asset.id }, asset.name, () => addAsset(asset))}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      { label: t('Add to timeline'), icon: <Plus size={14} />, disabled: missing, run: () => addAsset(asset) },
                      ...(asset.source.type === 'file'
                        ? [
                            { label: t('Show in Explorer'), icon: <FolderOpen size={14} />, disabled: missing, run: () => void api.app.showItemInFolder((asset.source as { path: string }).path) },
                            { label: t('Relink file…'), run: () => void relink(asset) },
                          ]
                        : []),
                      ...mediaTileMenu(asset),
                      { type: 'separator' as const },
                      { label: t('Remove from project'), icon: <Trash2 size={14} />, danger: true, run: () => removeAsset(asset.id) },
                    ])
                  }
                >
                  <div className="media-tile__thumb">
                    {rt?.thumb ? (
                      <img src={rt.thumb} alt="" draggable={false} />
                    ) : (
                      <span className="media-tile__icon">{asset.kind === 'audio' ? <Music size={22} /> : asset.kind === 'image' ? <ImageIcon size={22} /> : <Video size={22} />}</span>
                    )}
                    {asset.kind === 'animation' && !missing && <AnimatedThumb asset={asset} />}
                    <AnimationBadge asset={asset} />
                    {missing && (
                      <span className="media-tile__warn">
                        <AlertTriangle size={14} /> {t('Missing')}
                      </span>
                    )}
                    <span className="media-tile__kind">{asset.kind === 'audio' ? <FileAudio size={11} /> : asset.kind === 'image' ? <ImageIcon size={11} /> : asset.kind === 'animation' ? <ImagePlay size={11} /> : <Video size={11} />}</span>
                    {asset.duration > 0 && <span className="media-tile__dur mono">{formatDuration(asset.duration)}</span>}
                    <span className="media-tile__add">
                      <Plus size={14} />
                    </span>
                    <MediaTileBadges asset={asset} />
                  </div>
                  <div className="media-tile__name truncate">{asset.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
