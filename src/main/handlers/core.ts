import type { MainContext } from '../context';

/**
 * Feature modules for the main process: every file in this folder default-exports
 * `register(ctx)` and is loaded at startup. Name channels `x:<area>:<action>` and call them from
 * the renderer with `window.kinora.call('x:<area>:<action>', ...args)`.
 */
export default function register(ctx: MainContext): void {
  ctx.handle('x:core:modelsDir', () => ctx.modelsDir());
}
