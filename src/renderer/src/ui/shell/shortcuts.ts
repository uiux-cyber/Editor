/**
 * Global keyboard shortcuts. Every shortcut is a command in the registry (defaults in
 * `ui/commands/defs/*.ts`, user overrides in Settings → Shortcuts); this only forwards key
 * events to the dispatcher. The keyboard shortcuts dialog is generated from the same keymap.
 */

import { dispatchKey } from '../commands/dispatch';

/** Global keyboard handler (installed on window by the shell). */
export function handleEditorKey(e: KeyboardEvent): void {
  dispatchKey(e);
}
