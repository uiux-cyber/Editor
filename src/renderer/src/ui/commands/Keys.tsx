import type { ReactNode } from 'react';
import { keyCaps } from './keymapStore';
import { shortcutLabel } from './keymap';
import { keyLabel } from './keymapStore';

/** A shortcut as key caps: <kbd>Ctrl</kbd><kbd>K</kbd>. */
export function Keys({ shortcut, size = 'md' }: { shortcut: string; size?: 'sm' | 'md' }): ReactNode {
  return (
    <span className={`keys keys--${size}`} aria-label={shortcutLabel(shortcut, keyLabel)}>
      {keyCaps(shortcut).map((k, i) => (
        <kbd key={i} className="kbd" aria-hidden="true">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Group order used wherever commands are listed by group. */
export const GROUP_ORDER = ['File', 'Edit', 'Clip', 'Timeline', 'Playback', 'Tools', 'View', 'Smart', 'Preferences', 'Help'];

export function compareGroups(a: string, b: string): number {
  const ia = GROUP_ORDER.indexOf(a);
  const ib = GROUP_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b);
}
