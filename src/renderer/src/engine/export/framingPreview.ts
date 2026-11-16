/**
 * Framing previews for the export dialog: renders one frame of each adapted (reframed) project
 * with a throwaway compositor, so users can check every aspect before exporting. Renders are
 * serialised; one renderer (plus a transparent one, on demand) serves all previews and decoders
 * are shared between targets because reframed copies keep the clip ids.
 */

import type { Project } from '@/core/types';
import { FrameRenderer, prepareResources } from './frameRenderer';

export class FramingPreview {
  private opaque: FrameRenderer | null = null;
  private alpha: FrameRenderer | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private prepared = new WeakSet<Project>();

  /** Draw the frame at `time` of `project` into `target` (fitted, centred). */
  draw(project: Project, time: number, target: HTMLCanvasElement, opts: { transparent?: boolean } = {}): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.disposed) return;
      const transparent = !!opts.transparent;
      let r = transparent ? this.alpha : this.opaque;
      if (!r) {
        r = new FrameRenderer({ width: target.width, height: target.height, transparent });
        if (transparent) this.alpha = r;
        else this.opaque = r;
      }
      if (!this.prepared.has(project)) {
        await prepareResources(project);
        this.prepared.add(project);
      }
      // Render at the target's pixel size, keeping the project's aspect.
      const k = Math.min(target.width / project.settings.width, target.height / project.settings.height);
      const w = Math.max(2, Math.round(project.settings.width * k));
      const h = Math.max(2, Math.round(project.settings.height * k));
      r.setSize(w, h);
      await r.prepare(project, time);
      if (this.disposed) return;
      r.render(project, time);
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, target.width, target.height);
      const x = (target.width - w) / 2;
      const y = (target.height - h) / 2;
      if (transparent) drawCheckerboard(ctx, x, y, w, h);
      ctx.drawImage(r.canvas, x, y, w, h);
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch((err) => console.warn('[export] framing preview failed', err));
    return p;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.chain.catch(() => undefined);
    await this.opaque?.dispose();
    await this.alpha?.dispose();
    this.opaque = this.alpha = null;
  }
}

/** The usual grey checkerboard that marks transparent areas. */
export function drawCheckerboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size = 8): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#3a3f4b';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#2a2e37';
  for (let yy = 0; yy * size < h; yy++) {
    for (let xx = (yy % 2); xx * size < w; xx += 2) ctx.fillRect(x + xx * size, y + yy * size, size, size);
  }
  ctx.restore();
}
