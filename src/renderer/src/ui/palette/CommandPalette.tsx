/**
 * Command palette (Ctrl+K / Ctrl+Shift+P): fuzzy search across every registered command and the
 * content library, recently used items first, fully keyboard driven.
 *
 *   ↑ ↓ / PgUp PgDn   move        Enter   run          Esc   close
 *   type ">" first     commands only
 */

import { Blend, ChevronRight, Clock, CornerDownLeft, Image, LayoutTemplate, Music, Palette as PaletteIcon, Search, Smile, Sparkles, Type } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useA11yId, useFocusTrap } from '../common/a11y';
import { getCommand } from '../commands';
import { Keys, compareGroups } from '../commands/Keys';
import { bindingsFor, useKeymapVersion } from '../commands/keymapStore';
import { formatNumber, useLocale, useT } from '../i18n';
import { highlightRuns, rankItems } from './fuzzy';
import { KIND_LABELS, commandEntries, libraryEntriesFor, type EntryKind, type PaletteEntry } from './sources';
import { closePalette, rememberPaletteItem, usePalette } from './store';

const KIND_ICONS: Record<EntryKind, ReactNode> = {
  command: <ChevronRight size={15} />,
  template: <LayoutTemplate size={15} />,
  effect: <Sparkles size={15} />,
  transition: <Blend size={15} />,
  filter: <PaletteIcon size={15} />,
  text: <Type size={15} />,
  sticker: <Smile size={15} />,
  sound: <Music size={15} />,
  background: <Image size={15} />,
};

const PER_KIND_LIMIT = 8;
const MAX_RESULTS = 60;

interface Row {
  entry: PaletteEntry;
  highlights?: number[];
  section?: string;
}

