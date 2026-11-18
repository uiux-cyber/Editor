import { Keyboard, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { CollectDialog } from '../collect/CollectDialog';
import { getCommands } from '../commands';
import { Keys, compareGroups } from '../commands/Keys';
import { allBindings, useKeymapVersion } from '../commands/keymapStore';
import { Field, NumberInput, Select } from '../common/controls';
import { Modal } from '../common/overlays';
import { ExportDialog } from '../export/ExportDialog';
import { useT } from '../i18n';
import { foldText } from '../palette/fuzzy';
import { newProject } from '../projectIO';
import { SettingsWindow } from '../settings/SettingsWindow';
import { openSettings, getSetting } from '../settings/store';
import { PROJECT_FORMATS } from './Home';
import { UpdateModal } from './UpdateButton';

function NewProjectModal({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const [name, setName] = useState('');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  // Settings → General → frame rate for new projects.
  useEffect(() => {
    void getSetting<number>('general.defaultFps', 30).then(setFps);
  }, []);
  const create = async (): Promise<void> => {
    onClose();
    await newProject({ name: name.trim() || undefined, width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2, fps });
  };
  return (
    <Modal
      title={t('New project')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void create()}>
            {t('Create project')}
          </button>
        </>
      }
    >
      <Field label={t('Name')} labelWidth={96}>
        <input
          autoFocus
          className="input"
          placeholder={t('Untitled project')}
          aria-label={t('Name')}
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? void create() : e.stopPropagation())}
        />
      </Field>
      <div className="format-grid format-grid--5" style={{ margin: '10px 0' }} role="radiogroup" aria-label={t('Format')}>
        {PROJECT_FORMATS.map((f) => {
          const on = width === f.w && height === f.h;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`format-tile ${on ? 'is-active' : ''}`}
              onClick={() => {
                setWidth(f.w);
                setHeight(f.h);
              }}
            >
              <span className="format-tile__shape" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
              <strong>{f.label}</strong>
              <small>{t(f.hint).split(' · ')[0]}</small>
            </button>
          );
        })}
      </div>
      <Field label={t('Resolution')} labelWidth={96}>
        <NumberInput prefix="W" value={width} min={16} max={7680} step={2} onChange={setWidth} />
        <NumberInput prefix="H" value={height} min={16} max={7680} step={2} onChange={setHeight} />
      </Field>
      <Field label={t('Frame rate')} labelWidth={96}>
        <Select value={fps} options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: t('{fps, number} fps', { fps: f }) }))} onChange={setFps} />
      </Field>
    </Modal>
  );
}

/** Gestures that are not commands (so not in the keymap). */
const MOUSE_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'Scroll'], label: 'Zoom the timeline around the cursor' },
  { keys: ['Shift', 'Scroll'], label: 'Scroll the timeline sideways' },
  { keys: ['Shift', 'Click'], label: 'Add a clip to the selection' },
  { keys: ['Alt', 'Drag'], label: 'Move without snapping' },
  { keys: ['Shift', 'Drag'], label: 'Move on the canvas along one axis' },
  { keys: ['Shift', 'Rotate'], label: 'Rotate in 15° steps' },
];

/** Every command with a shortcut, from the user's keymap. */
function ShortcutsModal({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  useKeymapVersion();
  const [query, setQuery] = useState('');
  const bindings = allBindings();
  const groups = useMemo(() => {
    const words = foldText(query.trim()).split(/\s+/).filter(Boolean);
    const map = new Map<string, { id: string; title: string; keys: string[] }[]>();
    for (const cmd of getCommands()) {
      const keys = bindings.get(cmd.id) ?? [];
      if (keys.length === 0) continue;
      const title = t(cmd.title);
      if (words.length && !words.every((w) => foldText(`${title} ${cmd.title} ${t(cmd.group)} ${keys.join(' ')}`).includes(w))) continue;
      if (!map.has(cmd.group)) map.set(cmd.group, []);
      map.get(cmd.group)!.push({ id: cmd.id, title, keys });
    }
    return [...map.entries()].sort((a, b) => compareGroups(a[0], b[0]));
  }, [bindings, query, t]);

  return (
    <Modal
      title={t('Keyboard shortcuts')}
      subtitle={t('Shortcuts follow your keymap. Change them in Settings → Shortcuts.')}
      onClose={onClose}
      width={820}
      footer={
        <>
          <label className="sc__search" style={{ width: 260 }}>
            <Search size={14} aria-hidden="true" />
            <input className="input" type="search" placeholder={t('Search shortcuts')} aria-label={t('Search shortcuts')} value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              onClose();
              openSettings('shortcuts');
            }}
          >
            <Keyboard size={14} /> {t('Customize…')}
          </button>
        </>
      }
    >
      <div className="shortcuts">
        {groups.map(([group, list]) => (
          <section key={group}>
            <h4>{t(group)}</h4>
            {list.map((s) => (
              <div key={s.id} className="shortcut">
                <span>{s.title}</span>
                <span className="shortcut__keys">
                  {s.keys.slice(0, 2).map((k, i) => (
                    <span key={k} className="shortcut__alt">
                      {i > 0 && <span className="shortcut__or">{t('or')}</span>}
                      <Keys shortcut={k} size="sm" />
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
        {!query && (
          <section>
            <h4>{t('Mouse')}</h4>
            {MOUSE_SHORTCUTS.map((s) => (
              <div key={s.label} className="shortcut">
                <span>{t(s.label)}</span>
                <span className="shortcut__keys">
                  {s.keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {t(k, undefined, 'key')}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        )}
        {groups.length === 0 && <p className="set-note">{t('No shortcuts match “{query}”', { query })}</p>}
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
  if (modal === 'settings') return <SettingsWindow onClose={close} />;
  if (modal === 'collect') return <CollectDialog onClose={close} />;
  if (modal === 'update') return <UpdateModal onClose={close} />;
  return null;
}
