/**
 * Settings sections. The Settings window lists every registered section; feature areas add
 * theirs in `ui/settings/defs/<area>.tsx`, default-exporting SettingsSectionDef[].
 * Persist values with `useSetting(key, fallback)` from `ui/settings/store` (or
 * `window.kinora.settings.get/set`) using namespaced keys, e.g. `proxies.enabled`. Build the page
 * from the pieces in `ui/settings/kit` (SettingsGroup, SettingRow…) so every section looks alike.
 * Titles are English source strings; the window translates them with `t()`.
 */

import type { ComponentType, ReactNode } from 'react';

export interface SettingsSectionDef {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Lower comes first (default 100). The built-in sections use 10–40. */
  order?: number;
  /** One line under the title. */
  description?: string;
  /** Extra terms for the settings search (option names inside the section). */
  keywords?: string[];
  Component: ComponentType;
}

const modules = import.meta.glob<{ default: SettingsSectionDef[] }>('./defs/*.tsx', { eager: true });

export const SETTINGS_SECTIONS: SettingsSectionDef[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default ?? [])
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
