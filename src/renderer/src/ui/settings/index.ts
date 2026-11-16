/**
 * Settings sections. The Settings window lists every registered section; feature areas add
 * theirs in `ui/settings/defs/<area>.tsx`, default-exporting SettingsSectionDef[].
 * Persist values with `window.kinora.settings.get/set` (namespaced keys, e.g. `proxies.enabled`).
 */

import type { ComponentType, ReactNode } from 'react';

export interface SettingsSectionDef {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Lower comes first (default 100). */
  order?: number;
  Component: ComponentType;
}

const modules = import.meta.glob<{ default: SettingsSectionDef[] }>('./defs/*.tsx', { eager: true });

export const SETTINGS_SECTIONS: SettingsSectionDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default ?? [])
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
