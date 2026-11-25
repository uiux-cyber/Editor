/**
 * Bar shown above the timeline while a thumbnail is open: back to the video, the project's
 * thumbnails (A/B/C variants), and the frame / preview / export actions.
 */

import { Copy, CornerLeftUp, Download, Film, ImagePlus, LayoutGrid, MonitorPlay, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MAX_THUMBNAILS } from '@/core/thumbnails';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { openContextMenu, openMenuBelow, type MenuItem } from '../common/overlays';
import { t, useT } from '../i18n';
import { closeThumbnails, deleteThumbnail, duplicateThumbnailById, renameThumbnail, switchThumbnail, useThumbnails } from './actions';
import { openFramePicker } from './dialogs';
import './thumbnails.css';

function tabMenu(id: string, startRename: () => void, count: number): MenuItem[] {
  return [
    { label: t('Rename'), icon: <Pencil size={14} />, run: startRename },
    { label: t('Duplicate as a new variant'), icon: <Copy size={14} />, disabled: count >= MAX_THUMBNAILS, run: () => void duplicateThumbnailById(id) },
    { type: 'separator' },
    { label: t('Delete thumbnail'), icon: <Trash2 size={14} />, danger: true, run: () => deleteThumbnail(id) },
  ];
}

export function ThumbnailBar(): ReactNode {
  const t = useT();
  const { open, list } = useThumbnails();
  const projectName = useProjectStore((s) => s.root.name);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!open) return null;
  const full = list.length >= MAX_THUMBNAILS;
  return (
    <div className="thumb-bar" data-thumbnail-bar>
      <button type="button" className="thumb-bar__back" title={t('Back to the video timeline')} onClick={closeThumbnails} data-thumbnail-close>
        <Film size={13} />
        <span>{projectName}</span>
      </button>
      <span className="thumb-bar__sep" aria-hidden />
      <div className="thumb-bar__tabs" role="tablist" aria-label={t('Thumbnails')}>
        {list.map((th) =>
          renaming === th.id ? (
            <input
              key={th.id}
              className="thumb-bar__rename"
              defaultValue={th.name}
              autoFocus
              aria-label={t('Thumbnail name')}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  renameThumbnail(th.id, e.currentTarget.value);
                  setRenaming(null);
                } else if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => {
                renameThumbnail(th.id, e.currentTarget.value);
                setRenaming(null);
              }}
            />
          ) : (
            <button
              key={th.id}
              type="button"
              role="tab"
              aria-selected={th.id === open.id}
              className={`thumb-bar__tab ${th.id === open.id ? 'is-current' : ''}`}
              data-thumbnail-tab={th.name}
              title={t('Double-click to rename, right-click for more')}
              onClick={() => switchThumbnail(th.id)}
              onDoubleClick={() => setRenaming(th.id)}
              onContextMenu={(e) => openContextMenu(e, tabMenu(th.id, () => setRenaming(th.id), list.length))}
            >
              <LayoutGrid size={12} />
              <span>{th.name}</span>
            </button>
          ),
        )}
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          title={full ? t('A project keeps up to {count} thumbnails', { count: MAX_THUMBNAILS }) : t('Add a variant (A/B test)')}
          disabled={full}
          data-thumbnail-add
          onClick={(e) =>
            openMenuBelow(e.currentTarget, [
              { label: t('Duplicate “{name}”', { name: open.name }), icon: <Copy size={14} />, run: () => void duplicateThumbnailById(open.id) },
              { label: t('New from a video frame…'), icon: <ImagePlus size={14} />, run: () => openFramePicker('new') },
            ])
          }
        >
          <Plus size={13} />
        </button>
      </div>
      <span className="thumb-bar__info">{t('A still picture: the frame under the playhead is exported')}</span>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => openFramePicker('change')} title={t('Use another moment of the video as the background')} data-thumbnail-frame>
        <ImagePlus size={13} /> {t('Change frame')}
      </button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => useUI.getState().openModal('thumbnailFeed')} title={t('See how it looks next to other videos, at real sizes')} data-thumbnail-feed>
        <MonitorPlay size={13} /> {t('Preview in feed')}
      </button>
      <button type="button" className="btn btn--sm btn--primary" onClick={() => useUI.getState().openModal('thumbnailExport')} data-thumbnail-export>
        <Download size={13} /> {t('Export thumbnail')}
      </button>
      <button type="button" className="btn btn--sm btn--outline" title={t('Back to the video timeline')} onClick={closeThumbnails}>
        <CornerLeftUp size={13} /> {t('Done')}
      </button>
    </div>
  );
}
