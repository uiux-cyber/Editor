import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { FileInfo } from '@shared/ipc';
import { MAX_MOTION_BYTES, MOTION_EXT } from '@shared/motion';
import type { MainContext } from '../context';

/**
 * Motion clips on disk. Clips Kinora writes (Claude's create_motion / update_motion) go to
 * Documents\Kinora\Motion as .kmotion files; each change is a new file, so undo can go back to the
 * previous version. The file is approved for reading so the renderer can load it.
 *
 *  - `x:motion:save(name, text)` → FileInfo of the new file
 */
export default function register(ctx: MainContext): void {
  const folder = (): string => (ctx.e2eDir ? path.join(ctx.e2eDir, 'motion') : path.join(app.getPath('documents'), 'Kinora', 'Motion'));

  ctx.handle('x:motion:save', async (name: unknown, text: unknown): Promise<FileInfo> => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The motion clip is empty.');
    if (Buffer.byteLength(text, 'utf8') > MAX_MOTION_BYTES) throw new Error('The motion clip is larger than 1 MB.');
    const dir = folder();
    await fsp.mkdir(dir, { recursive: true });
    const base = ctx.sanitizeName(typeof name === 'string' ? name : '').replace(/[. ]+$/, '').slice(0, 60) || 'Motion';
    const file = path.join(dir, `${base} ${randomBytes(3).toString('hex')}.${MOTION_EXT}`);
    await fsp.writeFile(file, text, { encoding: 'utf8', flag: 'wx' });
    ctx.approveRead(file);
    return ctx.statFile(file);
  });
}
