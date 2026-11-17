/**
 * LUT library and loader. Built-in looks are generated in the renderer; imported `.cube` files
 * live in the app's userData folder and are managed by the main-process handler
 * (src/main/handlers/luts.ts, channels `x:luts:*`).
 *
 * `getLutData(id)` is synchronous for the render path: it returns the parsed table when it is
 * ready and otherwise starts loading it and returns null (the layer is drawn without the LUT and
 * repainted once the table arrives). `ensureLuts` lets the exporter wait for every LUT first.
 */

import { create } from 'zustand';
import { parseCube, type CubeKind, type CubeLut } from '@shared/cube';
import { BUILTIN_LUTS, generateBuiltinLut, getBuiltinLutDef, isBuiltinLut } from '@/core/color/builtinLuts';
import type { Clip, Project } from '@/core/types';
import { notifyLayerExtChanged } from '../gl/layerExt';

export interface LutInfo {
  id: string;
  name: string;
  kind: CubeKind;
  size: number;
  builtin: boolean;
  description?: string;
  addedAt?: number;
}

export interface LutImportResult {
  imported: LutInfo[];
  failures: { name: string; error: string }[];
}

export type LutStatus = 'ready' | 'loading' | 'missing' | 'error';

const MAX_1D_TEXELS = 4096;

const tables = new Map<string, CubeLut>();
const status = new Map<string, LutStatus>();
const pending = new Map<string, Promise<CubeLut | null>>();
/** Bumped when a LUT's data changes (re-import / delete) so GPU caches rebuild. */
const versions = new Map<string, number>();

interface LibraryState {
  user: LutInfo[];
  loaded: boolean;
  /** Bumped whenever a table finishes loading (UI thumbnails re-render). */
  revision: number;
}

export const useLutLibrary = create<LibraryState>()(() => ({ user: [], loaded: false, revision: 0 }));

const bridge = (): { call<T>(channel: string, ...args: unknown[]): Promise<T> } | null =>
  typeof window !== 'undefined' && (window as unknown as { kinora?: { call?: unknown } }).kinora?.call ? (window as unknown as { kinora: { call<T>(c: string, ...a: unknown[]): Promise<T> } }).kinora : null;

export const BUILTIN_LUT_INFOS: LutInfo[] = BUILTIN_LUTS.map((d) => ({ id: d.id, name: d.name, kind: '3d', size: 33, builtin: true, description: d.description }));

/** Every LUT in the library: built-ins first, then imported ones (newest last). */
export function allLuts(): LutInfo[] {
  return [...BUILTIN_LUT_INFOS, ...useLutLibrary.getState().user];
}

export function lutInfo(id: string): LutInfo | undefined {
  return isBuiltinLut(id) ? BUILTIN_LUT_INFOS.find((l) => l.id === id) : useLutLibrary.getState().user.find((l) => l.id === id);
}

export function lutVersion(id: string): number {
  return versions.get(id) ?? 0;
}

export function lutStatus(id: string): LutStatus {
  if (tables.has(id)) return 'ready';
  return status.get(id) ?? 'loading';
}

/** Resample a large 1D table so it fits comfortably in one texture row. */
function fit1d(lut: CubeLut): CubeLut {
  if (lut.kind !== '1d' || lut.size <= MAX_1D_TEXELS) return lut;
  const n = MAX_1D_TEXELS;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (lut.size - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(lut.size - 1, i0 + 1);
    const f = x - i0;
    for (let c = 0; c < 3; c++) data[i * 3 + c] = lut.data[i0 * 3 + c] * (1 - f) + lut.data[i1 * 3 + c] * f;
  }
  return { ...lut, size: n, data };
}

function loaded(id: string, lut: CubeLut | null, st: LutStatus): CubeLut | null {
  pending.delete(id);
  if (lut) {
    tables.set(id, fit1d(lut));
    status.set(id, 'ready');
  } else {
    tables.delete(id);
    status.set(id, st);
  }
  useLutLibrary.setState((s) => ({ revision: s.revision + 1 }));
  notifyLayerExtChanged();
  return lut ? tables.get(id)! : null;
}

