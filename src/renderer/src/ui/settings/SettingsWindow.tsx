/**
 * The Settings window: a searchable list of every registered settings section on the left and
 * the selected section on the right. Opened from the title bar (gear), Ctrl+, or the palette.
 */

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Component, useEffect, useMemo, useRef, type ErrorInfo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useA11yId, useFocusTrap } from '../common/a11y';
import { getCommands } from '../commands';
import { t, useT } from '../i18n';
import { foldText } from '../palette/fuzzy';
import { SETTINGS_SECTIONS, type SettingsSectionDef } from './index';
import { useSettingsWindow } from './store';

/** A section that throws must not take the whole window down. */
class SectionBoundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[settings] section "${this.props.id}" failed`, error, info.componentStack);
  }
  override componentDidUpdate(prev: { id: string }): void {
    if (prev.id !== this.props.id && this.state.error) this.setState({ error: null });
  }
  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <div className="empty__title">{t('This section could not be displayed')}</div>
        <p>{this.state.error.message}</p>
      </div>
    );
  }
}

function sectionMatches(def: SettingsSectionDef, words: string[], t: (s: string) => string): boolean {
  if (words.length === 0) return true;
  const hay = foldText([def.title, t(def.title), def.description ?? '', def.description ? t(def.description) : '', ...(def.keywords ?? [])].join(' '));
  if (words.every((w) => hay.includes(w))) return true;
  if (def.id === 'shortcuts') {
    // Searching for a command name finds it in the shortcut list.
    return getCommands().some((c) => {
      const text = foldText(`${c.title} ${t(c.title)} ${c.id}`);
      return words.every((w) => text.includes(w));
    });
  }
  return false;
}

export function SettingsWindow({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const section = useSettingsWindow((s) => s.section);
  const search = useSettingsWindow((s) => s.search);
  const ref = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const titleId = useA11yId('settings-title');
  const panelId = useA11yId('settings-panel');
  useFocusTrap(ref, true, 'first');

  // Escape closes (bubble phase: fields and the shortcut recorder handle it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLInputElement | null;
      if (target?.type === 'search' && target.value) return; // the search field clears itself first
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const words = useMemo(() => foldText(search.trim()).split(/\s+/).filter(Boolean), [search]);
  const visible = useMemo(() => SETTINGS_SECTIONS.filter((d) => sectionMatches(d, words, t)), [words, t]);
  const active = visible.find((d) => d.id === section) ?? visible[0] ?? null;

  const select = (id: string): void => useSettingsWindow.setState({ section: id });

  const onNavKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    if (!(e.key in keys) || visible.length === 0) return;
    e.preventDefault();
    const i = Math.max(0, visible.findIndex((d) => d.id === active?.id));
    const step = keys[e.key];
    const next = step === -Infinity ? 0 : step === Infinity ? visible.length - 1 : (i + step + visible.length) % visible.length;
    select(visible[next].id);
    requestAnimationFrame(() => navRef.current?.querySelector<HTMLElement>(`[data-section="${visible[next].id}"]`)?.focus());
  };

  const Body = active?.Component;

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="settings" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <aside className="settings__nav">
          <h2 className="settings__heading" id={titleId}>
            {t('Settings')}
          </h2>
          <label className="settings__search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              className="input"
              placeholder={t('Search settings')}
              aria-label={t('Search settings')}
              value={search}
              spellCheck={false}
              onChange={(e) => useSettingsWindow.setState({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && search) {
                  e.preventDefault();
                  useSettingsWindow.setState({ search: '' });
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  navRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
                }
              }}
            />
          </label>
          <div ref={navRef} className="settings__tabs" role="tablist" aria-orientation="vertical" aria-label={t('Sections')} onKeyDown={onNavKey}>
            {visible.map((d) => {
              const on = d.id === active?.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  data-section={d.id}
                  aria-selected={on}
                  aria-controls={panelId}
                  tabIndex={on ? 0 : -1}
                  className={`settings__tab ${on ? 'is-active' : ''}`}
                  onClick={() => select(d.id)}
                >
                  <span className="settings__tab-icon" aria-hidden="true">
                    {d.icon ?? <SlidersHorizontal size={16} />}
                  </span>
                  <span className="truncate">{t(d.title)}</span>
                </button>
              );
            })}
            {visible.length === 0 && <div className="settings__none">{t('No settings match “{query}”', { query: search })}</div>}
          </div>
        </aside>
        <section className="settings__main" role="tabpanel" id={panelId} aria-label={active ? t(active.title) : undefined}>
          <header className="settings__head">
            <div style={{ minWidth: 0 }}>
              <h3 className="settings__title">{active ? t(active.title) : t('Settings')}</h3>
              {active?.description && <p className="settings__desc">{t(active.description)}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} title={t('Close')} aria-label={t('Close settings')}>
              <X size={16} />
            </button>
          </header>
          <div className="settings__body" data-settings-section={active?.id}>
            {Body && active && (
              <SectionBoundary id={active.id}>
                <Body />
              </SectionBoundary>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
