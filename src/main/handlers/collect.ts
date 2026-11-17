import { app, dialog } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MainContext } from '../context';
import { PROJECT_EXT } from '@shared/ipc';

/**
 * Collect project: copy every file a project uses into one folder so it can be archived or moved
 * to another PC (renderer: ui/collect/collect.ts).
 *
 *   x:collect:pickFolder(projectName)         → folder | null   (native folder picker)
 *   x:collect:inspect(folder, name, paths[])  → sizes, missing files, free space, existing project
 *   x:collect:run(jobId, { folder, projectName, items })  → where every file ended up
 *   x:collect:cancel(jobId)
 *   event x:collect:progress { jobId, done, count, bytes, totalBytes, name }
 *
 * Files go to `<folder>/Media/` (proxies to `<folder>/Media/Proxies/`). Different files with the
 * same name get " (2)", " (3)"…; a file that is already there with the same size and date is
 * reused (collecting again is incremental). Cancelling removes everything this run created.
 */

export interface CollectItem {
  /** Caller's key (e.g. `asset:<id>` / `proxy:<id>`). */
  key: string;
  path: string;
  /** Sub-folder under Media/ (e.g. 'Proxies'). */
  sub?: string;
}

export interface CollectRequest {
  folder: string;
  projectName: string;
  items: CollectItem[];
}

export type CollectItemResult = { path: string; reused?: boolean } | { error: string };

export interface CollectResult {
  cancelled: boolean;
  projectPath: string;
  results: Record<string, CollectItemResult>;
  copied: number;
  reused: number;
  bytes: number;
}

const norm = (p: string): string => path.resolve(p).toLowerCase();

