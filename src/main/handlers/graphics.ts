import * as path from 'node:path';
import type { MainContext } from '../context';
import { isLottieFile } from '../lottieGuard';

/**
 * Text & graphics: lets the importer ask whether a JSON / .lottie file is a Lottie animation
 * before reading it (the media protocol refuses any other JSON, see lottieGuard.ts).
 */
export default function register(ctx: MainContext): void {
  ctx.handle('x:graphics:isLottie', async (p: unknown): Promise<boolean> => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.(json|lottie)$/i.test(p)) return false;
    return isLottieFile(path.normalize(p));
  });
}
