/**
 * Proxy manager: a background queue that creates lightweight editing copies of heavy video
 * (one at a time, in a worker), streams them through the main process into userData/proxies,
 * records them on the asset (`asset.proxy`, persisted with the project) and re-creates proxies
 * whose files went missing. The preview uses them when "Use proxies" is on; export never does.
 */

import { create } from 'zustand';
import type { ID, MediaAsset, Project } from '@/core/types';
import { api } from '@/platform/api';
import { getProject, updateProject, useProjectStore } from '@/store/project';
import { toast } from '@/store/ui';
import { sharedInput, useAssetRuntime } from './assets';
import { hdrPassthrough } from './hdr';
import { mediaPrefs, useMediaPrefs } from './prefs';
import { ProxyCanceled, runProxyConversion, type ProxyRun, type ProxySpec } from './proxyConvert';
import { proxyBitrate, proxyDimensions, proxyEligibility, proxyFileName, type Eligibility } from './proxyRules';

export type ProxyJobState = 'queued' | 'running' | 'error';

export interface ProxyJob {
  assetId: ID;
  state: ProxyJobState;
  /** 0..1 */
  progress: number;
  error?: string;
  /** Why the proxy is being made (shown in tooltips). */
  reason: string;
}

interface JobsState {
  jobs: Record<ID, ProxyJob>;
}

export const useProxyJobs = create<JobsState>()(() => ({ jobs: {} }));

const patchJob = (id: ID, patch: Partial<ProxyJob> | null): void =>
  useProxyJobs.setState((s) => {
    const jobs = { ...s.jobs };
    if (patch === null) delete jobs[id];
    else jobs[id] = { ...(jobs[id] ?? { assetId: id, state: 'queued', progress: 0, reason: '' }), ...patch };
    return { jobs };
  });

const queue: ID[] = [];
let active: { id: ID; cancel: () => void } | null = null;

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

const codecStrings = new Map<ID, string | null>();

/** RFC 6381 codec string of an asset's video track (cached; needed for the 10-bit HEVC rule). */
async function codecString(asset: MediaAsset): Promise<string | null> {
  if (codecStrings.has(asset.id)) return codecStrings.get(asset.id)!;
  let s: string | null = null;
  try {
    const track = await sharedInput(asset).getPrimaryVideoTrack();
    s = track ? await track.getCodecParameterString() : null;
  } catch {
    s = null;
  }
  codecStrings.set(asset.id, s);
  return s;
}

export async function eligibility(asset: MediaAsset): Promise<Eligibility> {
  const p = mediaPrefs();
  return proxyEligibility(asset, { minShortSide: p.proxyMinShortSide, minMbps: p.proxyMinMbps, hevc10: p.proxyHevc10 }, asset.videoCodec === 'hevc' ? await codecString(asset) : null);
}

