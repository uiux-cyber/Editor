/**
 * History panel: every undo step with its label and age, the current state highlighted and
 * steps that were undone dimmed. Clicking a step jumps there (several undos / redos at once).
 * Opens as a popover from the timeline toolbar (or the `view.history` command).
 */

import { History, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useProjectStore } from '@/store/project';
import { goToHistory } from '../actions';
import { t, tMaybe, useT } from '../i18n';

interface PanelState {
  open: boolean;
  /** Element the popover hangs from. */
  anchor: HTMLElement | null;
  toggle: (anchor?: HTMLElement | null) => void;
  close: () => void;
}

export const useHistoryPanel = create<PanelState>()((set, get) => ({
  open: false,
  anchor: null,
  toggle: (anchor) => {
    if (get().open) set({ open: false });
    else set({ open: true, anchor: anchor ?? document.querySelector<HTMLElement>('[data-history-button]') });
  },
  close: () => set({ open: false }),
}));

/** "just now", "25 s ago", "4 min ago", "2 h ago". */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return t('just now');
  if (s < 60) return t('{count} s ago', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('{count} min ago', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{count} h ago', { count: h });
  return new Date(at).toLocaleDateString();
}

const WIDTH = 288;

export function HistoryPanel(): ReactNode {
  const t = useT();
  const open = useHistoryPanel((s) => s.open);
  const anchor = useHistoryPanel((s) => s.anchor);
  const close = useHistoryPanel((s) => s.close);
  const pastMeta = useProjectStore((s) => s.pastMeta);
  const futureMeta = useProjectStore((s) => s.futureMeta);
  const filePath = useProjectStore((s) => s.filePath);
  const busy = useProjectStore((s) => !!s.txnBase);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = pastMeta.length;

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [open, pastMeta, futureMeta]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = anchor?.getBoundingClientRect() ?? { left: 16, right: 16 + WIDTH, top: window.innerHeight - 40, bottom: window.innerHeight - 40 };
    const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, r.left));
    const above = r.top - 8;
    const below = window.innerHeight - r.bottom - 8;
    setPos(above >= 220 || above >= below ? { left, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(440, above - 8) } : { left, top: r.bottom + 6, maxHeight: Math.min(440, below - 8) });
  }, [open, anchor]);

  // Keep the current step in view.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.history__row.is-current')?.scrollIntoView({ block: 'nearest' });
  }, [open, current, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, anchor, close]);

  if (!open || !pos) return null;
  const steps = [...pastMeta, ...futureMeta];
  const rows = [{ label: filePath ? t('Opened project') : t('Start', undefined, 'history'), at: null as number | null }, ...steps.map((m) => ({ label: tMaybe(m.label), at: m.at as number | null }))];

  return createPortal(
    <div ref={panelRef} className="history popover" role="dialog" aria-label={t('History')} style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: WIDTH, maxHeight: pos.maxHeight }}>
      <header className="history__head">
        <History size={14} />
        <span className="history__title">{t('History')}</span>
        <span className="history__count">
          {steps.length === 0 ? t('No changes yet') : t('{current} of {count, plural, one {# step} other {# steps}}', { current, count: steps.length })}
        </span>
        <button type="button" className="icon-btn icon-btn--sm" title={t('Close (Esc)')} onClick={close}>
          <X size={13} />
        </button>
      </header>
      <div className="history__list" ref={listRef} role="listbox" aria-label={t('Undo steps')}>
        {rows.map((row, i) => (
          <button
            key={i}
            type="button"
            role="option"
            aria-selected={i === current}
            className={`history__row ${i === current ? 'is-current' : ''} ${i > current ? 'is-undone' : ''}`}
            disabled={busy}
            data-history-index={i}
            title={i === current ? t('Current state') : i < current ? t('Click to undo back to here') : t('Click to redo up to here')}
            onClick={() => goToHistory(i)}
          >
            <span className="history__dot" />
            <span className="history__label truncate">{row.label}</span>
            <span className="history__time">{row.at ? relativeTime(row.at, now) : ''}</span>
          </button>
        ))}
      </div>
      <footer className="history__foot">{t('Click a step to go back to it. New edits after an undo replace the dimmed steps.')}</footer>
    </div>,
    document.body,
  );
}
