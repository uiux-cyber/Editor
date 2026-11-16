import { useState, type ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { Field, NumberInput, Select } from '../common/controls';
import { Modal } from '../common/overlays';
import { ExportDialog } from '../export/ExportDialog';
import { newProject } from '../projectIO';
import { PROJECT_FORMATS } from './Home';
import { SHORTCUTS } from './shortcuts';

function NewProjectModal({ onClose }: { onClose: () => void }): ReactNode {
  const [name, setName] = useState('');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const create = async (): Promise<void> => {
    onClose();
    await newProject({ name: name.trim() || undefined, width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2, fps });
  };
  return (
    <Modal
      title="New project"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void create()}>
            Create project
          </button>
        </>
      }
    >
      <Field label="Name" labelWidth={96}>
        <input autoFocus className="input" placeholder="Untitled project" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? void create() : e.stopPropagation())} />
      </Field>
      <div className="format-grid format-grid--5" style={{ margin: '10px 0' }}>
        {PROJECT_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`format-tile ${width === f.w && height === f.h ? 'is-active' : ''}`}
            onClick={() => {
              setWidth(f.w);
              setHeight(f.h);
            }}
          >
            <span className="format-tile__shape" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
            <strong>{f.label}</strong>
            <small>{f.hint.split(' · ')[0]}</small>
          </button>
        ))}
      </div>
      <Field label="Resolution" labelWidth={96}>
        <NumberInput prefix="W" value={width} min={16} max={7680} step={2} onChange={setWidth} />
        <NumberInput prefix="H" value={height} min={16} max={7680} step={2} onChange={setHeight} />
      </Field>
      <Field label="Frame rate" labelWidth={96}>
        <Select value={fps} options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: `${f} fps` }))} onChange={setFps} />
      </Field>
    </Modal>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }): ReactNode {
  const groups = ['Playback', 'Editing', 'Timeline', 'Project'] as const;
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={720}>
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g}>
            <h4>{g}</h4>
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.label} className="shortcut">
                <span>{s.label}</span>
                <span className="shortcut__keys">
                  {s.keys.map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function Modals(): ReactNode {
  const modal = useUI((s) => s.modal);
  const close = (): void => useUI.getState().openModal(null);
  if (modal === 'export') return <ExportDialog onClose={close} />;
  if (modal === 'newProject') return <NewProjectModal onClose={close} />;
  if (modal === 'shortcuts') return <ShortcutsModal onClose={close} />;
  return null;
}
