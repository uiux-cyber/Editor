/**
 * Thumbnails of animated media (animated GIF / WebP / APNG, Lottie): the format badge and a
 * canvas that plays the animation while the media bin tile is hovered, plus the filmstrip used
 * by timeline clips. Frames come from engine/media/animated.ts (the same frames as the preview).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { MediaAsset } from '@/core/types';
import { animationFrame, onAnimationUpdate } from '@/engine/media/animated';
import './animated.css';

export const ANIMATION_BADGE: Record<string, string> = { gif: 'GIF', webp: 'WEBP', apng: 'APNG', lottie: 'LOTTIE', motion: 'MOTION' };

/** "GIF" / "LOTTIE" badge for a media tile. */
export function AnimationBadge({ asset }: { asset: MediaAsset }): ReactNode {
  if (asset.kind !== 'animation') return null;
  return (
    <span className={`media-tile__badge media-tile__badge--${asset.format ?? 'gif'}`} title={asset.format === 'lottie' ? 'Lottie animation' : asset.format === 'motion' ? 'Motion clip (animation code)' : 'Animated image'}>
      {ANIMATION_BADGE[asset.format ?? 'gif'] ?? 'ANIM'}
    </span>
  );
}

/** Draw `source` into `ctx` so it covers (or fits in) the w × h box. */
function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, w: number, h: number, mode: 'cover' | 'contain'): void {
  const k = mode === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * k;
  const dh = sh * k;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Plays the animation over the tile's poster while the tile is hovered. */
export function AnimatedThumb({ asset }: { asset: MediaAsset }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const tile = canvas?.closest('.media-tile') as HTMLElement | null;
    if (!canvas || !tile) return;
    let raf = 0;
    let started = 0;
    const draw = (): void => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const t = (performance.now() - started) / 1000;
      const k = Math.max(w / Math.max(1, asset.width), h / Math.max(1, asset.height));
      const frame = animationFrame(asset, t, { width: Math.ceil(asset.width * k), height: Math.ceil(asset.height * k) });
      const ctx = canvas.getContext('2d');
      if (frame && ctx) {
        ctx.clearRect(0, 0, w, h);
        drawCover(ctx, frame.source as CanvasImageSource, frame.width, frame.height, w, h, 'cover');
        canvas.classList.add('is-on');
      }
      raf = requestAnimationFrame(draw);
    };
    const enter = (): void => {
      started = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    const leave = (): void => {
      cancelAnimationFrame(raf);
      raf = 0;
      canvas.classList.remove('is-on');
    };
    tile.addEventListener('pointerenter', enter);
    tile.addEventListener('pointerleave', leave);
    return () => {
      leave();
      tile.removeEventListener('pointerenter', enter);
      tile.removeEventListener('pointerleave', leave);
    };
  }, [asset]);
  return <canvas ref={ref} className="media-tile__anim" />;
}

/**
 * Paint a filmstrip of an animated asset for a timeline clip: tiles of `tileW` × `height` from
 * x = `from` (clip px) over `width`, each showing the frame at its own time.
 */
export function paintAnimationStrip(ctx: CanvasRenderingContext2D, asset: MediaAsset, from: number, width: number, height: number, pps: number, dpr: number): boolean {
  const tileW = Math.max(8, height * (asset.width / Math.max(1, asset.height)));
  const first = Math.floor(from / tileW);
  const last = Math.ceil((from + width) / tileW);
  let complete = true;
  for (let i = first; i < last; i++) {
    const x = i * tileW;
    const frame = animationFrame(asset, x / pps, { width: Math.ceil(tileW * dpr), height: Math.ceil(height * dpr) });
    if (!frame) {
      complete = false;
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - from, 0, tileW, height);
    ctx.clip();
    ctx.fillStyle = 'rgba(8, 10, 14, 0.35)';
    ctx.fillRect(x - from, 0, tileW, height);
    ctx.translate(x - from, 0);
    drawCover(ctx, frame.source as CanvasImageSource, frame.width, frame.height, tileW, height, 'contain');
    ctx.restore();
  }
  return complete;
}

/** Repaint callback for timeline strips when more frames become available. */
export const onAnimationFrames = onAnimationUpdate;
