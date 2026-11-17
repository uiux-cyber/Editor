/**
 * LUT library (colour feature): imported `.cube` files are validated, copied into
 * `<userData>/luts/<id>.cube` and listed in `<userData>/luts/index.json`.
 *
 *   x:luts:list              → LutEntry[]
 *   x:luts:import            → { imported: LutEntry[], failures: { name, error }[] }  (open dialog)
 *   x:luts:read (id)         → .cube text, or null when the LUT is not in the library
 *   x:luts:rename (id, name) → LutEntry[]
 *   x:luts:delete (id)       → LutEntry[]
 */

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import { CubeParseError, parseCube } from '@shared/cube';
import type { MainContext } from '../context';

interface LutEntry {
  id: string;
  name: string;
  kind: '1d' | '3d';
  size: number;
  addedAt: number;
  /** Original file name (informational). */
  source: string;
}

const ID_RE = /^u_[a-z0-9]{6,32}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export default function register(ctx: MainContext): void {
  const dir = (): string => path.join(ctx.userData(), 'luts');
  const indexFile = (): string => path.join(dir(), 'index.json');
  const fileFor = (id: string): string => path.join(dir(), `${id}.cube`);

  // Serialise index updates so concurrent calls never lose entries.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function readIndex(): Promise<LutEntry[]> {
    try {
      const raw = JSON.parse(await fsp.readFile(indexFile(), 'utf8')) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is LutEntry => !!e && typeof e === 'object' && ID_RE.test((e as LutEntry).id) && typeof (e as LutEntry).name === 'string');
    } catch {
      return [];
    }
  }

  async function writeIndex(list: LutEntry[]): Promise<void> {
    await fsp.mkdir(dir(), { recursive: true });
    const tmp = `${indexFile()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
    await fsp.rename(tmp, indexFile());
  }

  const cleanName = (name: string): string =>
    String(name ?? '')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  ctx.handle('x:luts:list', () => readIndex());

  ctx.handle('x:luts:import', async () => {
    const win = ctx.window();
    const res = win
      ? await dialog.showOpenDialog(win, {
          title: 'Import LUT',
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Cube LUT', extensions: ['cube'] },
            { name: 'All files', extensions: ['*'] },
          ],
        })
      : { canceled: true, filePaths: [] as string[] };
    const imported: LutEntry[] = [];
    const failures: { name: string; error: string }[] = [];
    if (res.canceled || res.filePaths.length === 0) return { imported, failures };

    for (const file of res.filePaths) {
      const base = path.basename(file);
      try {
        const st = await fsp.stat(file);
        if (!st.isFile()) throw new Error('Not a file.');
        if (st.size > MAX_FILE_BYTES) throw new Error('The file is too large to be a LUT.');
        const text = await fsp.readFile(file, 'utf8');
        const lut = parseCube(text);
        const id = `u_${randomBytes(8).toString('hex')}`;
        await fsp.mkdir(dir(), { recursive: true });
        await fsp.writeFile(fileFor(id), text, 'utf8');
        const entry: LutEntry = {
          id,
          name: cleanName(lut.title) || cleanName(base.replace(/\.cube$/i, '')) || 'Imported LUT',
          kind: lut.kind,
          size: lut.size,
          addedAt: Date.now(),
          source: base.slice(0, 200),
        };
        imported.push(entry);
      } catch (err) {
        failures.push({ name: base, error: err instanceof CubeParseError ? err.message : `The file could not be read (${(err as Error).message}).` });
      }
    }
    if (imported.length) {
      await exclusive(async () => {
        const list = await readIndex();
        await writeIndex([...list, ...imported]);
      });
    }
    return { imported, failures };
  });

  ctx.handle('x:luts:read', async (id: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    try {
      return await fsp.readFile(fileFor(id), 'utf8');
    } catch {
      return null;
    }
  });

  ctx.handle('x:luts:rename', (id: string, name: string) =>
    exclusive(async () => {
      const list = await readIndex();
      const entry = list.find((e) => e.id === id);
      const clean = cleanName(name);
      if (entry && clean) {
        entry.name = clean;
        await writeIndex(list);
      }
      return list;
    }),
  );

  ctx.handle('x:luts:delete', (id: string) =>
    exclusive(async () => {
      if (typeof id !== 'string' || !ID_RE.test(id)) return readIndex();
      const list = (await readIndex()).filter((e) => e.id !== id);
      await writeIndex(list);
      await fsp.unlink(fileFor(id)).catch(() => undefined);
      return list;
    }),
  );
}
