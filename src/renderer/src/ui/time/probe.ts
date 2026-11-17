/**
 * Measurement helpers for automated checks of time remapping (scripts/e2e/time.mjs) and for
 * debugging from DevTools (`__kinora.time`): read back exported files and the preview, and
 * compute which source frame the timeline should show.
 */

import { CanvasSink, AudioBufferSink } from 'mediabunny';
import { pictureRefsAt, soundsAt } from '@/core/nested';
import { sourceSpan, sourceTimeAt, speedAt } from '@/core/timemap';
import type { ID } from '@/core/types';
import { engine } from '@/engine/engine';
import { openInput } from '@/engine/media/assets';
import { getProject, getRootProject } from '@/store/project';

/** Horizontal centroid (px) of bright pixels on one row of an image, or null when none. */
function brightCentroid(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, y: number): number | null {
  const row = ctx.getImageData(0, Math.round(y), width, 1).data;
  let sum = 0;
  let weight = 0;
  for (let x = 0; x < width; x++) {
    const l = 0.2126 * row[x * 4] + 0.7152 * row[x * 4 + 1] + 0.0722 * row[x * 4 + 2];
    if (l > 110) {
      sum += x * l;
      weight += l;
    }
  }
  return weight > 0 ? sum / weight : null;
}

export interface FileProbe {
  duration: number;
  width: number;
  height: number;
  /** Bright-bar centroid (px) on the probed row for each requested time. */
  bars: (number | null)[];
  /** RMS level of each requested audio window. */
  rms: number[];
}

/** Decode frames and audio windows of an imported asset (e.g. a re-imported export). */
export async function probeAsset(assetId: ID, times: number[], rowFraction: number, windows: [number, number][]): Promise<FileProbe> {
  const asset = getRootProject().assets[assetId];
  if (!asset) throw new Error('unknown asset');
  const input = openInput(asset);
  try {
    const out: FileProbe = { duration: await input.computeDuration(), width: 0, height: 0, bars: [], rms: [] };
    const video = await input.getPrimaryVideoTrack();
    if (video) {
      out.width = video.displayWidth;
      out.height = video.displayHeight;
      const sink = new CanvasSink(video);
      for (const t of times) {
        const wc = await sink.getCanvas(t);
        if (!wc) {
          out.bars.push(null);
          continue;
        }
        const ctx = (wc.canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true })!;
        out.bars.push(brightCentroid(ctx, wc.canvas.width, wc.canvas.height * rowFraction));
      }
    }
    const audio = await input.getPrimaryAudioTrack();
    if (audio) {
      const sink = new AudioBufferSink(audio);
      for (const [a, b] of windows) {
        let sum = 0;
        let n = 0;
        for await (const { buffer, timestamp } of sink.buffers(a, b)) {
          const data = buffer.getChannelData(0);
          const rate = buffer.sampleRate;
          for (let i = 0; i < data.length; i++) {
            const t = timestamp + i / rate;
            if (t < a || t >= b) continue;
            sum += data[i] * data[i];
            n++;
          }
        }
        out.rms.push(n ? Math.sqrt(sum / n) : 0);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** Bright-bar centroid on a row of the current preview frame, as a fraction of its width. */
export async function measurePreview(rowFraction: number): Promise<number | null> {
  const blob = await engine.snapshot();
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const x = brightCentroid(ctx, bmp.width, bmp.height * rowFraction);
  const w = bmp.width;
  bmp.close();
  return x === null ? null : x / w;
}

/** Source time of the (top-most) video picture at a timeline time of the document. */
export function expectedSourceAt(time: number, root = true): { clip: ID; source: number; speed: number } | null {
  const refs = pictureRefsAt(root ? getRootProject() : getProject(), time);
  const ref = refs[refs.length - 1];
  if (!ref) return null;
  return { clip: ref.clip.id, source: sourceTimeAt(ref.clip, ref.localTime), speed: speedAt(ref.clip, ref.localTime) };
}

/** Ids and gains of the sounds heard at a timeline time of the document. */
export function soundsHeardAt(time: number): { clip: ID; gain: number }[] {
  return soundsAt(getRootProject(), time).map((s) => ({ clip: s.clip.id, gain: s.gain }));
}

/** Source seconds covered by a clip of the timeline being edited. */
export function clipSourceSpan(id: ID): number {
  const clip = getProject().clips[id];
  return clip && (clip.type === 'video' || clip.type === 'audio') ? sourceSpan(clip) : 0;
}