/** Queue proxies for newly imported heavy media (when automatic creation is on). */
export async function autoProxy(assets: MediaAsset[]): Promise<void> {
  if (!mediaPrefs().proxyAuto) return;
  for (const asset of assets) {
    if (asset.proxy || asset.kind !== 'video') continue;
    const e = await eligibility(asset);
    if (e.eligible) requestProxy(asset.id, { reason: e.reasons.join(' · ') });
  }
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

/** Queue a proxy for an asset (no-op when one exists or is in progress, unless `force`). */
export function requestProxy(assetId: ID, opts: { force?: boolean; reason?: string } = {}): boolean {
  const asset = getProject().assets[assetId];
  if (!asset || asset.kind !== 'video' || asset.source.type !== 'file') return false;
  const job = useProxyJobs.getState().jobs[assetId];
  if (job && job.state !== 'error') return false;
  if (!opts.force && asset.proxy && useAssetRuntime.getState().items[assetId]?.proxyUrl) return false;
  patchJob(assetId, { state: 'queued', progress: 0, error: undefined, reason: opts.reason ?? 'Requested' });
  if (!queue.includes(assetId)) queue.push(assetId);
  pump();
  return true;
}

export function cancelProxy(assetId: ID): void {
  const i = queue.indexOf(assetId);
  if (i >= 0) queue.splice(i, 1);
  if (active?.id === assetId) active.cancel();
  else patchJob(assetId, null);
}

export function cancelAllProxies(): void {
  for (const id of [...queue]) cancelProxy(id);
  if (active) active.cancel();
}

/** Delete an asset's proxy file and forget it. */
export async function deleteProxy(assetId: ID): Promise<void> {
  cancelProxy(assetId);
  const asset = getProject().assets[assetId];
  if (!asset?.proxy) return;
  const name = asset.proxy.path.split(/[\\/]/).pop()!;
  known.delete(assetId);
  useAssetRuntime.getState().patch(assetId, { proxyUrl: null });
  updateProject((p) => void (p.assets[assetId] && delete p.assets[assetId].proxy), { history: false });
  await api.call('x:media:remove', 'proxies', [name]).catch(() => undefined);
}

function pump(): void {
  if (active || queue.length === 0) return;
  const id = queue.shift()!;
  const asset = getProject().assets[id];
  if (!asset || asset.source.type !== 'file' || useAssetRuntime.getState().items[id]?.status === 'missing') {
    patchJob(id, null);
    pump();
    return;
  }
  void runJob(asset).finally(() => {
    active = null;
    pump();
  });
}

/** Start a conversion in a worker; resolves to null if workers are unavailable. */
function startInWorker(spec: ProxySpec, write: (pos: number, data: Uint8Array) => Promise<void>, progress: (r: number) => void): Promise<ProxyRun | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./proxyWorker.ts', import.meta.url), { type: 'module', name: 'kinora-proxy' });
    } catch {
      resolve(null);
      return;
    }
    let settle: { ok: () => void; ko: (e: Error) => void } | null = null;
    const promise = new Promise<void>((ok, ko) => (settle = { ok, ko }));
    const finish = (err?: Error): void => {
      worker.terminate();
      if (err) settle!.ko(err);
      else settle!.ok();
    };
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) {
        worker.terminate();
        resolve(null);
      }
    }, 5000);
    worker.onerror = (e) => {
      if (!ready) {
        clearTimeout(timer);
        resolve(null);
      } else finish(new Error(e.message || 'Proxy worker failed'));
    };
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id?: number; position?: number; data?: Uint8Array; ratio?: number; message?: string };
      if (msg.type === 'ready') {
        ready = true;
        clearTimeout(timer);
        worker.postMessage({ type: 'start', spec });
        resolve({ promise, cancel: () => worker.postMessage({ type: 'cancel' }) });
      } else if (msg.type === 'write') {
        write(msg.position!, msg.data!).then(
          () => worker.postMessage({ type: 'ack', id: msg.id }),
          (err: Error) => worker.postMessage({ type: 'ack', id: msg.id, error: err.message }),
        );
      } else if (msg.type === 'progress') progress(msg.ratio ?? 0);
      else if (msg.type === 'done') finish();
      else if (msg.type === 'canceled') finish(new ProxyCanceled());
      else if (msg.type === 'error') finish(new Error(msg.message ?? 'Proxy creation failed'));
    };
  });
}

