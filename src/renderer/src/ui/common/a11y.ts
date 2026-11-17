/**
 * Accessibility helpers for dialogs and overlays.
 */

import { useEffect, useId, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Keep Tab / Shift+Tab inside `ref` while `active`, move focus into it when it opens (unless
 * something inside already has focus, e.g. an autoFocus field) and give focus back to the
 * previously focused element when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true, initial: 'container' | 'first' = 'container'): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      if (root.contains(document.activeElement)) return;
      const target = initial === 'first' ? (focusableIn(root)[0] ?? root) : root;
      target.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !root.isConnected) return;
      const list = focusableIn(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    };
  }, [ref, active, initial]);
}

/** Stable id for aria-labelledby / aria-describedby pairs. */
export const useA11yId = (prefix: string): string => `${prefix}-${useId().replace(/:/g, '')}`;
