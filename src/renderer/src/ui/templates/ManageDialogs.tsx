import { useState, type ReactNode } from 'react';
import { TEMPLATE_CATEGORIES } from '@/library/staticTemplates';
import type { TemplateCategory } from '@/library/types';
import { api } from '@/platform/api';
import { toast } from '@/store/ui';
import { Field, Select } from '../common/controls';
import { Modal } from '../common/overlays';
import { useT } from '../i18n';
import { labelOf } from '../library/common';
import { deleteUserTemplate, renameUserTemplate, useTemplates } from './store';

export function RenameTemplateDialog({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const tr = useT();
  const entry = useTemplates((s) => s.templates.find((t) => t.id === id));
  const [name, setName] = useState(entry?.file.name ?? '');
  const [category, setCategory] = useState<TemplateCategory>(entry?.file.category ?? 'title');
  const [tags, setTags] = useState(entry?.file.tags.join(', ') ?? '');
  if (!entry) return null;
  const save = async (): Promise<void> => {
    if (!name.trim()) return;
    onClose();
    await renameUserTemplate(id, { name: name.trim(), category, tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) });
  };
  return (
    <Modal
      title={tr('Edit template details')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={() => void save()} data-testid="rename-save">
            {tr('Save')}
          </button>
        </>
      }
    >
      <div className="tpl-manage">
        {entry.poster && <img className="tpl-manage__poster" src={api.media.toUrl(entry.poster)} alt="" draggable={false} />}
        <div className="tpl-manage__form">
          <Field label={tr('Name')} labelWidth={72}>
            <input
              className="input"
              autoFocus
              value={name}
              maxLength={80}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void save();
              }}
              data-testid="rename-input"
            />
          </Field>
          <Field label={tr('Category')} labelWidth={72}>
            <Select value={category} options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: labelOf(c) }))} onChange={setCategory} />
          </Field>
          <Field label={tr('Tags')} labelWidth={72}>
            <input className="input" value={tags} spellCheck={false} onChange={(e) => setTags(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function ConfirmDeleteDialog({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const tr = useT();
  const entry = useTemplates((s) => s.templates.find((t) => t.id === id));
  if (!entry) return null;
  return (
    <Modal
      title={tr('Delete “{name}”?', { name: entry.file.name })}
      subtitle={tr('The template is moved to the Recycle Bin. Projects that already use it keep their layers.')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose} autoFocus>
            {tr('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="confirm-delete"
            onClick={() => {
              onClose();
              void deleteUserTemplate(id).then(() => toast('info', tr('Deleted “{name}”', { name: entry.file.name })));
            }}
          >
            {tr('Delete template')}
          </button>
        </>
      }
    >
      {entry.poster ? <img className="tpl-manage__poster tpl-manage__poster--wide" src={api.media.toUrl(entry.poster)} alt="" draggable={false} /> : <span />}
    </Modal>
  );
}
