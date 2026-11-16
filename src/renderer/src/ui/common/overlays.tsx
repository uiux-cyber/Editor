import { AlertTriangle, CircleCheck, Info, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useUI } from '@/store/ui';

// ---------------------------------------------------------------------------------------------
// Context / dropdown menus
// ---------------------------------------------------------------------------------------------

export type MenuItem =
  | { type?: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean; run: () => void }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface MenuState {
  open: { x: number; y: number; items: MenuItem[]; minWidth?: number; anchorRight?: boolean } | null;
  show: (x: number, y: number, items: MenuItem[], opts?: { minWidth?: number; anchorRight?: boolean }) => void;
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
export function openMenuBelow(el: HTMLElement, items: MenuItem[], opts?: { minWidth?: number; alignRight?: boolean }): void {
  const r = el.getBoundingClientRect();
  useMenu.getState().show(opts?.alignRight ? r.right : r.left, r.bottom + 4, items, { minWidth: opts?.minWidth, anchorRight: opts?.alignRight });
}

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

  if (!open) return null;
  return createPortal(
    <div className="menu-backdrop" onPointerDown={hide} onContextMenu={(e) => { e.preventDefault(); hide(); }}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={{ left: pos?.left ?? open.x, top: pos?.top ?? open.y, minWidth: open.minWidth, visibility: pos ? 'visible' : 'hidden' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {open.items.map((item, i) => {
          if (item.type === 'separator') return <div key={i} className="menu__sep" />;
          if (item.type === 'label') return <div key={i} className="menu__label">{item.label}</div>;
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`menu__item ${item.danger ? 'is-danger' : ''}`}
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
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width }}>
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          {dismissable && (
            <button type="button" className="icon-btn" onClick={onClose} title="Close">
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
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} title="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
