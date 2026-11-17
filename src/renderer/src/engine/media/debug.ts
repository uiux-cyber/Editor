/**
 * Debug / automated-test handle for the performance & media features: `window.__kinoraMedia`.
 * (The core handle `window.__kinora` is owned by main.tsx; this one is separate so the media
 * area does not need to edit it.)
 */

import * as mb from 'mediabunny';
import { makeSyntheticHdrVideo } from './hdrTestFile';

const handle: Record<string, unknown> = {
  mb,
  makeSyntheticHdrVideo,
};

/** Add entries to the debug handle (called by the media modules as they load). */
export function exposeDebug(entries: Record<string, unknown>): void {
  Object.assign(handle, entries);
}

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__kinoraMedia = handle;
