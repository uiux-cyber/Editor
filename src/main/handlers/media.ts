/**
 * Performance & media (main process): app-owned storage for proxies, the background render
 * cache and converted files (all under userData), streamed writes into those folders, storage
 * management, and the optional FFmpeg integration (detect / browse / convert with progress).
 *
 * The renderer never names arbitrary paths to write: it asks for a file in one of the
 * MEDIA_FOLDERS by base name, and only executables found on PATH or picked in a native dialog
 * are ever run (with an argument array — never through a shell).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { app, dialog, shell } from 'electron';
import { VIDEO_EXTS, extOf, type FileInfo } from '@shared/ipc';
import {
  FfmpegProgressParser,
  MEDIA_FOLDERS,
  RELEVANT_ENCODERS,
  buildFfmpegArgs,
  findOnPath,
  hashString,
  parseEncoders,
  parseFfmpegDuration,
  parseFfmpegVersion,
  progressRatio,
  safeStem,
  type FfmpegConvertOptions,
  type FfmpegInfo,
  type FolderUsage,
  type MediaFolder,
  type StoredFile,
} from '@shared/media';
import type { MainContext } from '../context';

const FFMPEG_KEY = 'media.ffmpegPath';

export default function register(ctx: MainContext): void {
  const folderPath = (folder: MediaFolder): string => path.join(ctx.userData(), folder);
  const checkFolder = (folder: unknown): MediaFolder => {
    if (!MEDIA_FOLDERS.includes(folder as MediaFolder)) throw new Error('Unknown media folder.');
    return folder as MediaFolder;
  };
  /** Base names only: no separators, no traversal, a known extension. */
  const checkName = (name: unknown, exts: string[]): string => {
    const n = String(name ?? '');
    if (!n || n !== path.basename(n) || n.startsWith('.') || /[<>:"/\\|?*\u0000-\u001f]/.test(n) || n.length > 160) throw new Error('Invalid file name.');
    if (!exts.includes(extOf(n))) throw new Error('Invalid file type.');
    return n;
  };

  // -------------------------------------------------------------------------------------------
  // Streamed writes into app folders (written to `<name>.part`, renamed on close)
  // -------------------------------------------------------------------------------------------

  interface WriteEntry {
    handle: fsp.FileHandle;
    temp: string;
    final: string;
  }
  const writes = new Map<number, WriteEntry>();
  let nextWrite = 1;

  ctx.handle('x:media:openWrite', async (folder: MediaFolder, name: string) => {
    const dir = folderPath(checkFolder(folder));
    const file = path.join(dir, checkName(name, ['mp4']));
    await fsp.mkdir(dir, { recursive: true });
    const temp = `${file}.part`;
    const handle = await fsp.open(temp, 'w');
    const id = nextWrite++;
    writes.set(id, { handle, temp, final: file });
    return { handle: id, path: file };
  });
  ctx.handle('x:media:write', async (id: number, position: number, data: Uint8Array) => {
    const entry = writes.get(id);
    if (!entry) throw new Error('Invalid write handle');
    if (!(data instanceof Uint8Array) || !Number.isFinite(position) || position < 0) throw new Error('Invalid write');
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let written = 0;
    while (written < buf.length) {
      const { bytesWritten } = await entry.handle.write(buf, written, buf.length - written, position + written);
      written += bytesWritten;
    }
  });
  ctx.handle('x:media:closeWrite', async (id: number): Promise<FileInfo> => {
    const entry = writes.get(id);
    if (!entry) throw new Error('Invalid write handle');
    writes.delete(id);
    await entry.handle.close();
    await fsp.rm(entry.final, { force: true });
    await fsp.rename(entry.temp, entry.final);
    return ctx.statFile(entry.final);
  });
  ctx.handle('x:media:abortWrite', async (id: number) => {
    const entry = writes.get(id);
    if (!entry) return;
    writes.delete(id);
    await entry.handle.close().catch(() => undefined);
    await fsp.rm(entry.temp, { force: true }).catch(() => undefined);
  });

  // -------------------------------------------------------------------------------------------
  // Storage management
  // -------------------------------------------------------------------------------------------

  async function listFolder(folder: MediaFolder): Promise<StoredFile[]> {
    const dir = folderPath(folder);
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const out: StoredFile[] = [];
    for (const name of names) {
      if (name.endsWith('.part')) continue;
      try {
        const s = await fsp.stat(path.join(dir, name));
        if (s.isFile()) out.push({ name, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        /* removed meanwhile */
      }
    }
    return out;
  }

  ctx.handle('x:media:list', (folder: MediaFolder) => listFolder(checkFolder(folder)));
  ctx.handle('x:media:usage', async (): Promise<FolderUsage[]> =>
    Promise.all(
      MEDIA_FOLDERS.map(async (folder) => {
        const files = await listFolder(folder);
        return { folder, path: folderPath(folder), files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
      }),
    ),
  );
  /** Delete files of a folder: all of them, or the given base names. */
  ctx.handle('x:media:remove', async (folder: MediaFolder, names?: string[]) => {
    const f = checkFolder(folder);
    const dir = folderPath(f);
    const list = Array.isArray(names) ? names.map((n) => checkName(n, ['mp4'])) : (await listFolder(f)).map((x) => x.name);
    let removed = 0;
    for (const name of list) {
      try {
        await fsp.rm(path.join(dir, name), { force: true });
        removed++;
      } catch {
        /* in use; skip */
      }
    }
    return removed;
  });
  /** Keep a folder under `maxBytes` by deleting the least recently used files. */
  ctx.handle('x:media:prune', async (folder: MediaFolder, maxBytes: number, keep?: string[]) => {
    const f = checkFolder(folder);
    const files = (await listFolder(f)).sort((a, b) => a.mtimeMs - b.mtimeMs);
    const protect = new Set(Array.isArray(keep) ? keep : []);
    let total = files.reduce((n, x) => n + x.size, 0);
    const removed: string[] = [];
    for (const file of files) {
      if (total <= maxBytes) break;
      if (protect.has(file.name)) continue;
      await fsp.rm(path.join(folderPath(f), file.name), { force: true }).catch(() => undefined);
      total -= file.size;
      removed.push(file.name);
    }
    return removed;
  });
  /** Mark files as recently used (LRU order for pruning). */
  ctx.handle('x:media:touch', async (folder: MediaFolder, names: string[]) => {
    const dir = folderPath(checkFolder(folder));
    const now = new Date();
    for (const n of Array.isArray(names) ? names.slice(0, 500) : []) {
      await fsp.utimes(path.join(dir, checkName(n, ['mp4'])), now, now).catch(() => undefined);
    }
  });
  ctx.handle('x:media:reveal', async (folder: MediaFolder) => {
    const dir = folderPath(checkFolder(folder));
    await fsp.mkdir(dir, { recursive: true });
    if (!ctx.e2eDir) await shell.openPath(dir);
    return dir;
  });

  // -------------------------------------------------------------------------------------------
  // FFmpeg
  // -------------------------------------------------------------------------------------------

  /** Executables the user picked in the dialog this session (only these, or PATH hits, ever run). */
  const pickedExecutables = new Set<string>();
  const norm = (p: string): string => path.resolve(p).toLowerCase();

  function runCapture(exe: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let out = '';
      let child: ChildProcess;
      try {
        child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('FFmpeg did not respond.'));
      }, timeoutMs);
      child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
      child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(out);
      });
    });
  }

  async function inspect(exe: string, source: 'custom' | 'path'): Promise<FfmpegInfo> {
    try {
      const st = await fsp.stat(exe);
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      return { found: false, path: exe, source, version: null, encoders: [], error: 'The file does not exist.' };
    }
    try {
      const version = parseFfmpegVersion(await runCapture(exe, ['-hide_banner', '-version'], 8000));
      if (!version) return { found: false, path: exe, source, version: null, encoders: [], error: 'This program is not FFmpeg.' };
      const encoders = parseEncoders(await runCapture(exe, ['-hide_banner', '-encoders'], 8000)).filter((e) => RELEVANT_ENCODERS.includes(e));
      return { found: true, path: exe, source, version, encoders };
    } catch (err) {
      return { found: false, path: exe, source, version: null, encoders: [], error: (err as Error).message };
    }
  }

  let cachedInfo: FfmpegInfo | null = null;

  async function detect(force = false): Promise<FfmpegInfo> {
    if (cachedInfo && !force) return cachedInfo;
    const custom = ctx.settings.get<string>(FFMPEG_KEY);
    if (custom) {
      pickedExecutables.add(norm(custom));
      const info = await inspect(custom, 'custom');
      if (info.found) return (cachedInfo = info);
    }
    const onPath = findOnPath(process.env.PATH ?? process.env.Path ?? '', 'ffmpeg.exe', (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (onPath) {
      const info = await inspect(onPath, 'path');
      if (info.found) return (cachedInfo = info);
    }
    return (cachedInfo = { found: false, path: null, source: null, version: null, encoders: [], error: custom ? 'The chosen FFmpeg could not be started.' : undefined });
  }

  ctx.handle('x:media:ffmpegDetect', (force?: boolean) => detect(!!force));
  ctx.handle('x:media:ffmpegBrowse', async (): Promise<FfmpegInfo | null> => {
    let file: string | null = null;
    if (ctx.e2eDir) {
      // Automated tests: the "dialog" picks the fake FFmpeg prepared by the test.
      const fake = path.join(ctx.e2eDir, 'fake-ffmpeg', 'ffmpeg.exe');
      file = fs.existsSync(fake) ? fake : null;
    } else {
      const win = ctx.window();
      const opts = { title: 'Locate ffmpeg.exe', properties: ['openFile' as const], filters: [{ name: 'FFmpeg', extensions: ['exe'] }] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      file = res.canceled ? null : (res.filePaths[0] ?? null);
    }
    if (!file) return null;
    if (extOf(file) !== 'exe') return { found: false, path: file, source: 'custom', version: null, encoders: [], error: 'Choose ffmpeg.exe.' };
    pickedExecutables.add(norm(file));
    const info = await inspect(file, 'custom');
    if (info.found) {
      ctx.settings.set(FFMPEG_KEY, file);
      cachedInfo = info;
    }
    return info;
  });
  ctx.handle('x:media:ffmpegReset', async () => {
    ctx.settings.set(FFMPEG_KEY, undefined);
    return detect(true);
  });

  interface ConvertJob {
    child: ChildProcess;
    temp: string;
    canceled: boolean;
  }
  const jobs = new Map<string, ConvertJob>();

  ctx.handle('x:media:ffmpegConvert', async (jobId: string, src: string, opts: FfmpegConvertOptions): Promise<FileInfo> => {
    const id = String(jobId ?? '').slice(0, 64);
    if (!id || jobs.has(id)) throw new Error('Invalid conversion job.');
    if (typeof src !== 'string' || !path.isAbsolute(src) || !VIDEO_EXTS.includes(extOf(src))) throw new Error('Only video files can be converted.');
    const srcStat = await fsp.stat(src).catch(() => null);
    if (!srcStat || !srcStat.isFile()) throw new Error('The source file could not be found.');
    const info = await detect();
    if (!info.found || !info.path) throw new Error('FFmpeg is not available.');
    // Run only executables found on PATH or picked by the user in the dialog.
    if (info.source === 'custom' && !pickedExecutables.has(norm(info.path))) throw new Error('FFmpeg location has not been confirmed.');
    const codec = opts?.codec === 'hevc' ? 'hevc' : 'h264';
    const safeOpts: FfmpegConvertOptions = {
      codec,
      tenBit: !!opts?.tenBit,
      videoBitrate: Math.min(400e6, Math.max(2e6, Number(opts?.videoBitrate) || 40e6)),
      audioBitrate: Math.min(512e3, Math.max(96e3, Number(opts?.audioBitrate) || 320e3)),
    };
    const dir = folderPath('converted');
    await fsp.mkdir(dir, { recursive: true });
    const name = `${safeStem(path.basename(src))}-${hashString(`${norm(src)}|${srcStat.size}|${srcStat.mtimeMs}|${codec}`).slice(0, 10)}.mp4`;
    const final = path.join(dir, name);
    const temp = `${final}.part`;
    const args = buildFfmpegArgs(src, temp, safeOpts, info.encoders);

    return new Promise<FileInfo>((resolve, reject) => {
      const child = spawn(info.path!, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      const job: ConvertJob = { child, temp, canceled: false };
      jobs.set(id, job);
      const parser = new FfmpegProgressParser();
      let duration: number | null = null;
      let stderr = '';
      let lastSent = 0;
      child.stderr?.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-64 * 1024);
        duration ??= parseFfmpegDuration(stderr);
      });
      child.stdout?.on('data', (d: Buffer) => {
        for (const p of parser.push(d.toString('utf8'))) {
          const now = Date.now();
          if (!p.done && now - lastSent < 200) continue;
          lastSent = now;
          ctx.send('x:media:ffmpegProgress', id, { ratio: progressRatio(p, duration), outTime: p.outTime, duration, speed: p.speed, frame: p.frame });
        }
      });
      child.on('error', (err) => {
        jobs.delete(id);
        void fsp.rm(temp, { force: true });
        reject(new Error(`FFmpeg could not be started: ${err.message}`));
      });
      child.on('close', (code) => {
        jobs.delete(id);
        void (async () => {
          if (job.canceled) {
            await fsp.rm(temp, { force: true }).catch(() => undefined);
            reject(new Error('Conversion cancelled'));
            return;
          }
          if (code !== 0) {
            await fsp.rm(temp, { force: true }).catch(() => undefined);
            const last = stderr.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300);
            reject(new Error(`FFmpeg failed (exit code ${code})${last ? `: ${last}` : ''}`));
            return;
          }
          try {
            await fsp.rm(final, { force: true });
            await fsp.rename(temp, final);
            resolve(await ctx.statFile(final));
          } catch (err) {
            reject(err as Error);
          }
        })();
      });
    });
  });
  ctx.handle('x:media:ffmpegCancel', (jobId: string) => {
    const job = jobs.get(String(jobId));
    if (!job) return false;
    job.canceled = true;
    job.child.kill();
    return true;
  });

  app.on('before-quit', () => {
    for (const job of jobs.values()) {
      job.canceled = true;
      job.child.kill();
    }
    for (const entry of writes.values()) void entry.handle.close().catch(() => undefined);
  });
}
