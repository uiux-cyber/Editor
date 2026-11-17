import { AlertTriangle, CircleCheck, Info, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useUI } from '@/store/ui';
import { t } from '../i18n';
import { useA11yId, useFocusTrap } from './a11y';

// ---------------------------------------------------------------------------------------------
// Context / dropdown menus
// ---------------------------------------------------------------------------------------------

export type MenuItem =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** A toggle / choice: announced as a checkbox item even while unchecked. */
      checkable?: boolean;
      run: () => void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface MenuOptions {
  minWidth?: number;
  anchorRight?: boolean;
  /** Keyboard: focus the first item when the menu opens (menus opened from the keyboard). */
  focusFirst?: boolean;
  /** Left / Right arrow pressed inside the menu (menu bars move to the neighbouring menu). */
  onNavigate?: (dir: -1 | 1) => void;
  /** Element that opened the menu; focus returns to it when the menu is dismissed with Escape. */
  opener?: HTMLElement | null;
  /** Accessible name of the menu. */
  label?: string;
}

interface MenuState {
  open: ({ x: number; y: number; items: MenuItem[] } & MenuOptions) | null;
  show: (x: number, y: number, items: MenuItem[], opts?: MenuOptions) => void;
  hide: () => void;
}

export const useMenu = create<MenuState>()((set) => ({
  open: null,
  show: (x, y, items, opts) => set({ open: { x, y, items, ...opts } }),
  hide: () => set({ open: null }),
}));

/** Open a context menu at the pointer. */
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]): void {
  e.preventDefault();
  useMenu.getState().show(e.clientX, e.clientY, items);
}

/** Open a dropdown under an element. */
export function openMenuBelow(el: HTMLElement, items: MenuItem[], opts?: { minWidth?: number; alignRight?: boolean } & Omit<MenuOptions, 'anchorRight' | 'minWidth'>): void {
  const r = el.getBoundingClientRect();
  useMenu.getState().show(opts?.alignRight ? r.right : r.left, r.bottom + 4, items, { opener: el, ...opts, minWidth: opts?.minWidth, anchorRight: opts?.alignRight });
}

const enabledItems = (menu: HTMLElement | null): HTMLButtonElement[] => (menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)')) : []);

export function MenuHost(): ReactNode {
  const open = useMenu((s) => s.open);
  const hide = useMenu((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    let left = open.anchorRight ? open.x - r.width : open.x;
    let top = open.y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
        open.opener?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  // Keyboard users land on the first item; pointer users get focus on the menu itself (so arrow
  // keys work) without a focus ring on an item.
  useEffect(() => {
    if (!open || !pos) return;
    const first = enabledItems(ref.current)[0];
    if (open.focusFirst && first) first.focus();
    else ref.current?.focus({ preventScroll: true });
  }, [open, pos]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!open) return;
    const items = enabledItems(ref.current);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number): void => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focusAt(current < 0 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        focusAt(current < 0 ? items.length - 1 : current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!open.onNavigate) return;
        open.onNavigate(e.key === 'ArrowLeft' ? -1 : 1);
        break;
      case 'Tab':
        hide();
        open.opener?.focus();
        break;
      default: {
        // Type-ahead: jump to the next item starting with the typed letter.
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
        const ch = e.key.toLowerCase();
        const order = [...items.slice(current + 1), ...items.slice(0, current + 1)];
        const hit = order.find((b) => (b.querySelector('.menu__text')?.textContent ?? '').trim().toLowerCase().startsWith(ch));
        if (!hit) return;
        hit.focus();
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };

  if (!open) return null;
  return createPortal(
    <div className="menu-backdrop" onPointerDown={hide} onContextMenu={(e) => { e.preventDefault(); hide(); }}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={open.label}
        tabIndex={-1}
        style={{ left: pos?.left ?? open.x, top: pos?.top ?? open.y, minWidth: open.minWidth, visibility: pos ? 'visible' : 'hidden' }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onMenuKey}
      >
        {open.items.map((item, i) => {
          if (item.type === 'separator') return <div key={i} className="menu__sep" role="separator" />;
          if (item.type === 'label') return <div key={i} className="menu__label" role="presentation">{item.label}</div>;
          const checkable = item.checkable || item.checked !== undefined;
          return (
            <button
              key={i}
              type="button"
              role={checkable ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={checkable ? !!item.checked : undefined}
              aria-keyshortcuts={item.shortcut}
              tabIndex={-1}
              disabled={item.disabled}
              className={`menu__item ${item.danger ? 'is-danger' : ''}`}
              onPointerMove={(e) => {
                if (document.activeElement !== e.currentTarget && !item.disabled) e.currentTarget.focus({ preventScroll: true });
              }}
              onClick={() => {
                hide();
                item.run();
              }}
            >
              <span className="menu__icon">{item.checked ? <CircleCheck size={14} /> : item.icon}</span>
              <span className="menu__text">{item.label}</span>
              {item.shortcut && <span className="menu__shortcut">{item.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------------------------

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 560,
  dismissable = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  /** When false the dialog cannot be closed by Escape or by clicking outside. */
  dismissable?: boolean;
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, dismissable]);
  // Accessibility: keep keyboard focus inside the dialog and restore it on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const titleId = useA11yId('modal-title');
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ width }}>
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          {dismissable && (
            <button type="button" className="icon-btn" onClick={onClose} title={t('Close')} aria-label={t('Close')}>
              <X size={16} />
            </button>
          )}
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export function Toasts(): ReactNode {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const dismissLabel = t('Dismiss');
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <span className="toast__icon">{t.kind === 'success' ? <CircleCheck size={16} /> : t.kind === 'error' || t.kind === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}</span>
          <div className="toast__body">
            <div className="toast__title">{t.message}</div>
            {t.detail && <div className="toast__detail">{t.detail}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              className="btn btn--sm btn--outline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} title={dismissLabel} aria-label={dismissLabel}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
