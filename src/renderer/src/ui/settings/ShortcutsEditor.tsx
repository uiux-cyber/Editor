/**
 * Settings → Shortcuts: every registered command with its shortcuts. Click a shortcut (or "+")
 * to record a new key combination; conflicts are reported with the option to reassign; reset
 * one command or everything; searchable by name, group, id or keys.
 */

import { AlertTriangle, Keyboard, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/platform/api';
import { getCommand, getCommands, onCommandsChanged, type Command } from '../commands';
import { Keys, compareGroups } from '../commands/Keys';
import { eventToShortcut, shortcutLabel } from '../commands/keymap';
import { allBindings, assignShortcut, isCustomized, keyLabel, removeShortcut, resetAllShortcuts, resetCommand, useKeymapVersion } from '../commands/keymapStore';
import { findConflicts } from '../commands/keymap';
import { foldText } from '../palette/fuzzy';
import { useT } from '../i18n';
import { useSettingsSearch } from './store';

/** Combinations the OS or the app shell reserve. */
const RESERVED = new Set(['Alt+F4', 'F12', 'Ctrl+Shift+I', 'Ctrl+Alt+Delete']);

type Filter = 'all' | 'custom' | 'conflicts';

interface Recording {
  id: string;
  /** Binding slot being replaced; undefined adds a new one. */
  index?: number;
}

interface Pending {
  id: string;
  index?: number;
  shortcut: string;
  others: string[];
}

function useCommandList(): Command[] {
  const [list, setList] = useState(getCommands);
  useEffect(() => onCommandsChanged(() => setList(getCommands())), []);
  return list;
}

export function ShortcutsEditor(): ReactNode {
  const t = useT();
  useKeymapVersion();
  const commands = useCommandList();
  const globalSearch = useSettingsSearch();
  const [query, setQuery] = useState(globalSearch);
  const [filter, setFilter] = useState<Filter>('all');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => setQuery(globalSearch), [globalSearch]);

  const bindings = allBindings();
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const conflictIds = useMemo(() => new Set([...conflicts.values()].flat()), [conflicts]);

  // Capture the next key combination while recording.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(null);
        return;
      }
      if (e.key === 'Tab') {
        setRecording(null);
        return;
      }
      const shortcut = eventToShortcut(e);
      if (!shortcut) return; // only modifiers so far
      const cmd = getCommand(recording.id);
      setRecording(null);
      if (!cmd) return;
      if (RESERVED.has(shortcut)) {
        setNotice({ id: cmd.id, text: t('{keys} is reserved by the system and cannot be used.', { keys: shortcutLabel(shortcut, keyLabel) }) });
        return;
      }
      const current = allBindings().get(cmd.id) ?? [];
      if (current.includes(shortcut) && (recording.index === undefined || current[recording.index] === shortcut)) return;
      const others = [...allBindings()].filter(([id, list]) => id !== cmd.id && list.includes(shortcut)).map(([id]) => id);
      if (others.length) {
        setPending({ id: cmd.id, index: recording.index, shortcut, others });
        return;
      }
      assignShortcut(cmd, shortcut, recording.index, false);
      setNotice({ id: cmd.id, text: t('Shortcut set to {keys}.', { keys: shortcutLabel(shortcut, keyLabel) }) });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, t]);

  const groups = useMemo(() => {
    const words = foldText(query.trim()).split(/\s+/).filter(Boolean);
    const visible = commands.filter((cmd) => {
      if (filter === 'custom' && !isCustomized(cmd.id)) return false;
      if (filter === 'conflicts' && !conflictIds.has(cmd.id)) return false;
      if (!words.length) return true;
      const keys = (bindings.get(cmd.id) ?? []).map((s) => `${s} ${shortcutLabel(s, keyLabel)}`).join(' ');
      const hay = foldText(`${t(cmd.title)} ${cmd.title} ${t(cmd.group)} ${cmd.group} ${cmd.id} ${(cmd.keywords ?? []).join(' ')} ${keys}`);
      return words.every((w) => hay.includes(w));
    });
    const byGroup = new Map<string, Command[]>();
    for (const cmd of visible) {
      if (!byGroup.has(cmd.group)) byGroup.set(cmd.group, []);
      byGroup.get(cmd.group)!.push(cmd);
    }
    return [...byGroup.entries()].sort((a, b) => compareGroups(a[0], b[0]));
  }, [commands, query, filter, bindings, conflictIds, t]);

  const customCount = commands.filter((c) => isCustomized(c.id)).length;

  const resetAll = async (): Promise<void> => {
    const choice = await api.dialog.message({
      type: 'question',
      title: t('Reset shortcuts'),
      message: t('Reset all keyboard shortcuts to their defaults?'),
      detail: t('Your custom shortcuts will be removed.'),
      buttons: [t('Reset all'), t('Cancel')],
    });
    if (choice === 0) resetAllShortcuts();
  };

  const nameOf = (id: string): string => {
    const c = getCommand(id);
    return c ? t(c.title) : id;
  };

  return (
    <div className="sc">
      <div className="sc__toolbar">
        <label className="sc__search">
          <Search size={14} aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t('Search by name or keys')}
            aria-label={t('Search shortcuts')}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label={t('Show')}>
          {(
            [
              ['all', t('All')],
              ['custom', t('Customized ({count, number})', { count: customCount })],
              ['conflicts', t('Conflicts ({count, number})', { count: conflictIds.size })],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--outline btn--sm" disabled={customCount === 0} onClick={() => void resetAll()}>
          <RotateCcw size={12} /> {t('Reset all')}
        </button>
      </div>

      <div className="sc__live" aria-live="polite">
        {recording ? t('Press the new shortcut for “{name}”. Press Esc to cancel.', { name: nameOf(recording.id) }) : notice?.text ?? ''}
      </div>

      {groups.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Keyboard size={20} />
          </span>
          <div className="empty__title">{t('No matching commands')}</div>
        </div>
      )}

      {groups.map(([group, list]) => (
        <section key={group} className="sc__group" aria-label={t(group)}>
          <h4 className="sc__group-title">{t(group)}</h4>
          {list.map((cmd) => {
            const keys = bindings.get(cmd.id) ?? [];
            const isRec = recording?.id === cmd.id;
            const custom = isCustomized(cmd.id);
            const title = t(cmd.title);
            return (
              <div key={cmd.id} className={`sc-row ${isRec ? 'is-recording' : ''}`} data-command={cmd.id}>
                <div className="sc-row__main">
                  <div className="sc-row__title">
                    <span className="truncate">{title}</span>
                    {custom && <span className="sc-row__dot" title={t('Customized')} aria-label={t('Customized')} />}
                  </div>
                  <div className="sc-row__keys">
                    {keys.map((s, i) => {
                      const clash = (conflicts.get(s) ?? []).filter((id) => id !== cmd.id);
                      const replacing = isRec && recording?.index === i;
                      return (
                        <span key={s} className={`sc-chip ${clash.length ? 'is-conflict' : ''} ${replacing ? 'is-replacing' : ''}`}>
                          <button
                            type="button"
                            className="sc-chip__keys"
                            title={clash.length ? t('Also used by {names}', { names: clash.map(nameOf).join(', ') }) : t('Click to change')}
                            aria-label={t('Change shortcut {keys} of {name}', { keys: shortcutLabel(s, keyLabel), name: title })}
                            onClick={() => {
                              setPending(null);
                              setNotice(null);
                              setRecording({ id: cmd.id, index: i });
                            }}
                          >
                            {clash.length > 0 && <AlertTriangle size={11} aria-hidden="true" />}
                            {replacing ? <span className="sc-chip__wait">{t('Press keys…')}</span> : <Keys shortcut={s} size="sm" />}
                          </button>
                          <button type="button" className="sc-chip__remove" aria-label={t('Remove shortcut {keys} from {name}', { keys: shortcutLabel(s, keyLabel), name: title })} title={t('Remove')} onClick={() => removeShortcut(cmd, s)}>
                            <X size={11} />
                          </button>
                        </span>
                      );
                    })}
                    {isRec && recording?.index === undefined && <span className="sc-chip is-replacing"><span className="sc-chip__wait">{t('Press keys…')}</span></span>}
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm sc-row__add"
                      title={t('Add shortcut')}
                      aria-label={t('Add a shortcut to {name}', { name: title })}
                      onClick={() => {
                        setPending(null);
                        setNotice(null);
                        setRecording({ id: cmd.id });
                      }}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="sc-row__actions">
                    {custom && (
                      <button type="button" className="icon-btn icon-btn--sm" title={t('Reset to default')} aria-label={t('Reset {name} to its default shortcut', { name: title })} onClick={() => resetCommand(cmd.id)}>
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {pending?.id === cmd.id && (
                  <div className="sc-conflict" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <span>
                      {t('{keys} is already used by {names}.', { keys: shortcutLabel(pending.shortcut, keyLabel), names: pending.others.map((id) => `“${nameOf(id)}”`).join(', ') })}
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      autoFocus
                      onClick={() => {
                        const target = getCommand(pending.id);
                        if (target) assignShortcut(target, pending.shortcut, pending.index, true);
                        setNotice({ id: pending.id, text: t('Shortcut reassigned to “{name}”.', { name: title }) });
                        setPending(null);
                      }}
                    >
                      {t('Reassign')}
                    </button>
                    <button type="button" className="btn btn--sm btn--outline" onClick={() => setPending(null)}>
                      {t('Cancel')}
                    </button>
                  </div>
                )}
                {notice?.id === cmd.id && !pending && notice.text && !isRec && <div className="sc-note">{notice.text}</div>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
