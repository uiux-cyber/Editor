/**
 * F6 / Shift+F6: move keyboard focus between the editor's main panels (library, preview,
 * inspector, timeline), like Windows applications. Each panel is a focusable landmark marked with
 * `data-pane`; returning to a panel restores the element that last had focus inside it.
 */

export const PANES = ['library', 'preview', 'inspector', 'timeline'] as const;
export type PaneId = (typeof PANES)[number];

const lastFocus = new Map<PaneId, HTMLElement>();

function paneOf(el: Element | null): HTMLElement | null {
  return (el?.closest?.('[data-pane]') as HTMLElement | null) ?? null;
}

/** Remember the focused element per pane (installed once by the shell). */
export function trackPaneFocus(): () => void {
  const onFocus = (e: FocusEvent): void => {
    const target = e.target as HTMLElement | null;
    const pane = paneOf(target);
    if (pane && target && target !== pane) lastFocus.set(pane.dataset.pane as PaneId, target);
  };
  document.addEventListener('focusin', onFocus);
  return () => document.removeEventListener('focusin', onFocus);
}

export function focusPane(id: PaneId): boolean {
  const pane = document.querySelector<HTMLElement>(`[data-pane="${id}"]`);
  if (!pane) return false;
  const remembered = lastFocus.get(id);
  const target = remembered && remembered.isConnected && pane.contains(remembered) && remembered.offsetParent !== null ? remembered : pane;
  target.focus({ preventScroll: true });
  return true;
}

/** Focus the next (1) / previous (-1) panel. */
export function cyclePane(dir: 1 | -1): void {
  const current = paneOf(document.activeElement)?.dataset.pane as PaneId | undefined;
  const available = PANES.filter((p) => document.querySelector(`[data-pane="${p}"]`));
  if (available.length === 0) return;
  const i = current ? available.indexOf(current) : dir > 0 ? -1 : 0;
  const next = available[(i + dir + available.length) % available.length];
  focusPane(next);
}
