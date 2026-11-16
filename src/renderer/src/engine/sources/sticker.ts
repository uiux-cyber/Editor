import type { ID, StickerClip } from '@/core/types';
import { getSticker } from '@/library';
import type { CanvasStickerDef, StickerDef } from '@/library/types';
import { ctx2d, makeCanvas, nextVersion, type AnyCanvas, type Ctx2D, type Raster } from './raster';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/** Paint an emoji centred in a square canvas of `size` px. */
export function drawEmoji(ctx: Ctx2D, char: string, size: number): void {
  const fontPx = size * 0.78;
  ctx.font = `${fontPx}px ${EMOJI_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(char);
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // Scale down glyphs whose ink is wider than the box, then centre on the ink bounds.
  const fit = Math.min(1, (size * 0.94) / Math.max(inkW, inkH, 1));
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(fit, fit);
  ctx.fillStyle = '#000';
  ctx.fillText(char, -inkW / 2 + m.actualBoundingBoxLeft, inkH / 2 - m.actualBoundingBoxDescent);
  ctx.restore();
}

/** Paint a canvas sticker into a context whose target area is `pxW × pxH` real pixels. */
export function drawCanvasSticker(ctx: Ctx2D, def: CanvasStickerDef, t: number, pxH: number, colors: string[] | undefined): void {
  const k = pxH / 256;
  ctx.save();
  ctx.scale(k, k);
  try {
    def.draw(ctx, def.animated ? t : 0, { w: 256 * def.aspect, h: 256, colors: colors && colors.length ? colors : (def.colors ?? []) });
  } catch (err) {
    console.warn(`[sticker] "${def.id}" failed to draw`, err);
  }
  ctx.restore();
}

export const stickerAspect = (def: StickerDef | undefined): number => (def && def.kind === 'canvas' ? def.aspect : 1);

interface Entry {
  key: string;
  raster: Raster;
}

export class StickerRenderer {
  private cache = new Map<ID, Entry>();

  render(clip: StickerClip, localTime: number, rasterScale: number): Raster | null {
    const def = getSticker(clip.stickerId);
    if (!def) return null;
    const aspect = stickerAspect(def);
    const pxH = Math.round(Math.min(2048, Math.max(16, clip.size * rasterScale)));
    const pxW = Math.round(pxH * aspect);
    const animated = def.kind === 'canvas' && def.animated;
    const period = def.kind === 'canvas' && def.period ? def.period : 1;
    // Wrap time so long clips never lose float precision inside sticker maths.
    const t = animated ? localTime % (period * 1000) : 0;
    const key = `${def.id}|${pxW}x${pxH}|${(clip.colors ?? []).join(',')}|${animated ? Math.round(t * 240) : 's'}`;
    const cached = this.cache.get(clip.id);
    if (cached && cached.key === key) return cached.raster;

    const canvas: AnyCanvas = cached && cached.raster.canvas.width === pxW && cached.raster.canvas.height === pxH ? cached.raster.canvas : makeCanvas(pxW, pxH);
    const ctx = ctx2d(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    if (def.kind === 'emoji') drawEmoji(ctx, def.char, pxH);
    else drawCanvasSticker(ctx, def, t, pxH, clip.colors);

    const raster: Raster = {
      canvas,
      width: clip.size * aspect,
      height: clip.size,
      contentW: clip.size * aspect,
      contentH: clip.size,
      version: nextVersion(),
      static: !animated,
    };
    this.cache.set(clip.id, { key, raster });
    return raster;
  }

  prune(alive: ReadonlySet<ID>): void {
    for (const id of this.cache.keys()) if (!alive.has(id)) this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
