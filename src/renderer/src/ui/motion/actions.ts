/**
 * Motion clips in the editor: reading a clip's settings, changing them (one undo step each),
 * giving a clip its own copy, applying the brand kit, and adding ready-made clips from the
 * Motion library.
 *
 * A Motion clip's chosen settings live on its media asset (MediaAsset.motionValues), so every
 * timeline clip that uses the asset shows the same values; "Make unique" gives one clip its own.
 */

import { useEffect, useState } from 'react';
import { uid } from '@/core/factory';
import type { Clip, ID, MediaAsset } from '@/core/types';
import { importMediaFiles, prepareAddedAsset, refreshAnimationPoster } from '@/engine/media/assets';
import { api } from '@/platform/api';
import { getRootProject, updateProject, useProjectStore } from '@/store/project';
import { toast } from '@/store/ui';
import {
  changedMotionValues,
  motionFontFamily,
  normalizeMotionMeta,
  parseMotionFile,
  serializeMotionFile,
  type MotionMeta,
  type MotionParam,
  type MotionValue,
} from '@shared/motion';
import type { FileInfo } from '@shared/ipc';
import { getMotionPreset } from '@/library/motionPresets';
import { MOTION_BRAND_ID, resolveVariation, themeValues, type MotionVariation } from '@/library/motionVariations';
import { brandTheme, motionBrand, motionLibrary } from './library';
import { addAsset, editClips, type Placement } from '../actions';
import { t } from '../i18n';
import { currentLogo, logoAsset, useTemplates } from '../templates/store';

export interface MotionFile {
  meta: MotionMeta;
  code: string;
}

// ---- reading clips ------------------------------------------------------------------------------

const files = new Map<string, Promise<MotionFile | null>>();

/** The header and code of a .kmotion file (cached: files are never changed in place). */
export function readMotionFile(path: string): Promise<MotionFile | null> {
  let hit = files.get(path);
  if (!hit) {
    hit = (async () => {
      try {
        const res = await fetch(api.media.toUrl(path));
        if (!res.ok) return null;
        const parsed = parseMotionFile(await res.text());
        const s = getRootProject().settings;
        return { meta: normalizeMotionMeta(parsed.meta, { width: s.width, height: s.height, fps: s.fps }), code: parsed.code };
      } catch {
        return null;
      }
    })();
    files.set(path, hit);
  }
  return hit;
}

/** Hook: the clip file of a Motion asset (undefined while loading, null when unreadable). */
export function useMotionFile(asset: MediaAsset | undefined): MotionFile | null | undefined {
  const path = asset?.format === 'motion' && asset.source.type === 'file' ? asset.source.path : null;
  const [state, setState] = useState<{ path: string | null; file: MotionFile | null | undefined }>({ path: null, file: undefined });
  useEffect(() => {
    if (!path) return;
    let live = true;
    void readMotionFile(path).then((file) => live && setState({ path, file }));
    return () => {
      live = false;
    };
  }, [path]);
  return path && state.path === path ? state.file : path ? undefined : null;
}

/** The Motion asset a timeline clip shows, if any. */
export function motionAssetOf(clip: Clip, assets: Record<ID, MediaAsset>): MediaAsset | undefined {
  if (clip.type !== 'image') return undefined;
  const a = assets[clip.assetId];
  return a?.format === 'motion' ? a : undefined;
}

/** How many clips (in every sequence) show this asset. */
export function clipsUsingAsset(assetId: ID): number {
  const root = getRootProject() as unknown as { clips: Record<ID, Clip>; sequences?: Record<ID, { clips: Record<ID, Clip> }> };
  let n = 0;
  const count = (clips: Record<ID, Clip>): void => {
    for (const c of Object.values(clips)) if ((c.type === 'image' || c.type === 'video') && c.assetId === assetId) n++;
  };
  count(root.clips);
  for (const seq of Object.values(root.sequences ?? {})) count(seq.clips);
  return n;
}

// ---- changing settings -------------------------------------------------------------------------

let posterTimer: ReturnType<typeof setTimeout> | null = null;
function refreshPosterSoon(assetId: ID): void {
  if (posterTimer) clearTimeout(posterTimer);
  posterTimer = setTimeout(() => {
    const a = getRootProject().assets[assetId];
    if (a) void refreshAnimationPoster(a);
  }, 900);
}

/** Change settings of a Motion asset. `coalesce` merges a stream of edits (typing, dragging) into one undo step. */
export function setMotionValues(assetId: ID, params: MotionParam[], patch: Record<string, MotionValue>, coalesce?: string): void {
  updateProject(
    (d) => {
      const a = d.assets[assetId];
      if (!a) return;
      const next = changedMotionValues(params, { ...a.motionValues, ...patch });
      if (Object.keys(next).length) a.motionValues = next;
      else delete a.motionValues;
    },
    { label: 'Change Motion clip settings', ...(coalesce ? { coalesce: `motion-${assetId}-${coalesce}` } : {}) },
  );
  refreshPosterSoon(assetId);
}

/** Back to the values written in the clip. */
export function resetMotionValues(assetId: ID): void {
  updateProject(
    (d) => {
      const a = d.assets[assetId];
      if (a) delete a.motionValues;
    },
    { label: 'Reset Motion clip settings' },
  );
  refreshPosterSoon(assetId);
}

