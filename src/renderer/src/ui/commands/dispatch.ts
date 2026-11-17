/**
 * Global keyboard dispatch: key event → user keymap → command registry.
 *
 * Shortcuts do not fire while a dialog, menu or the command palette is open, while a shortcut
 * is being recorded, or (except for `global` commands) while a text field has focus. Enter / Space
 * on a control that was focused with the keyboard activate that control instead.
 */

import { useUI } from '@/store/ui';
import { useMenu } from '../common/overlays';
import { getCommand } from './index';
import { eventToShortcuts } from './keymap';
import { bindingIndex } from './keymapStore';

/** Overlays that take over the keyboard (command palette, settings window…) register here. */
const blockers = new Set<string>();
export function setKeyboardBlocker(id: string, on: boolean): void {
  if (on) blockers.add(id);
  else blockers.delete(id);
}
export const keyboardBlocked = (): boolean => blockers.size > 0;

export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (node as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'color' && type !== 'button' && type !== 'submit';
  }
  return false;
}

/** A control the user tabbed to: Enter / Space belong to it. */
function keyboardFocusedControl(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.matches) return false;
  if (!node.matches('button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], summary')) return false;
  try {
    return node.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** Keys whose command repeats while held (stepping, nudging, zooming); everything else fires once. */
const REPEATABLE = /^(Arrow(Left|Right|Up|Down)|[-+=_jlzyJLZY])$/;

/** Handle a keydown for the whole window. Returns true when a command ran. */
export function dispatchKey(e: KeyboardEvent): boolean {
  if (e.repeat && !REPEATABLE.test(e.key)) return false;
  if (keyboardBlocked() || useMenu.getState().open || useUI.getState().modal) return false;
  const shortcuts = eventToShortcuts(e);
  if (shortcuts.length === 0) return false;
  const typing = isTypingTarget(e.target);
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (plain && (e.key === 'Enter' || e.key === ' ') && keyboardFocusedControl(e.target)) return false;
  const index = bindingIndex();
  for (const shortcut of shortcuts) {
    const ids = index.get(shortcut);
    if (!ids) continue;
    for (const id of ids) {
      const cmd = getCommand(id);
      if (!cmd) continue;
      if (typing && !cmd.global) continue;
      if (cmd.when && !cmd.when()) continue;
      e.preventDefault();
      try {
        void Promise.resolve(cmd.run()).catch((err) => console.error(`[commands] ${id} failed`, err));
      } catch (err) {
        console.error(`[commands] ${id} failed`, err);
      }
      return true;
    }
  }
  return false;
}
