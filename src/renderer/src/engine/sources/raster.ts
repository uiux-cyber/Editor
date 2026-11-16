import type { Paint } from '@/core/types';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A rasterised layer source (text, shape, sticker). */
export interface Raster {
  canvas: AnyCanvas;
  /** Size of the whole canvas in design px (the textured quad). */
  width: number;
  height: number;
  /** Size of the meaningful content in design px (what the selection box should hug). */
  contentW: number;
  contentH: number;
  /** Changes whenever the pixels change; the compositor re-uploads the texture on change. */
  version: number;
  /** False when the pixels change every frame (skip mipmaps). */
  static: boolean;
}

/** Largest canvas edge we are willing to rasterise. */
export const MAX_RASTER = 4096;

let versionCounter = 1;
export const nextVersion = (): number => versionCounter++;

export function makeCanvas(w: number, h: number): AnyCanvas {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

export function ctx2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D canvas is unavailable');
  return ctx;
}

/** Quantise a scale factor upwards so small animated scale changes reuse the same raster. */
export function quantizeScale(s: number): number {
  const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  for (const step of steps) if (s <= step + 1e-6) return step;
  return 8;
}

/** Build a canvas fill style for a Paint over the box (x, y, w, h). */
export function paintStyle(ctx: Ctx2D, paint: Paint, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (paint.type === 'solid') return paint.color;
  if (paint.type === 'linear') {
    const a = (paint.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // Half-length of the box projected on the gradient direction.
    const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    addStops(g, paint.stops);
    return g;
  }
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2);
  addStops(g, paint.stops);
  return g;
}

function addStops(g: CanvasGradient, stops: { offset: number; color: string }[]): void {
  for (const s of stops) {
    try {
      g.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
    } catch {
      /* ignore invalid colours */
    }
  }
}

export function roundRectPath(ctx: Ctx2D | Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Stable, cheap string hash for cache keys. */
export function hashKey(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
