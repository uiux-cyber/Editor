/**
 * Settings sections of the templates & branding feature: template preferences (with the user's
 * saved templates), the brand kit and content packs.
 */

import { LayoutTemplate, Package, Palette, PenLine, Trash2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { Toggle } from '../../common/controls';
import { BrandKitPanel } from '../../templates/BrandKit';
import { PacksPanel } from '../../templates/Packs';
import { bootTemplates, setIncludeMusic, setUseBrand, useTemplates } from '../../templates/store';
import { openTemplatesWindow } from '../../templates/windows';
import type { SettingsSectionDef } from '../index';

function useBoot(): void {
  useEffect(() => void bootTemplates(), []);
}

function TemplatesSettings(): ReactNode {
  useBoot();
  const useBrand = useTemplates((s) => s.useBrand);
  const brandSet = useTemplates((s) => s.brandSet);
  const includeMusic = useTemplates((s) => s.includeMusic);
  const templates = useTemplates((s) => s.templates);
  return (
    <div className="settings-templates" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="tpl-toggle" style={{ alignSelf: 'flex-start' }}>
        <Toggle value={useBrand && brandSet} onChange={(v) => (v && !brandSet ? openTemplatesWindow({ kind: 'brand' }) : setUseBrand(v))} />
        <span>Render templates with my brand kit</span>
      </label>
      <label className="tpl-toggle" style={{ alignSelf: 'flex-start' }}>
        <Toggle value={includeMusic} onChange={setIncludeMusic} />
        <span>Include music when applying a template that has some</span>
      </label>
      <div>
        <h4 style={{ margin: '6px 0 8px', color: 'var(--text-0)', fontSize: 12 }}>My templates ({templates.length})</h4>
        {templates.length === 0 ? (
          <p className="hint">Select layers on the timeline and choose “Save as template…” to reuse a design in any project.</p>
        ) : (
          <div className="packs__list">
            {[...templates].reverse().map((t) => (
              <div key={t.id} className="pack-card">
                {t.poster ? <img src={api.media.toUrl(t.poster)} alt="" style={{ width: 72, borderRadius: 6, boxShadow: '0 0 0 1px var(--line-2)' }} /> : <span className="pack-card__icon"><LayoutTemplate size={18} /></span>}
                <div className="pack-card__body">
                  <div className="pack-card__title">
                    <strong className="truncate">{t.file.name}</strong>
                  </div>
                  <div className="pack-card__meta">
                    {t.file.category} · {t.file.duration.toFixed(1)} s{t.file.tags.length ? ` · ${t.file.tags.join(', ')}` : ''}
                  </div>
                </div>
                <button type="button" className="icon-btn" title="Rename" onClick={() => openTemplatesWindow({ kind: 'rename', id: t.id })}>
                  <PenLine size={14} />
                </button>
                <button type="button" className="icon-btn" title="Delete" onClick={() => openTemplatesWindow({ kind: 'delete', id: t.id })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BrandKitSettings(): ReactNode {
  useBoot();
  return <BrandKitPanel compact />;
}

function PacksSettings(): ReactNode {
  useBoot();
  return <PacksPanel />;
}

const sections: SettingsSectionDef[] = [
  { id: 'templates', title: 'Templates', icon: <LayoutTemplate size={16} />, order: 60, Component: TemplatesSettings },
  { id: 'brand-kit', title: 'Brand kit', icon: <Palette size={16} />, order: 61, Component: BrandKitSettings },
  { id: 'content-packs', title: 'Content packs', icon: <Package size={16} />, order: 62, Component: PacksSettings },
];

export default sections;
