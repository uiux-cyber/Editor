/**
 * Inspector section registry. Feature areas add panels to the inspector without editing it:
 * create `ui/inspector/sections/defs/<area>.tsx` default-exporting InspectorSectionDef[].
 *
 * A section appears at the end of its `tab` for clips where `applies(clip)` is true. Built-in
 * tabs are 'edit', 'animate', 'adjust', 'effects' and 'audio'; any other tab id creates a new
 * tab (label from `tabLabel`) shown after the built-in ones.
 */

import type { ComponentType } from 'react';
import type { Clip, ID } from '@/core/types';
import { tMaybe } from '../../i18n';

export interface InspectorSectionProps {
  /** The primary selected clip. */
  clip: Clip;
  /** Every selected clip of the same type (edits should apply to all of them). */
  ids: ID[];
}

export interface InspectorSectionDef {
  id: string;
  tab: string;
  /** Label for a new tab (only used when `tab` is not a built-in tab). Mark it with tk() from ui/i18n; it is shown with tMaybe(). */
  tabLabel?: string;
  /** Lower comes first (default 100). */
  order?: number;
  /** 'top': shown before the tab's built-in controls (e.g. a Motion clip's settings). Default: after them. */
  placement?: 'top' | 'end';
  applies: (clip: Clip) => boolean;
  Component: ComponentType<InspectorSectionProps>;
}

const modules = import.meta.glob<{ default: InspectorSectionDef[] }>('./defs/*.tsx', { eager: true });

export const INSPECTOR_SECTIONS: InspectorSectionDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default ?? [])
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

export const BUILTIN_TABS = ['edit', 'animate', 'adjust', 'effects', 'audio'];

export function sectionsFor(clip: Clip, tab: string, placement: 'top' | 'end' = 'end'): InspectorSectionDef[] {
  return INSPECTOR_SECTIONS.filter((s) => s.tab === tab && (s.placement ?? 'end') === placement && s.applies(clip));
}

/** Extra (non built-in) tabs that have at least one section for this clip, with translated labels (call while rendering). */
export function extraTabsFor(clip: Clip): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const s of INSPECTOR_SECTIONS) {
    if (BUILTIN_TABS.includes(s.tab) || !s.applies(clip) || out.some((t) => t.id === s.tab)) continue;
    out.push({ id: s.tab, label: s.tabLabel ? tMaybe(s.tabLabel) : s.tab.charAt(0).toUpperCase() + s.tab.slice(1) });
  }
  return out;
}