/** Give one timeline clip its own copy of a Motion asset, so its settings can differ. */
export function makeMotionUnique(clipId: ID): ID | null {
  const root = getRootProject();
  let copy: MediaAsset | null = null;
  updateProject(
    (d) => {
      const c = d.clips[clipId];
      if (!c || c.type !== 'image') return;
      const a = d.assets[c.assetId] ?? root.assets[c.assetId];
      if (!a) return;
      copy = { ...a, id: uid('as_'), name: t('{name} (copy)', { name: a.name }), addedAt: Date.now(), ...(a.motionValues ? { motionValues: { ...a.motionValues } } : {}) };
      d.assets[copy.id] = copy;
      c.assetId = copy.id;
    },
    { label: 'Make Motion clip unique' },
  );
  if (!copy) return null;
  void prepareAddedAsset(copy);
  return (copy as MediaAsset).id;
}

// ---- brand kit ---------------------------------------------------------------------------------

/** A bundled Motion typeface for a brand font family (installed PC fonts cannot be used in clips). */
export const motionFontFor = motionFontFamily;

/** True once the user saved a brand kit. */
export const hasBrand = (): boolean => useTemplates.getState().brandSet;

/**
 * Values the brand kit gives settings linked to it (`brand` role). A logo is added to the project
 * (as its brand-logo asset) so the clip can use it.
 */
export function brandValues(params: MotionParam[]): { values: Record<string, MotionValue>; logo: MediaAsset | null } {
  const { brand } = useTemplates.getState();
  const values = themeValues(params, brandTheme(), motionFontFamily);
  let logo: MediaAsset | null = null;
  for (const p of params) {
    if (p.brand !== 'logo' || p.type !== 'image') continue;
    const l = currentLogo(brand);
    if (l) {
      logo = logoAsset(l);
      values[p.id] = logo.id;
    }
  }
  return { values, logo };
}

/** Make sure a brand logo asset is part of the project. */
function ensureLogoAsset(logo: MediaAsset | null): void {
  if (!logo || getRootProject().assets[logo.id]) return;
  updateProject((d) => void (d.assets[logo.id] = logo), { history: false });
  void prepareAddedAsset(logo);
}

/** Apply the brand kit to a Motion asset's settings (one undo step). Returns how many changed. */
export function applyBrandToMotion(assetId: ID, params: MotionParam[]): number {
  const { values, logo } = brandValues(params);
  const n = Object.keys(values).length;
  if (!n) return 0;
  ensureLogoAsset(logo);
  setMotionValues(assetId, params, values);
  return n;
}

// ---- adding ready-made clips ---------------------------------------------------------------------

/** Library ▸ Motion, by id (drag and drop): with the brand kit when "Use my brand" is on. */
export function addMotionPresetById(id: string, where?: Placement): Promise<ID[]> {
  const preset = getMotionPreset(id);
  if (!preset) return Promise.resolve([]);
  const { useBrand, brandSet } = useTemplates.getState();
  return addMotionPreset(preset, { brand: useBrand && brandSet, where });
}

/** Library ▸ Motion: add the version of a design shown in the gallery (its colours, fonts, look and words). */
export function addMotionVariation(v: MotionVariation, where?: Placement): Promise<ID[]> {
  const brand = v.paletteId === MOTION_BRAND_ID ? motionBrand() : null;
  const r = resolveVariation(motionLibrary(), v, brand);
  if (!r) return Promise.resolve([]);
  return addMotionPreset(r.preset, { values: r.values, seed: r.seed, brand: !!brand, where });
}

export interface MotionPresetLike {
  name: string;
  duration: number;
  params?: MotionParam[];
  code: string;
}

/**
 * Add a ready-made Motion clip: written to Documents\Kinora\Motion, imported, placed on the
 * timeline (one loop long). With `brand`, settings linked to the brand kit start with its values.
 */
export async function addMotionPreset(
  preset: MotionPresetLike,
  opts: { brand?: boolean; where?: Placement; values?: Record<string, MotionValue>; seed?: number } = {},
): Promise<ID[]> {
  const s = getRootProject().settings;
  const base = normalizeMotionMeta(
    { name: preset.name, duration: preset.duration, width: s.width, height: s.height, fps: s.fps, seed: opts.seed ?? 1, params: preset.params },
    { width: s.width, height: s.height, fps: s.fps, name: preset.name },
  );
  // The version the user picked becomes the clip's defaults (Reset returns to it).
  const chosen: Record<string, MotionValue> = { ...(opts.values ?? {}) };
  if (opts.brand && hasBrand() && base.params?.length) {
    const { values, logo } = brandValues(base.params);
    ensureLogoAsset(logo);
    Object.assign(chosen, values);
  }
  const meta = { ...base, params: base.params?.map((p) => (p.id in chosen ? { ...p, default: chosen[p.id] } : p)) };
  let file: FileInfo;
  try {
    file = await api.call<FileInfo>('x:motion:save', meta.name, serializeMotionFile(meta, preset.code));
  } catch (err) {
    toast('error', t('Could not add “{name}”', { name: preset.name }), err instanceof Error ? err.message : String(err));
    return [];
  }
  const result = await importMediaFiles([file]);
  const asset = result.assets[0];
  if (!asset) {
    toast('error', t('Could not add “{name}”', { name: preset.name }), result.failures[0]?.reason);
    return [];
  }
  const store = useProjectStore.getState();
  store.begin('Add Motion clip');
  let ids: ID[] = [];
  try {
    ids = addAsset(asset, opts.where ?? {});
    if (ids.length) editClips(ids, (c) => void (c.duration = meta.duration));
  } finally {
    useProjectStore.getState().commit('Add Motion clip');
  }
  return ids;
}