/** Load (once) and return a LUT table; null when it does not exist or cannot be read. */
export function loadLut(id: string): Promise<CubeLut | null> {
  const ready = tables.get(id);
  if (ready) return Promise.resolve(ready);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  if (status.get(id) === 'missing' || status.get(id) === 'error') return Promise.resolve(null);
  status.set(id, 'loading');
  const p = (async (): Promise<CubeLut | null> => {
    if (isBuiltinLut(id)) {
      // Yield so a burst of requests does not block the frame that triggered them.
      await Promise.resolve();
      const lut = generateBuiltinLut(id);
      return loaded(id, lut, lut ? 'ready' : 'missing');
    }
    const api = bridge();
    if (!api) return loaded(id, null, 'missing');
    try {
      const text = await api.call<string | null>('x:luts:read', id);
      if (typeof text !== 'string') return loaded(id, null, 'missing');
      return loaded(id, parseCube(text), 'ready');
    } catch (err) {
      console.warn(`[lut] could not load ${id}`, err);
      return loaded(id, null, 'error');
    }
  })();
  pending.set(id, p);
  return p;
}

/** Synchronous access for rendering; starts loading when the table is not ready yet. */
export function getLutData(id: string): CubeLut | null {
  const t = tables.get(id);
  if (t) return t;
  const st = status.get(id);
  if (st !== 'missing' && st !== 'error' && !pending.has(id)) void loadLut(id);
  return null;
}

/** LUT ids referenced anywhere in a project (including nested sequences). */
export function lutIdsInProject(project: Project): string[] {
  const ids = new Set<string>();
  const visit = (clips: Record<string, Clip>): void => {
    for (const c of Object.values(clips)) {
      if (c.type === 'audio') continue;
      if (c.lut?.id) ids.add(c.lut.id);
      if (c.type === 'compound' && c.sequence?.clips) visit(c.sequence.clips);
    }
  };
  visit(project.clips);
  return [...ids];
}

export async function ensureLuts(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => loadLut(id)));
}

// ---------------------------------------------------------------------------------------------
// Library management (imported LUTs)
// ---------------------------------------------------------------------------------------------

export async function refreshLutLibrary(): Promise<LutInfo[]> {
  const api = bridge();
  if (!api) return [];
  const list = await api.call<LutInfo[]>('x:luts:list');
  const user = (Array.isArray(list) ? list : []).map((l) => ({ ...l, builtin: false }));
  // A LUT that reappears (e.g. re-imported with the same id) may be loaded again.
  for (const l of user) if (status.get(l.id) === 'missing') status.delete(l.id);
  useLutLibrary.setState({ user, loaded: true });
  return user;
}

/** Show the open dialog and import the chosen .cube files into the library. */
export async function importLutFiles(): Promise<LutImportResult> {
  const api = bridge();
  if (!api) return { imported: [], failures: [] };
  const res = await api.call<LutImportResult>('x:luts:import');
  await refreshLutLibrary();
  for (const l of res.imported) {
    status.delete(l.id);
    tables.delete(l.id);
    versions.set(l.id, lutVersion(l.id) + 1);
  }
  return res;
}

export async function renameLut(id: string, name: string): Promise<void> {
  const api = bridge();
  if (!api || isBuiltinLut(id)) return;
  await api.call('x:luts:rename', id, name);
  await refreshLutLibrary();
}

export async function deleteLut(id: string): Promise<void> {
  const api = bridge();
  if (!api || isBuiltinLut(id)) return;
  await api.call('x:luts:delete', id);
  tables.delete(id);
  status.set(id, 'missing');
  versions.set(id, lutVersion(id) + 1);
  await refreshLutLibrary();
  useLutLibrary.setState((s) => ({ revision: s.revision + 1 }));
  notifyLayerExtChanged();
}

export function lutDisplayName(id: string): string {
  return lutInfo(id)?.name ?? getBuiltinLutDef(id)?.name ?? 'Missing LUT';
}
