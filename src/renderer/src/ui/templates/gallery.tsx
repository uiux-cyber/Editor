/**
 * Template gallery pieces shared by the Templates tab and the Home screen: brand / music toggles,
 * the "My templates" state, the music badge, the save-selection banner and the user-template menu.
 */

import { Copy, LayoutTemplate, MoreHorizontal, Music, Package, Palette, PenLine, SwatchBook, Trash2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { getSound } from '@/library';
import type { TemplateCategory, TemplateDef } from '@/library/types';
import { useUI } from '@/store/ui';
import { Toggle } from '../common/controls';
import { openContextMenu, openMenuBelow, type MenuItem } from '../common/overlays';
import { t, useT } from '../i18n';
import { applyBrandToSelection } from './apply';
import { useLibraryVersion } from './hooks';
import { bootTemplates, duplicateUserTemplate, setIncludeMusic, setUseBrand, useTemplates } from './store';
import { openTemplatesWindow } from './windows';
import './templates.css';

export { useLibraryVersion };

export interface GalleryState {
  category: TemplateCategory | 'all' | 'mine';
  setCategory: (c: TemplateCategory | 'all' | 'mine') => void;
  /** Render with the brand kit. */
  brand: boolean;
  brandRevision: number;
  libraryVersion: number;
  /** Changes when pictures used by thumbnails finish loading. */
  epoch: number;
  mineCount: number;
  /** False while brand pictures are still decoding (thumbnails would miss the logo). */
  thumbsReady: boolean;
}

export function useGalleryState(): GalleryState {
  useEffect(() => void bootTemplates(), []);
  const libraryVersion = useLibraryVersion();
  const category = useTemplates((s) => s.galleryCategory);
  const useBrand = useTemplates((s) => s.useBrand);
  const brandSet = useTemplates((s) => s.brandSet);
  const brandRevision = useTemplates((s) => s.brand.revision);
  const epoch = useTemplates((s) => s.logoEpoch);
  const logoPending = useTemplates((s) => s.logoPending);
  const mineCount = useTemplates((s) => s.templates.length);
  const brand = useBrand && brandSet;
  // Fall back to "All" when the last saved template is deleted.
  useEffect(() => {
    if (category === 'mine' && mineCount === 0) useTemplates.setState({ galleryCategory: 'all' });
  }, [category, mineCount]);
  return {
    category,
    setCategory: (c) => useTemplates.setState({ galleryCategory: c }),
    brand,
    brandRevision,
    libraryVersion,
    epoch,
    mineCount,
    thumbsReady: !brand || !logoPending,
  };
}

/** "Use my brand" switch: opens the Brand Kit first when no kit has been set up. */
export function BrandToggle({ compact = false }: { compact?: boolean }): ReactNode {
  const tr = useT();
  const useBrand = useTemplates((s) => s.useBrand);
  const brandSet = useTemplates((s) => s.brandSet);
  const colors = useTemplates((s) => s.brand.colors);
  const on = useBrand && brandSet;
  return (
    <label className={`tpl-toggle ${on ? 'is-on' : ''}`} title={brandSet ? tr('Render every template with your brand colours, fonts and logo') : tr('Set up your brand kit to use it in templates')} data-testid="use-brand">
      <Toggle
        value={on}
        onChange={(v) => {
          if (v && !brandSet) {
            setUseBrand(true);
            openTemplatesWindow({ kind: 'brand' });
            return;
          }
          setUseBrand(v);
        }}
      />
      <span>{compact ? tr('My brand') : tr('Use my brand')}</span>
      {brandSet && (
        <span className="tpl-toggle__swatches" aria-hidden>
          <i style={{ background: colors.primary }} />
          <i style={{ background: colors.secondary }} />
          <i style={{ background: colors.accent }} />
        </span>
      )}
    </label>
  );
}

export function MusicToggle(): ReactNode {
  const tr = useT();
  const includeMusic = useTemplates((s) => s.includeMusic);
  return (
    <label className={`tpl-toggle ${includeMusic ? 'is-on' : ''}`} title={tr("Add the template's music bed when you apply a template with a ♪ badge")} data-testid="include-music">
      <Toggle value={includeMusic} onChange={setIncludeMusic} />
      <span>{tr('Music')}</span>
    </label>
  );
}

/** Menu with the feature's actions (brand kit, packs, save selection…). */
export function templatesMenuItems(): MenuItem[] {
  const ui = useUI.getState();
  const editor = ui.screen === 'editor';
  const hasSelection = editor && ui.selection.length > 0;
  return [
    { label: t('Brand kit…'), icon: <Palette size={14} />, run: () => openTemplatesWindow({ kind: 'brand' }) },
    { label: t('Apply brand to selection'), icon: <SwatchBook size={14} />, disabled: !hasSelection, run: () => void applyBrandToSelection() },
    { type: 'separator' },
    { label: t('Save selection as template…'), icon: <LayoutTemplate size={14} />, disabled: !hasSelection, run: () => openTemplatesWindow({ kind: 'save' }) },
    { type: 'separator' },
    { label: t('Install content pack…'), icon: <Package size={14} />, run: () => openTemplatesWindow({ kind: 'packs', install: true }) },
    { label: t('Manage content packs…'), run: () => openTemplatesWindow({ kind: 'packs' }) },
  ];
}

/** Toggles + brand kit button + menu row at the top of the Templates tab. */
export function GalleryToolbar(): ReactNode {
  const tr = useT();
  return (
    <div className="tpl-bar">
      <BrandToggle compact />
      <MusicToggle />
      <span style={{ flex: 1 }} />
      <button type="button" className="icon-btn" title={tr('Brand kit')} onClick={() => openTemplatesWindow({ kind: 'brand' })} data-testid="open-brand-kit">
        <Palette size={15} />
      </button>
      <button type="button" className="icon-btn" title={tr('More template actions')} onClick={(e) => openMenuBelow(e.currentTarget, templatesMenuItems(), { alignRight: true, minWidth: 230 })} data-testid="templates-menu">
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/** Music-note badge on tiles of templates with a music bed. */
export function MusicBadge({ def }: { def: TemplateDef }): ReactNode {
  const tr = useT();
  const includeMusic = useTemplates((s) => s.includeMusic);
  if (!def.music) return null;
  const name = getSound(def.music.soundId)?.name ?? tr('Music');
  return (
    <span className={`tile__music ${includeMusic ? '' : 'is-off'}`} title={includeMusic ? tr('Includes music: {name}', { name }) : tr('Music ({name}) is switched off', { name })}>
      <Music size={11} />
    </span>
  );
}

/** "Save N selected layers as a template" call to action, shown while clips are selected. */
export function SaveSelectionBanner(): ReactNode {
  const tr = useT();
  const count = useUI((s) => (s.screen === 'editor' ? s.selection.length : 0));
  if (count === 0) return null;
  return (
    <div className="tpl-save-cta">
      <LayoutTemplate size={15} />
      <span>{tr('{count, plural, one {# layer selected} other {# layers selected}}', { count })}</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="btn btn--sm btn--outline" onClick={() => openTemplatesWindow({ kind: 'save' })} data-testid="save-as-template">
        {tr('Save as template…')}
      </button>
    </div>
  );
}

/** Rename / duplicate / delete menu for one of the user's templates. */
export function openUserTemplateMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, id: string): void {
  e.stopPropagation?.();
  openContextMenu(e, [
    { label: t('Rename…'), icon: <PenLine size={14} />, run: () => openTemplatesWindow({ kind: 'rename', id }) },
    { label: t('Duplicate'), icon: <Copy size={14} />, run: () => void duplicateUserTemplate(id) },
    { type: 'separator' },
    { label: t('Delete…'), icon: <Trash2 size={14} />, danger: true, run: () => openTemplatesWindow({ kind: 'delete', id }) },
  ]);
}
