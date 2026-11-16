/** Remembered export dialog choices (per user, not per project). */

import type { SubtitleFormat } from '@/engine/export/exporter';
import type { CustomSettings } from '@/engine/export/targets';
import { api } from '@/platform/api';

export interface ExportPrefs {
  selected?: string[];
  custom?: Partial<Omit<CustomSettings, 'fps'>>;
  audio?: boolean;
  burnInCaptions?: boolean;
  sidecars?: SubtitleFormat[];
  embedSubtitles?: boolean;
}

const KEY = 'export.prefs';
let cache: ExportPrefs = {};
let loaded: Promise<void> | null = null;

export function loadExportPrefs(): Promise<void> {
  loaded ??= api.settings
    .get<ExportPrefs>(KEY)
    .then((p) => {
      if (p && typeof p === 'object') cache = p;
    })
    .catch(() => undefined);
  return loaded;
}

export const getExportPrefs = (): ExportPrefs => cache;

export function saveExportPrefs(p: ExportPrefs): void {
  cache = p;
  void api.settings.set(KEY, p);
}
