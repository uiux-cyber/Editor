import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { FileInfo } from '@shared/ipc';
import type { MainContext } from '../context';

/**
 * Video frames captured for thumbnails. They are saved as PNG files in
 * Documents\Kinora\Thumbnails (so the project can reference them like any picture) and approved
 * for reading.
 *
 *  - `x:thumbnails:saveFrame(name, png bytes)` → FileInfo of the new file
 */
const MAX_FRAME_BYTES = 80 * 1024 * 1024;

export default function register(ctx: MainContext): void {
  const folder = (): string => (ctx.e2eDir ? path.join(ctx.e2eDir, 'thumbnails') : path.join(app.getPath('documents'), 'Kinora', 'Thumbnails'));

  ctx.handle('x:thumbnails:saveFrame', async (name: unknown, data: unknown): Promise<FileInfo> => {
    if (!(data instanceof Uint8Array) || data.byteLength < 8) throw new Error('The frame is empty.');
    if (data.byteLength > MAX_FRAME_BYTES) throw new Error('The frame is too large.');
    // PNG signature: only pictures Kinora rendered are written here.
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!sig.every((b, i) => data[i] === b)) throw new Error('The frame is not a PNG picture.');
    const dir = folder();
    await fsp.mkdir(dir, { recursive: true });
    const base = ctx.sanitizeName(typeof name === 'string' ? name : '').replace(/[. ]+$/, '').slice(0, 60) || 'Frame';
    const file = path.join(dir, `${base} ${randomBytes(3).toString('hex')}.png`);
    await fsp.writeFile(file, data, { flag: 'wx' });
    ctx.approveRead(file);
    return ctx.statFile(file);
  });
}
