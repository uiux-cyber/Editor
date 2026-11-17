/**
 * Collect project (renderer side): gathers every file-based asset (and optionally its proxy) into
 * a folder through the main handler `x:collect:*`, then writes the project file into that folder
 * with media paths relative to it, so the folder is self-contained.
 */

import { serializeProject, parseProjectFile } from '@/core/project';
import type { MediaAsset, Project } from '@/core/types';
import { api } from '@/platform/api';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { t } from '../i18n';

export function startCollect(): void {
  useUI.getState().openModal('collect');
}

export interface CollectItem {
  key: string;
  path: string;
  sub?: string;
}

export interface CollectInspect {
  projectPath: string;
  projectExists: boolean;
  totalBytes: number;
  missing: string[];
  freeBytes: number | null;
}

export interface CollectProgress {
  jobId: string;
  done: number;
  count: number;
  bytes: number;
  totalBytes: number;
  name: string;
}

type ItemResult = { path: string; reused?: boolean } | { error: string };

interface RunResult {
  cancelled: boolean;
  projectPath: string;
  results: Record<string, ItemResult>;
  copied: number;
  reused: number;
  bytes: number;
}

export interface CollectSummary {
  /** File-based media in the project. */
  files: number;
  proxies: number;
  /** Built-in generated sounds (rebuilt from their id, nothing to copy). */
  generated: number;
}

export function summarize(project: Project): CollectSummary {
  const assets = Object.values(project.assets);
  return {
    files: assets.filter((a) => a.source.type === 'file').length,
    proxies: assets.filter((a) => a.source.type === 'file' && a.proxy?.path).length,
    generated: assets.filter((a) => a.source.type === 'generated').length,
  };
}

/** What has to be copied. */
export function collectItems(project: Project, includeProxies: boolean): CollectItem[] {
  const items: CollectItem[] = [];
  for (const asset of Object.values(project.assets)) {
    if (asset.source.type !== 'file') continue;
    items.push({ key: `asset:${asset.id}`, path: asset.source.path });
    if (includeProxies && asset.proxy?.path) items.push({ key: `proxy:${asset.id}`, path: asset.proxy.path, sub: 'Proxies' });
  }
  return items;
}

/** The project with its paths pointing at the collected copies. */
export function remapProject(project: Project, results: Record<string, ItemResult>): Project {
  const assets: Record<string, MediaAsset> = {};
  for (const [id, asset] of Object.entries(project.assets)) {
    let next = asset;
    const src = results[`asset:${id}`];
    if (src && 'path' in src && asset.source.type === 'file') next = { ...next, source: { type: 'file', path: src.path } };
    const proxy = results[`proxy:${id}`];
    if (proxy && 'path' in proxy && asset.proxy) next = { ...next, proxy: { ...asset.proxy, path: proxy.path } };
    assets[id] = next;
  }
  return { ...project, assets };
}

/** Native folder picker (labels translated here: the main process has no translations). */
export const pickCollectFolder = (name: string): Promise<string | null> =>
  api.call<string | null>('x:collect:pickFolder', name, { title: t('Collect project into folder'), buttonLabel: t('Collect here') });

export function inspectCollect(folder: string, project: Project, includeProxies: boolean): Promise<CollectInspect> {
  return api.call<CollectInspect>(
    'x:collect:inspect',
    folder,
    project.name,
    collectItems(project, includeProxies).map((i) => i.path),
  );
}

export interface CollectOutcome {
  cancelled: boolean;
  projectPath: string;
  copied: number;
  reused: number;
  failed: { name: string; error: string }[];
}

let activeJob: string | null = null;

export function cancelCollect(): void {
  if (activeJob) void api.call('x:collect:cancel', activeJob);
}

/** Copy the media and write the project into `folder`. */
export async function runCollect(folder: string, includeProxies: boolean, onProgress: (p: CollectProgress) => void): Promise<CollectOutcome> {
  const project = useProjectStore.getState().project;
  const jobId = `collect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const items = collectItems(project, includeProxies);
  const off = api.on('x:collect:progress', (p: CollectProgress) => {
    if (p.jobId === jobId) onProgress(p);
  });
  activeJob = jobId;
  try {
    const res = await api.call<RunResult>('x:collect:run', jobId, { folder, projectName: project.name, items });
    if (res.cancelled) return { cancelled: true, projectPath: res.projectPath, copied: 0, reused: 0, failed: [] };
    const failed: CollectOutcome['failed'] = [];
    for (const item of items) {
      const r = res.results[item.key];
      if (r && 'error' in r) failed.push({ name: item.path.replace(/^.*[\\/]/, ''), error: r.error });
    }
    const collected = remapProject(project, res.results);
    await api.fs.writeProject(res.projectPath, serializeProject(collected, { projectPath: res.projectPath }));
    return { cancelled: false, projectPath: res.projectPath, copied: res.copied, reused: res.reused, failed };
  } finally {
    activeJob = null;
    off();
  }
}

/** Read back a collected project file (used by tests and to verify the write). */
export async function readCollected(path: string): Promise<Project> {
  return parseProjectFile(await api.fs.readProject(path), { projectPath: path });
}
