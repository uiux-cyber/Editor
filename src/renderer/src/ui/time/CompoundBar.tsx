/**
 * Breadcrumb bar shown above the timeline while a compound clip is open for editing: the project,
 * then every open compound clip. Clicking a crumb returns to that level.
 */

import { ChevronRight, CornerLeftUp, Film, Layers } from 'lucide-react';
import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { compoundsOnPath } from '@/core/compound';
import { getProject } from '@/store/project';
import { useProjectStore } from '@/store/project';
import type { MenuItem } from '../common/overlays';
import { t, useT } from '../i18n';
import { breakApartSelection, closeCompound, createCompoundFromSelection, freezeFrame, openCompound, toggleReverseSelection } from './timeActions';
import type { Clip } from '@/core/types';
import './time.css';
import { shortcutText } from '../commands/keymapStore';

export function CompoundBar(): ReactNode {
  const t = useT();
  const path = useProjectStore((s) => s.editPath);
  const root = useProjectStore((s) => s.root);
  if (path.length === 0) return null;
  const chain = compoundsOnPath(root, path);
  const current = chain[chain.length - 1];
  return (
    <div className="compound-bar" data-compound-bar>
      <button type="button" className="compound-bar__crumb" title={t('Back to the project timeline')} onClick={() => closeCompound(0)}>
        <Film size={13} />
        <span>{root.name}</span>
      </button>
      {chain.map((c, i) => (
        <Fragment key={c.id}>
          <ChevronRight size={13} className="compound-bar__sep" />
          <button type="button" className={`compound-bar__crumb ${i === chain.length - 1 ? 'is-current' : ''}`} disabled={i === chain.length - 1} title={i === chain.length - 1 ? t('Open compound clip') : t('Back to “{name}”', { name: c.name })} onClick={() => closeCompound(i + 1)}>
            <Layers size={13} />
            <span>{c.name}</span>
          </button>
        </Fragment>
      ))}
      <span className="compound-bar__info">{t('Editing the clips inside “{name}”', { name: current?.name ?? '' })}</span>
      <button type="button" className="btn btn--sm btn--outline" title={t('Close the compound clip and return to the timeline around it')} onClick={() => closeCompound()}>
        <CornerLeftUp size={13} /> {t('Close')}
      </button>
    </div>
  );
}

/** Extra items for the timeline clip context menu. */
export function timeMenuItems(clip: Clip | undefined): MenuItem[] {
  if (!clip) return [];
  const items: MenuItem[] = [{ type: 'separator' }];
  if (clip.type === 'video' && !clip.freeze) items.push({ label: t('Freeze frame'), shortcut: shortcutText('clip.freezeFrame') || undefined, run: () => freezeFrame() });
  if ((clip.type === 'video' || clip.type === 'audio') && !clip.freeze) items.push({ label: clip.reverse ? t('Play forwards') : t('Reverse'), run: toggleReverseSelection });
  if (clip.type === 'compound') {
    items.push({ label: t('Open compound clip'), run: () => openCompound(clip.id) });
    items.push({ label: t('Break apart'), shortcut: shortcutText('compound.breakApart') || undefined, run: breakApartSelection });
  }
  items.push({ label: t('Create compound clip'), shortcut: shortcutText('compound.create') || undefined, run: createCompoundFromSelection });
  return items;
}

/** Double-click on a compound clip in the timeline opens it. */
export function onTimelineDoubleClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
  if (!el) return;
  const clip = getProject().clips[el.dataset.clip!];
  if (clip?.type === 'compound') openCompound(clip.id);
}
