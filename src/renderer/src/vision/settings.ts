/** Persisted vision preferences (see ui/settings/defs/vision.tsx). */

import { api, hasBridge } from '@/platform/api';
import { resetVision, setVisionGpu } from './client';
import { clearMaskCache, setMaskCacheLimit } from './cutout';

export const VISION_SETTINGS = { gpu: 'vision.gpu', cacheMb: 'vision.maskCacheMb' } as const;

let gpuApplied: boolean | null = null;

/** Read the saved preferences and apply them (restarting the runtime if the delegate changed). */
export async function applyVisionSettings(): Promise<void> {
  if (!hasBridge) return;
  try {
    const gpu = (await api.settings.get<boolean>(VISION_SETTINGS.gpu)) ?? true;
    const mb = (await api.settings.get<number>(VISION_SETTINGS.cacheMb)) ?? 192;
    setMaskCacheLimit(mb);
    if (gpuApplied !== null && gpuApplied !== gpu) {
      // Masks from the other delegate may differ slightly: start fresh so exports stay consistent.
      resetVision();
      clearMaskCache();
    }
    gpuApplied = gpu;
    setVisionGpu(gpu);
  } catch {
    /* defaults stay in effect */
  }
}
