/**
 * "Smart" tools shown in the library's Smart tab (auto captions, silence removal, background
 * removal, …). Feature areas add tools in `ui/tools/defs/<area>.tsx`, default-exporting ToolDef[].
 */

import type { ComponentType, ReactNode } from 'react';

export interface ToolDef {
  id: string;
  title: string;
  /** One line shown on the card. */
  description: string;
  /** Section heading, e.g. 'Speech', 'Vision', 'Audio', 'Colour', 'Edit'. */
  group: string;
  icon: ReactNode;
  keywords?: string[];
  /** Body shown when the card is expanded (options + a primary action button). */
  Panel: ComponentType<{ close: () => void }>;
}

const modules = import.meta.glob<{ default: ToolDef[] }>('./defs/*.tsx', { eager: true });

export const TOOLS: ToolDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default ?? []);

/** Fixed order for the groups that exist; unknown groups follow alphabetically. */
const GROUP_ORDER = ['Speech', 'Audio', 'Vision', 'Edit', 'Colour'];

export function toolGroups(list: ToolDef[] = TOOLS): { group: string; tools: ToolDef[] }[] {
  const groups = [...new Set(list.map((t) => t.group))];
  groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  return groups.map((group) => ({ group, tools: list.filter((t) => t.group === group) }));
}
