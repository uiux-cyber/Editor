/**
 * Title-bar menus generated from the command registry.
 *
 * Core commands follow the fixed layouts below (sections and separators). Any other registered
 * command is appended to its menu (`Command.menu`, else its group when that names a menu, else
 * Tools) under a heading with its group / `menuSection` name, so feature commands appear
 * automatically.
 */

import type { MenuItem } from '../common/overlays';
import { t } from '../i18n';
import { getCommands, runCommand, type Command } from './index';
import { shortcutText } from './keymapStore';

export const MENU_NAMES = ['File', 'Edit', 'View', 'Tools', 'Help'] as const;
export type MenuName = (typeof MENU_NAMES)[number];

/** `-` = separator, `#Heading` = section label. */
const LAYOUT: Record<MenuName, string[]> = {
  File: ['file.new', 'file.open', '-', 'file.save', 'file.saveAs', 'file.collect', '-', 'file.import', 'file.export', '-', 'app.settings', '-', 'file.close'],
  Edit: [
    'edit.undo',
    'edit.redo',
    '-',
    'edit.cut',
    'edit.copy',
    'edit.paste',
    'edit.duplicate',
    'edit.delete',
    'edit.rippleDelete',
    '-',
    'edit.selectAll',
    'edit.deselect',
    '-',
    'clip.split',
    'clip.trimStart',
    'clip.trimEnd',
    'clip.detachAudio',
    'timeline.addMarker',
    '-',
    'timeline.addVideoTrack',
    'timeline.addAudioTrack',
    'timeline.removeEmptyTracks',
  ],
  View: [
    'view.palette',
    '-',
    '#Playback',
    'playback.toggle',
    'playback.start',
    'playback.end',
    'playback.prevEdit',
    'playback.nextEdit',
    'playback.loop',
    '-',
    '#Timeline',
    'timeline.zoomIn',
    'timeline.zoomOut',
    'timeline.fit',
    'timeline.snapping',
    '-',
    '#Preview',
    'view.fullscreenPreview',
    'view.safeZones',
    'view.quality.full',
    'view.quality.half',
    'view.quality.quarter',
    '-',
    '#Theme',
    'view.theme.system',
    'view.theme.dark',
    'view.theme.light',
    '-',
    'view.focusNextPane',
    'view.focusPrevPane',
  ],
  Tools: ['tool.select', 'tool.blade'],
  Help: ['help.shortcuts', 'help.customizeShortcuts', 'app.language', '-', 'help.checkForUpdates', 'help.about'],
};

const LAYOUT_IDS = new Set(Object.values(LAYOUT).flat());

/** The menu a command belongs to, or null when it is palette / shortcut only. */
export function menuOf(cmd: Command): MenuName | null {
  if (cmd.menu === false) return null;
  const name = (cmd.menu ?? cmd.group) as MenuName;
  if ((MENU_NAMES as readonly string[]).includes(name)) return name;
  return 'Tools';
}

function itemFor(cmd: Command, inSection: boolean): MenuItem {
  const enabled = !cmd.when || cmd.when();
  const checked = cmd.checked?.();
  const title = inSection && cmd.menuTitle ? cmd.menuTitle : cmd.title;
  return {
    label: t(title),
    icon: cmd.icon,
    shortcut: shortcutText(cmd.id) || undefined,
    disabled: !enabled,
    checked: checked === true ? true : undefined,
    checkable: checked !== undefined,
    run: () => void runCommand(cmd.id),
  };
}

/** Build one menu for the current state (call when it opens). */
export function buildMenu(name: MenuName): MenuItem[] {
  const commands = getCommands();
  const byId = new Map(commands.map((c) => [c.id, c]));
  const items: MenuItem[] = [];
  const pushSep = (): void => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  };

  let section: string | null = null;
  for (const entry of LAYOUT[name]) {
    if (entry === '-') {
      pushSep();
      section = null;
      continue;
    }
    if (entry.startsWith('#')) {
      section = entry.slice(1);
      items.push({ type: 'label', label: t(section) });
      continue;
    }
    const cmd = byId.get(entry);
    if (cmd && menuOf(cmd) === name) items.push(itemFor(cmd, !!section || !!cmd.menuSection));
  }
  // Drop a heading that ended up without items.
  for (let i = items.length - 1; i >= 0; i--) {
    const next = items[i + 1];
    if (items[i].type === 'label' && (!next || next.type === 'separator' || next.type === 'label')) items.splice(i, 1);
  }

  // Everything else registered for this menu, grouped under headings.
  const extra = commands.filter((c) => !LAYOUT_IDS.has(c.id) && menuOf(c) === name);
  const sections = new Map<string, Command[]>();
  for (const cmd of extra) {
    const heading = cmd.menuSection ?? (cmd.group === name ? '' : cmd.group);
    if (!sections.has(heading)) sections.set(heading, []);
    sections.get(heading)!.push(cmd);
  }
  for (const [heading, list] of sections) {
    pushSep();
    if (heading) items.push({ type: 'label', label: t(heading) });
    for (const cmd of list) items.push(itemFor(cmd, !!heading));
  }
  // No leading, trailing or doubled separators.
  return items.filter((it, i) => it.type !== 'separator' || (i > 0 && i < items.length - 1 && items[i - 1].type !== 'separator'));
}

/** Menus that have at least one command (Tools only shows up once something is in it). */
export function visibleMenus(): MenuName[] {
  const commands = getCommands();
  return MENU_NAMES.filter((name) => commands.some((c) => menuOf(c) === name));
}