function Highlighted({ text, indices }: { text: string; indices?: number[] }): ReactNode {
  return (
    <>
      {highlightRuns(text, indices).map((r, i) =>
        r.hit ? (
          <mark key={i} className="palette__hit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette(): ReactNode {
  const open = usePalette((s) => s.open);
  if (!open) return null;
  return <PaletteDialog />;
}

function PaletteDialog(): ReactNode {
  const t = useT();
  const locale = useLocale();
  useKeymapVersion();
  const initial = usePalette((s) => s.initial);
  const recent = usePalette((s) => s.recent);
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useA11yId('palette-list');
  const optId = useA11yId('palette-opt');
  useFocusTrap(dialogRef, true, 'first');

  // Snapshot of what is available when the palette opens (commands' `when` / `checked`).
  const commands = useMemo(() => commandEntries(), []);
  const library = useMemo(() => libraryEntriesFor(locale), [locale]);

  const rows = useMemo((): Row[] => {
    const raw = query.trim();
    const commandsOnly = raw.startsWith('>');
    const q = commandsOnly ? raw.slice(1).trim() : raw;
    if (!q) {
      const byKey = new Map(commands.map((e) => [e.key, e]));
      const recentRows: Row[] = [];
      for (const key of recent) {
        const e = byKey.get(key);
        if (e && recentRows.length < 6) recentRows.push({ entry: e, section: t('Recently used') });
      }
      const recentKeys = new Set(recentRows.map((r) => r.entry.key));
      const rest = commands
        .filter((e) => !recentKeys.has(e.key))
        .sort((a, b) => {
          const ga = getCommand(a.commandId ?? '')?.group ?? '';
          const gb = getCommand(b.commandId ?? '')?.group ?? '';
          return compareGroups(ga, gb) || a.title.localeCompare(b.title, locale);
        })
        .map((entry): Row => ({ entry, section: t('All commands') }));
      return [...recentRows, ...rest];
    }
    const pool = commandsOnly ? commands : [...commands, ...library];
    const ranked = rankItems(q, pool, recent);
    const perKind = new Map<EntryKind, number>();
    const out: Row[] = [];
    for (const r of ranked) {
      const kind = r.item.kind;
      const n = perKind.get(kind) ?? 0;
      if (kind !== 'command' && n >= PER_KIND_LIMIT) continue;
      perKind.set(kind, n + 1);
      out.push({ entry: r.item, highlights: r.highlights.get(0) });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [query, commands, library, recent, t, locale]);

  useEffect(() => setActive(0), [query]);

  // Keep the active row visible.
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, rows]);

  const run = (row: Row | undefined): void => {
    if (!row) return;
    closePalette();
    rememberPaletteItem(row.entry.key);
    // Let the palette close (and give focus back) before the command opens its own UI.
    window.setTimeout(() => {
      try {
        void Promise.resolve(row.entry.run()).catch((err) => console.error('[palette]', err));
      } catch (err) {
        console.error('[palette]', err);
      }
    }, 0);
  };

  const onKey = (e: ReactKeyboardEvent): void => {
    const page = 8;
    switch (e.key) {
      case 'ArrowDown':
        setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
        break;
      case 'ArrowUp':
        setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
        break;
      case 'PageDown':
        setActive((i) => Math.min(rows.length - 1, i + page));
        break;
      case 'PageUp':
        setActive((i) => Math.max(0, i - page));
        break;
      case 'Home':
        if (!e.ctrlKey) return;
        setActive(0);
        break;
      case 'End':
        if (!e.ctrlKey) return;
        setActive(rows.length - 1);
        break;
      case 'Enter':
        run(rows[active]);
        break;
      case 'Escape':
        closePalette();
        break;
      case 'Tab':
        // Focus stays in the search field; Tab moves through results like the arrows.
        setActive((i) => (rows.length ? (i + (e.shiftKey ? -1 : 1) + rows.length) % rows.length : 0));
        break;
      default:
        e.stopPropagation();
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // Close when the window loses focus or Escape is pressed elsewhere.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePalette();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, []);

  const resultCount = rows.length;
  let lastSection: string | undefined;

  return createPortal(
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div ref={dialogRef} className="palette" role="dialog" aria-modal="true" aria-label={t('Command palette')} onKeyDown={onKey}>
        <div className="palette__input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `${optId}-${active}` : undefined}
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('Search commands, effects, templates, stickers…')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Keys shortcut="Escape" size="sm" />
        </div>
        <div ref={listRef} className="palette__list" role="listbox" id={listId} aria-label={t('Results')}>
          {rows.map((row, i) => {
            const header = row.section && row.section !== lastSection ? row.section : null;
            lastSection = row.section;
            const { entry } = row;
            const shortcut = entry.commandId ? bindingsFor(entry.commandId)[0] : undefined;
            const icon = entry.commandId ? (getCommand(entry.commandId)?.icon ?? KIND_ICONS.command) : KIND_ICONS[entry.kind];
            return (
              <div key={entry.key} role="presentation">
                {header && (
                  <div className="palette__section" role="presentation">
                    {header === t('Recently used') && <Clock size={11} aria-hidden="true" />} {header}
                  </div>
                )}
                <div
                  id={`${optId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  data-key={entry.key}
                  className={`palette__item ${i === active ? 'is-active' : ''}`}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => run(row)}
                >
                  <span className={`palette__icon palette__icon--${entry.kind}`} aria-hidden="true">
                    {icon}
                  </span>
                  <span className="palette__text">
                    <span className="palette__title truncate">
                      <Highlighted text={entry.title} indices={row.highlights} />
                    </span>
                    <span className="palette__detail truncate">{entry.kind === 'command' ? entry.detail : `${t(KIND_LABELS[entry.kind])} · ${entry.detail}`}</span>
                  </span>
                  {entry.checked !== undefined && <span className={`palette__state ${entry.checked ? 'is-on' : ''}`}>{entry.checked ? t('On') : t('Off')}</span>}
                  {shortcut ? <Keys shortcut={shortcut} size="sm" /> : entry.kind !== 'command' ? <span className="palette__kind">{t(KIND_LABELS[entry.kind])}</span> : null}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="palette__empty">
              <strong>{t('No results')}</strong>
              <span>{t('Try another word, or type “>” to search commands only.')}</span>
            </div>
          )}
        </div>
        <footer className="palette__foot">
          <span>
            <Keys shortcut="ArrowUp" size="sm" />
            <Keys shortcut="ArrowDown" size="sm" /> {t('Navigate')}
          </span>
          <span>
            <kbd className="kbd">
              <CornerDownLeft size={11} />
            </kbd>{' '}
            {t('Run')}
          </span>
          <span>
            <kbd className="kbd">&gt;</kbd> {t('Commands only')}
          </span>
          <span className="palette__count" aria-live="polite">
            {query.trim() ? t('{count, plural, =0 {No results} one {# result} other {# results}}', { count: resultCount }) : t('{count} commands', { count: formatNumber(commands.length) })}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