async function statOrNull(p: string): Promise<fs.Stats | null> {
  try {
    const s = await fsp.stat(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

export default function register(ctx: MainContext): void {
  const approvedFolders = new Set<string>();
  const jobs = new Map<string, AbortController>();

  const assertFolder = (folder: unknown): string => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || !approvedFolders.has(norm(folder))) throw new Error('This folder has not been chosen for collecting.');
    return path.resolve(folder);
  };
  const projectFile = (folder: string, name: string): string => path.join(folder, `${ctx.sanitizeName(name) || 'Project'}.${PROJECT_EXT}`);

  ctx.handle('x:collect:pickFolder', async (projectName: string, labels?: { title?: string; buttonLabel?: string }): Promise<string | null> => {
    if (ctx.e2eDir) {
      // Automated tests: a predictable folder inside the test output directory.
      const folder = path.join(ctx.e2eDir, 'Collected', ctx.sanitizeName(projectName) || 'Project');
      await fsp.mkdir(folder, { recursive: true });
      approvedFolders.add(norm(folder));
      return folder;
    }
    const win = ctx.window();
    const opts: Electron.OpenDialogOptions = {
      title: typeof labels?.title === 'string' ? labels.title.slice(0, 120) : 'Collect project into folder',
      buttonLabel: typeof labels?.buttonLabel === 'string' ? labels.buttonLabel.slice(0, 40) : 'Collect here',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    const folder = path.resolve(res.filePaths[0]);
    await fsp.mkdir(folder, { recursive: true });
    approvedFolders.add(norm(folder));
    return folder;
  });

  ctx.handle('x:collect:inspect', async (folder: string, projectName: string, paths: string[]) => {
    const dir = assertFolder(folder);
    const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
    const seen = new Set<string>();
    let totalBytes = 0;
    const missing: string[] = [];
    for (const p of list) {
      if (!path.isAbsolute(p) || seen.has(norm(p))) continue;
      seen.add(norm(p));
      const s = await statOrNull(p);
      if (s) totalBytes += s.size;
      else missing.push(p);
    }
    let freeBytes: number | null = null;
    try {
      const st = await fsp.statfs(dir);
      freeBytes = Number(st.bavail) * Number(st.bsize);
    } catch {
      freeBytes = null;
    }
    const projectPath = projectFile(dir, projectName);
    return { projectPath, projectExists: !!(await statOrNull(projectPath)), totalBytes, missing, freeBytes };
  });

  ctx.handle('x:collect:cancel', (jobId: string) => {
    jobs.get(jobId)?.abort();
  });

  ctx.handle('x:collect:run', async (jobId: string, req: CollectRequest): Promise<CollectResult> => {
    const folder = assertFolder(req?.folder);
    if (typeof jobId !== 'string' || jobs.has(jobId)) throw new Error('Invalid collect job.');
    const items = (Array.isArray(req.items) ? req.items : []).filter((i) => i && typeof i.key === 'string' && typeof i.path === 'string' && path.isAbsolute(i.path));
    const projectPath = projectFile(folder, req.projectName);
    const controller = new AbortController();
    jobs.set(jobId, controller);

    const created: string[] = [];
    const results: Record<string, CollectItemResult> = {};
    const bySource = new Map<string, CollectItemResult>();
    /** Lower-cased names already used per destination folder during this run. */
    const claimed = new Map<string, Map<string, string>>();
    let copied = 0;
    let reused = 0;
    let bytes = 0;

    // Sizes first, for an accurate progress bar.
    const sizes = new Map<string, number>();
    let totalBytes = 0;
    for (const it of items) {
      const key = norm(it.path);
      if (sizes.has(key)) continue;
      const s = await statOrNull(it.path);
      sizes.set(key, s?.size ?? 0);
      totalBytes += s?.size ?? 0;
    }

    let lastSent = 0;
    const progress = (done: number, name: string, force = false): void => {
      const now = Date.now();
      if (!force && now - lastSent < 60) return;
      lastSent = now;
      ctx.send('x:collect:progress', { jobId, done, count: items.length, bytes, totalBytes, name });
    };

    const destDir = (sub?: string): string => {
      const clean = sub ? ctx.sanitizeName(sub) : '';
      return clean ? path.join(folder, 'Media', clean) : path.join(folder, 'Media');
    };

    try {
      for (let i = 0; i < items.length; i++) {
        if (controller.signal.aborted) throw new Error('cancelled');
        const item = items[i];
        const srcKey = norm(item.path);
        const name = path.basename(item.path);
        progress(i, name, true);

        const already = bySource.get(srcKey);
        if (already) {
          results[item.key] = already;
          continue;
        }
        const src = await statOrNull(item.path);
        if (!src) {
          const r = { error: 'File not found' };
          results[item.key] = r;
          bySource.set(srcKey, r);
          continue;
        }
        const dir = destDir(item.sub);
        // Already inside the destination folder (re-collecting into the same place): keep it.
        if (srcKey.startsWith(norm(dir) + path.sep)) {
          const r = { path: path.resolve(item.path), reused: true };
          results[item.key] = r;
          bySource.set(srcKey, r);
          reused++;
          bytes += src.size;
          continue;
        }
        await fsp.mkdir(dir, { recursive: true });
        let names = claimed.get(norm(dir));
        if (!names) claimed.set(norm(dir), (names = new Map()));

        // Pick a destination: reuse an identical file, otherwise the first free name.
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let dest = '';
        let identical = false;
        for (let n = 1; ; n++) {
          const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
          const lower = candidate.toLowerCase();
          if (names.has(lower)) continue; // taken by another source in this run
          const full = path.join(dir, candidate);
          const existing = await statOrNull(full);
          if (!existing) {
            dest = full;
            break;
          }
          if (existing.size === src.size && Math.abs(existing.mtimeMs - src.mtimeMs) < 2000) {
            dest = full;
            identical = true;
            break;
          }
        }
        names.set(path.basename(dest).toLowerCase(), srcKey);

        if (identical) {
          reused++;
          bytes += src.size;
        } else {
          const tmp = `${dest}.part`;
          let fileBytes = 0;
          const counter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              fileBytes += chunk.length;
              bytes += chunk.length;
              progress(i, name);
              cb(null, chunk);
            },
          });
          try {
            await pipeline(fs.createReadStream(item.path, { highWaterMark: 1 << 20 }), counter, fs.createWriteStream(tmp), { signal: controller.signal });
            await fsp.rename(tmp, dest);
          } catch (err) {
            await fsp.unlink(tmp).catch(() => undefined);
            bytes -= fileBytes;
            if (controller.signal.aborted) throw new Error('cancelled');
            const r = { error: (err as Error).message || 'Copy failed' };
            results[item.key] = r;
            bySource.set(srcKey, r);
            continue;
          }
          created.push(dest);
          // Keep the original dates so a later collect recognises the copy as identical.
          await fsp.utimes(dest, src.atime, src.mtime).catch(() => undefined);
          copied++;
        }
        const r = { path: dest, reused: identical || undefined };
        results[item.key] = r;
        bySource.set(srcKey, r);
      }
      progress(items.length, '', true);
      ctx.approveRead(projectPath);
      ctx.approveWrite(projectPath);
      return { cancelled: false, projectPath, results, copied, reused, bytes };
    } catch (err) {
      if ((err as Error).message !== 'cancelled' && !controller.signal.aborted) throw err;
      // Cancelled: remove what this run created, keep pre-existing files.
      for (const f of created) await fsp.unlink(f).catch(() => undefined);
      return { cancelled: true, projectPath, results: {}, copied: 0, reused: 0, bytes: 0 };
    } finally {
      jobs.delete(jobId);
    }
  });
}
