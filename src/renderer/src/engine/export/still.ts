/**
 * Still pictures of a project (thumbnails, captured video frames), rendered on the export path:
 * exact video frames, background removal, Motion clips and fonts are all awaited.
 */

import type { Project } from '@/core/types';
import { FrameRenderer, prepareResources } from './frameRenderer';

/** The frame at `time` of `project`, as a canvas of `width × height` real pixels. */
export async function renderStill(project: Project, time: number, width: number, height: number): Promise<HTMLCanvasElement> {
  const r = new FrameRenderer({ width, height });
  try {
    await prepareResources(project);
    await r.prepare(project, time);
    r.render(project, time);
    // Copy out: the renderer's WebGL canvas goes away with it.
    const out = document.createElement('canvas');
    out.width = r.canvas.width;
    out.height = r.canvas.height;
    out.getContext('2d')!.drawImage(r.canvas, 0, 0);
    return out;
  } finally {
    await r.dispose();
  }
}

export const canvasBlob = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

/** A JPEG no larger than `maxBytes` (YouTube takes thumbnails up to 2 MB): quality steps down until it fits. */
export async function jpegUnder(canvas: HTMLCanvasElement, maxBytes: number): Promise<{ blob: Blob; quality: number }> {
  let last: Blob | null = null;
  for (const quality of [0.93, 0.88, 0.82, 0.75, 0.66, 0.55, 0.45]) {
    const blob = await canvasBlob(canvas, 'image/jpeg', quality);
    if (!blob) break;
    last = blob;
    if (blob.size <= maxBytes) return { blob, quality };
  }
  if (!last) throw new Error('The picture could not be encoded.');
  return { blob: last, quality: 0.45 };
}
