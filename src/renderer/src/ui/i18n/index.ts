/**
 * Translations. English source strings live in the code and are the lookup keys:
 *
 *   const t = useT();            // in components (re-renders when the language changes)
 *   t('Open project…')
 *   t('{count, plural, one {# file} other {# files}}', { count })
 *   t('Edit', undefined, 'menu') // optional context for words that translate differently
 *
 * Outside React use the global `t` (menus, toasts, dialogs are built at the moment they are
 * shown, so they always use the current language). Locale files are JSON maps in `./locales/`
 * from source string (or `context|source string`) to translation; a missing entry falls back to
 * English. See docs/I18N.md.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { formatBytes, formatMessage, formatRelativeTime, numberFormat, dateFormat, type MessageVars } from './format';

export interface LanguageInfo {
  /** BCP 47 tag used for Intl formatting. */
  code: string;
  /** Name in the language itself. */
  native: string;
  /** English name. */
  english: string;
}

/** English is the source language; the others have a JSON file in ./locales. */
export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
];

type Dictionary = Record<string, string>;

const modules = import.meta.glob<{ default: Dictionary }>('./locales/*.json', { eager: true });
const DICTIONARIES = new Map<string, Dictionary>();
for (const [file, mod] of Object.entries(modules)) {
  const code = file.replace(/^.*\/([^/]+)\.json$/, '$1');
  DICTIONARIES.set(code, mod.default ?? (mod as unknown as Dictionary));
}

/** 'system' follows the OS / Chromium UI language. */
export type LanguageSetting = 'system' | string;

/** Best supported language for a list of preferred BCP 47 tags. */
export function matchLanguage(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === lower);
    if (exact) return exact.code;
    const base = lower.split('-')[0];
    // Any Portuguese → Brazilian Portuguese (the only Portuguese translation).
    const sameBase = LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base);
    if (sameBase) return sameBase.code;
  }
  return 'en';
}

export function systemLanguage(): string {
  const prefs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language].filter(Boolean) : [];
  return matchLanguage(prefs);
}

interface I18nState {
  setting: LanguageSetting;
  locale: string;
}

const STORAGE_KEY = 'kinora.language';
const SETTINGS_KEY = 'language.code';

function readCached(): LanguageSetting {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'system';
  } catch {
    return 'system';
  }
}

const resolve = (setting: LanguageSetting): string => (setting === 'system' ? systemLanguage() : LANGUAGES.some((l) => l.code === setting) ? setting : 'en');

const initialSetting = readCached();
export const useI18n = create<I18nState>()(() => ({ setting: initialSetting, locale: resolve(initialSetting) }));

const missing = new Map<string, Set<string>>();

/** Translate an English source string. */
export function t(source: string, vars?: MessageVars, context?: string): string {
  const { locale } = useI18n.getState();
  let message = source;
  if (locale !== 'en') {
    const dict = DICTIONARIES.get(locale);
    const hit = (context ? dict?.[`${context}|${source}`] : undefined) ?? dict?.[source];
    if (hit !== undefined && hit !== '') message = hit;
    else if (dict) {
      let set = missing.get(locale);
      if (!set) missing.set(locale, (set = new Set()));
      set.add(context ? `${context}|${source}` : source);
    }
  }
  return formatMessage(message, vars, locale);
}

/** Translate a string that is not known at build time only if a translation exists (e.g. group names from feature modules). */
export function tMaybe(source: string, context?: string): string {
  return t(source, undefined, context);
}

/** Current locale (BCP 47). */
export const currentLocale = (): string => useI18n.getState().locale;

/** Hook: the translate function; the component re-renders when the language changes. */
export function useT(): typeof t {
  useI18n((s) => s.locale);
  return t;
}

export function useLocale(): string {
  return useI18n((s) => s.locale);
}

function apply(setting: LanguageSetting): void {
  const locale = resolve(setting);
  useI18n.setState({ setting, locale });
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    /* storage unavailable */
  }
}

/** Change the interface language now and remember it. */
export function setLanguage(setting: LanguageSetting): void {
  apply(setting);
  void window.kinora?.settings.set(SETTINGS_KEY, setting);
}

/** Load the saved language (call once at startup). */
export async function initI18n(): Promise<void> {
  if (typeof document !== 'undefined') document.documentElement.lang = useI18n.getState().locale;
  try {
    const saved = await window.kinora?.settings.get<string>(SETTINGS_KEY);
    if (typeof saved === 'string' && saved !== useI18n.getState().setting) apply(saved);
  } catch {
    /* keep the cached choice */
  }
  window.addEventListener('languagechange', () => {
    if (useI18n.getState().setting === 'system') apply('system');
  });
}

/** Strings looked up in the current session that have no translation (debugging aid). */
export function missingTranslations(locale = currentLocale()): string[] {
  return [...(missing.get(locale) ?? [])].sort();
}

export function hasTranslation(locale: string, source: string, context?: string): boolean {
  const dict = DICTIONARIES.get(locale);
  return !!dict && !!((context && dict[`${context}|${source}`]) || dict[source]);
}

export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions): string => numberFormat(currentLocale(), opts).format(n);
export const formatDate = (d: Date | number, opts?: Intl.DateTimeFormatOptions): string => dateFormat(currentLocale(), opts ?? { dateStyle: 'medium' }).format(d);
export const formatRelative = (ts: number): string => formatRelativeTime(ts, currentLocale());
export const formatSize = (bytes: number): string => formatBytes(bytes, currentLocale());

/** Re-render on language change and return the locale (for components that format dates live). */
export function useLanguageTick(): string {
  const locale = useLocale();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return locale;
}
