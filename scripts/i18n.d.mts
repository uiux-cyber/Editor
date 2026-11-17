/** Types for scripts/i18n.mjs (used by tests/workflow.test.ts). */
export declare const SRC: string;
export declare const LOCALES_DIR: string;
export declare const TRANSLATED: string[];
export declare const EXTRA_KEYS: string[];
export declare function extractFile(file: string): Set<string>;
export declare function extractKeys(): Set<string>;
export declare function loadLocale(code: string): Record<string, string>;
export declare function localeCodes(): string[];