async function runJob(asset: MediaAsset): Promise<void> {
  const id = asset.id;
  const size = mediaPrefs().proxySize;
  const dims = proxyDimensions(asset.width, asset.height, size);
  const name = proxyFileName(asset, size);
  const spec: ProxySpec = {
    url: api.media.toUrl((asset.source as { path: string }).path),
    width: dims.width,
    height: dims.height,
    bitrate: proxyBitrate(dims.width, dims.height, asset.fps),
    keyFrameInterval: 0.5,
    hdrRaw: !!asset.hdr && hdrPassthrough(),
  };
  let canceled = false;
  let run: ProxyRun | null = null;
  active = {
    id,
    cancel: () => {
      canceled = true;
      run?.cancel();
    },
  };
  patchJob(id, { state: 'running', progress: 0 });
  let handle: number | null = null;
  try {
    const opened = await api.call<{ handle: number; path: string }>('x:media:openWrite', 'proxies', name);
    handle = opened.handle;
    if (canceled) throw new ProxyCanceled();
    const write = (position: number, data: Uint8Array): Promise<void> => api.call('x:media:write', opened.handle, position, data);
    const progress = (r: number): void => patchJob(id, { progress: Math.min(0.995, r) });
    run = (await startInWorker(spec, write, progress)) ?? runProxyConversion(spec, { write, progress });
    if (canceled) run.cancel();
    await run.promise;
    const info = await api.call<{ path: string; size: number }>('x:media:closeWrite', opened.handle);
    handle = null;
    updateProject(
      (p) => {
        const a = p.assets[id];
        if (a) a.proxy = { path: info.path, width: dims.width, height: dims.height };
      },
      { history: false },
    );
    known.set(id, { path: info.path, width: dims.width, height: dims.height });
    useAssetRuntime.getState().patch(id, { proxyUrl: api.media.toUrl(info.path) });
    patchJob(id, null);
  } catch (err) {
    if (handle !== null) await api.call('x:media:abortWrite', handle).catch(() => undefined);
    if (err instanceof ProxyCanceled || canceled) {
      patchJob(id, null);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[proxies] failed', asset.name, err);
    patchJob(id, { state: 'error', error: message });
    toast('error', `Could not create a proxy for "${asset.name}"`, message);
  }
}

// ---------------------------------------------------------------------------------------------
// Project lifecycle: verify, rediscover and regenerate
// ---------------------------------------------------------------------------------------------

/** Proxies this session knows exist, to restore them on assets after undo / redo. */
const known = new Map<ID, NonNullable<MediaAsset['proxy']>>();

/** Check every proxy of a freshly loaded project; regenerate the missing ones. */
export async function verifyProxies(project: Project): Promise<void> {
  const videos = Object.values(project.assets).filter((a) => a.kind === 'video' && a.source.type === 'file');
  if (videos.length === 0) return;
  const stored = new Map<string, number>();
  for (const f of await api.call<{ name: string; size: number }[]>('x:media:list', 'proxies').catch(() => [])) stored.set(f.name.toLowerCase(), f.size);
  const rt = useAssetRuntime.getState();
  const restore: Record<ID, NonNullable<MediaAsset['proxy']>> = {};
  for (const asset of videos) {
    if (asset.proxy) {
      const name = asset.proxy.path.split(/[\\/]/).pop()!.toLowerCase();
      const [info] = await api.fs.stat([asset.proxy.path]);
      if (info?.exists && info.size > 0) {
        known.set(asset.id, asset.proxy);
        rt.patch(asset.id, { proxyUrl: api.media.toUrl(asset.proxy.path) });
      } else if (rt.items[asset.id]?.status !== 'missing') {
        rt.patch(asset.id, { proxyUrl: null });
        stored.delete(name);
        requestProxy(asset.id, { force: true, reason: 'Proxy file missing — regenerating' });
      }
      continue;
    }
    // A proxy made earlier for the same file (another project, or before an undo).
    const name = proxyFileName(asset, mediaPrefs().proxySize).toLowerCase();
    if (stored.has(name)) {
      const all = await api.call<{ folder: string; path: string }[]>('x:media:usage').catch(() => []);
      const dir = all.find((u) => u.folder === 'proxies')?.path;
      if (dir) {
        const dims = proxyDimensions(asset.width, asset.height, mediaPrefs().proxySize);
        restore[asset.id] = { path: `${dir}\\${proxyFileName(asset, mediaPrefs().proxySize)}`, ...dims };
      }
    }
  }
  if (Object.keys(restore).length) {
    updateProject((p) => {
      for (const [id, proxy] of Object.entries(restore)) if (p.assets[id]) p.assets[id].proxy = proxy;
    }, { history: false });
    for (const [id, proxy] of Object.entries(restore)) {
      known.set(id, proxy);
      rt.patch(id, { proxyUrl: api.media.toUrl(proxy.path) });
    }
  }
  void autoProxy(Object.values(getProject().assets).filter((a) => a.kind === 'video' && !a.proxy));
}

let started = false;

/** Keep proxies attached to their assets across undo / redo and follow the preference. */
export function startProxyService(): void {
  if (started) return;
  started = true;
  useProjectStore.subscribe((s, prev) => {
    if (s.project === prev.project || s.docVersion !== prev.docVersion) return;
    const lost: ID[] = [];
    for (const [id, proxy] of known) {
      const a = s.project.assets[id];
      if (a && !a.proxy && useAssetRuntime.getState().items[id]?.proxyUrl) lost.push(id);
      else if (a?.proxy && a.proxy.path !== proxy.path) known.set(id, a.proxy);
    }
    if (lost.length) {
      queueMicrotask(() =>
        updateProject((p) => {
          for (const id of lost) if (p.assets[id] && !p.assets[id].proxy) p.assets[id].proxy = known.get(id);
        }, { history: false }),
      );
    }
  });
  useMediaPrefs.subscribe((s, prev) => {
    // Preview sources changed: let the engine and the media pool pick the right files.
    if (s.useProxies !== prev.useProxies) useAssetRuntime.setState((st) => ({ items: { ...st.items } }));
  });
}

/** Turn proxy playback on / off. */
export function setUseProxies(on: boolean): void {
  useMediaPrefs.getState().set({ useProxies: on });
}

/** Delete every proxy file of the app and detach them from the open project. */
export async function clearAllProxies(): Promise<number> {
  cancelAllProxies();
  const ids = Object.values(getProject().assets).filter((a) => a.proxy).map((a) => a.id);
  for (const id of ids) {
    known.delete(id);
    useAssetRuntime.getState().patch(id, { proxyUrl: null });
  }
  if (ids.length) updateProject((p) => ids.forEach((id) => p.assets[id] && delete p.assets[id].proxy), { history: false });
  return api.call<number>('x:media:remove', 'proxies');
}
