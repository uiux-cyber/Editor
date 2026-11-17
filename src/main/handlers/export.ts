import { dialog } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { MainContext } from '../context';

/**
 * Export feature: destination folders (multi-format exports, PNG sequences), image-sequence
 * frames and subtitle sidecars. Every write lands in a folder the user picked in a native dialog
 * (or the test folder), or next to an export file the user picked.
 */
export default function register(ctx: MainContext): void {
  const norm = (p: string): string => path.resolve(p).toLowerCase();
  const folders = new Set<string>();
  const insideE2e = (p: string): boolean => !!ctx.e2eDir && (norm(p) === norm(ctx.e2eDir) || norm(p).startsWith(norm(ctx.e2eDir) + path.sep));

  const approveFolder = (dir: string): void => {
    folders.add(norm(dir));
    // Lets "Open" / "Show in folder" reveal it (app:openPath only opens approved paths).
    ctx.approveWrite(dir);
  };
  const assertFolder = (dir: unknown): string => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid folder.');
    if (!folders.has(norm(dir)) && !insideE2e(dir)) throw new Error('Writing to this folder has not been granted.');
    return path.normalize(dir);
  };
  const cleanName = (name: unknown, exts?: string[]): string => {
    const n = ctx.sanitizeName(String(name ?? '')).replace(/^\.+/, '');
    if (!n || n.length > 200) throw new Error('Invalid file name.');
    if (exts && !exts.includes(path.extname(n).slice(1).toLowerCase())) throw new Error('Invalid file type.');
    return n;
  };
  /** `name`, or `name (2)`, `name (3)`… — whichever does not exist yet in `dir`. */
  const unique = (dir: string, name: string): string => {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let i = 2; fs.existsSync(path.join(dir, candidate)) && i < 1000; i++) candidate = `${base} (${i})${ext}`;
    return path.join(dir, candidate);
  };

  /** Ask for a destination folder. Returns null when cancelled. */
  ctx.handle('x:export:pickFolder', async (title?: string): Promise<string | null> => {
    if (ctx.e2eDir) {
      await fsp.mkdir(ctx.e2eDir, { recursive: true });
      approveFolder(ctx.e2eDir);
      return ctx.e2eDir;
    }
    const win = ctx.window();
    const last = ctx.settings.get<string>('lastExportDir');
    const opts: Electron.OpenDialogOptions = {
      title: typeof title === 'string' && title ? title.slice(0, 120) : 'Choose a folder for the exports',
      defaultPath: last && fs.existsSync(last) ? last : undefined,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    await fsp.mkdir(dir, { recursive: true });
    ctx.settings.set('lastExportDir', dir);
    approveFolder(dir);
    return dir;
  });

  /** An export file inside an approved folder (never overwrites: adds " (2)" when taken). */
  ctx.handle('x:export:fileInFolder', async (dir: string, name: string): Promise<string> => {
    const folder = assertFolder(dir);
    const file = unique(folder, cleanName(name));
    ctx.approveWrite(file);
    return file;
  });

  /** A new sub-folder (for a PNG sequence) inside an approved folder. */
  ctx.handle('x:export:subfolder', async (dir: string, name: string): Promise<string> => {
    const folder = assertFolder(dir);
    const sub = unique(folder, cleanName(name));
    await fsp.mkdir(sub, { recursive: true });
    approveFolder(sub);
    return sub;
  });

  /** One frame of a PNG sequence. */
  ctx.handle('x:export:writeFrame', async (dir: string, name: string, data: Uint8Array): Promise<void> => {
    const folder = assertFolder(dir);
    const file = path.join(folder, cleanName(name, ['png']));
    await fsp.writeFile(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });

  /** Remove the frames of a cancelled / failed sequence. */
  ctx.handle('x:export:deleteFrames', async (dir: string, names: string[]): Promise<void> => {
    const folder = assertFolder(dir);
    for (const name of Array.isArray(names) ? names : []) {
      await fsp.unlink(path.join(folder, cleanName(name, ['png']))).catch(() => undefined);
    }
  });

  /**
   * Write a subtitle sidecar: `<output name>.<srt|vtt>` next to an export file the user picked,
   * or `<folder name>.<srt|vtt>` inside an image-sequence folder. Returns the file written.
   */
  ctx.handle('x:export:writeSidecar', async (output: string, ext: string, text: string, isFolder: boolean): Promise<string> => {
    if (ext !== 'srt' && ext !== 'vtt') throw new Error('Unsupported subtitle format.');
    if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('Invalid output path.');
    let file: string;
    if (isFolder) {
      const folder = assertFolder(output);
      file = path.join(folder, `${path.basename(folder)}.${ext}`);
    } else {
      ctx.assertWrite(output);
      const base = path.basename(output, path.extname(output));
      file = path.join(path.dirname(output), `${base}.${ext}`);
    }
    await fsp.writeFile(file, String(text ?? ''), 'utf8');
    ctx.approveWrite(file);
    return file;
  });

  /** Total size of the PNG frames in a sequence folder. */
  ctx.handle('x:export:folderSize', async (dir: string): Promise<number> => {
    const folder = assertFolder(dir);
    let total = 0;
    for (const entry of await fsp.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile()) total += (await fsp.stat(path.join(folder, entry.name)).catch(() => ({ size: 0 }))).size;
    }
    return total;
  });
}
