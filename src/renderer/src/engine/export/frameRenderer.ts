/**
 * Offline frame rendering shared by the exporter and the export dialog's framing previews: a
 * private compositor (its own GL context, optionally transparent) plus sequential WebCodecs
 * decoders for the project's video clips. Nothing here touches the live preview.
 */

import { CanvasSink, type Input, type WrappedCanvas } from 'mediabunny';
import { sourceTimeAt } from '@/core/project';
import { getSceneItems } from '@/core/scene';
import { clipEnd } from '@/core/time';
import type { ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { Compositor, type FrameImage, type MediaProvider } from '../compositor';
import { getImage, openInput, preloadImages } from '../media/assets';
import { ensureFont } from '../sources/text';

/** Sequential decoder for one video clip: hands out the frame shown at increasing source times. */
class ClipDecoder {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private exhausted = false;
  private lastTime = -Infinity;
  private width = 0;
  private height = 0;
  version = 0;

  constructor(
    private sink: CanvasSink,
    private firstTimestamp: number,
  ) {}

  private async start(time: number): Promise<void> {
    await this.iterator?.return();
    // Start slightly early so the frame covering `time` is guaranteed to be in the stream.
    this.iterator = this.sink.canvases(Math.max(this.firstTimestamp, time - 0.6));
    this.current = null;
    this.next = null;
    this.exhausted = false;
    await this.pull();
  }

  private async pull(): Promise<void> {
    if (!this.iterator || this.exhausted) {
      this.next = null;
      return;
    }
    const r = await this.iterator.next();
    if (r.done) {
      this.exhausted = true;
      this.next = null;
    } else {
      this.next = r.value;
    }
  }

  /** Position the decoder on the frame visible at `time` (seconds in the source file). */
  async seek(time: number): Promise<void> {
    // Going backwards, or jumping far ahead (previews), restarts from the nearest key frame.
    if (!this.iterator || time < this.lastTime - 1e-4 || time > this.lastTime + 4) await this.start(time);
    this.lastTime = time;
    while (this.next && this.next.timestamp <= time + 1e-4) {
      this.current = this.next;
      this.version++;
      await this.pull();
    }
    if (!this.current && this.next) {
      // Requested time is before the first frame: show the first frame.
      this.current = this.next;
      this.version++;
      await this.pull();
    }
    if (this.current) {
      this.width = this.current.canvas.width;
      this.height = this.current.canvas.height;
    }
  }

  frame(): FrameImage | null {
    if (!this.current) return null;
    return { source: this.current.canvas as TexImageSource, width: this.width, height: this.height, version: this.version };
  }

  async dispose(): Promise<void> {
    try {
      await this.iterator?.return();
    } catch {
      /* decoder already closed */
    }
    this.iterator = null;
    this.current = null;
    this.next = null;
  }
}

/** Fonts and images the project needs before its first frame can be rendered. */
export async function prepareResources(project: Project): Promise<void> {
  const fonts: Promise<void>[] = [];
  const images = new Set<ID>();
  for (const clip of Object.values(project.clips)) {
    if (clip.type === 'text') fonts.push(ensureFont(clip.text));
    if (clip.type === 'image') images.add(clip.assetId);
  }
  await Promise.all([...fonts, ensureFont({ fontFamily: 'Inter', fontWeight: 600, italic: false }), preloadImages([...images])]);
}

export interface FrameRendererOptions {
  width: number;
  height: number;
  /** Render with a transparent background (alpha kept in the canvas). */
  transparent?: boolean;
  /** Skip the compositor (audio-only exports still use the shared inputs). */
  noVideo?: boolean;
}

export class FrameRenderer {
  readonly canvas: HTMLCanvasElement;
  compositor: Compositor | null = null;
  private inputs = new Map<ID, Input>();
  private decoders = new Map<ID, ClipDecoder | null>();

  readonly provider: MediaProvider = {
    videoFrame: (clip) => this.decoders.get(clip.id)?.frame() ?? null,
    image: (assetId) => {
      const img = getImage(assetId);
      return img && img.bitmap ? { source: img.bitmap, width: img.width, height: img.height, version: img.version } : null;
    },
  };

  constructor(opts: FrameRendererOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(2, Math.round(opts.width));
    this.canvas.height = Math.max(2, Math.round(opts.height));
    if (!opts.noVideo) {
      this.compositor = new Compositor(this.canvas, { preserveDrawingBuffer: true, transparent: !!opts.transparent });
      this.compositor.setSize(this.canvas.width, this.canvas.height);
    }
  }

  /** One Mediabunny input per asset, shared by video decoding and audio mixing. */
  inputFor = (asset: MediaAsset): Input => {
    let input = this.inputs.get(asset.id);
    if (!input) {
      input = openInput(asset);
      this.inputs.set(asset.id, input);
    }
    return input;
  };

  setSize(width: number, height: number): void {
    this.compositor?.setSize(width, height);
  }

  private async decoderFor(project: Project, clip: VideoClip): Promise<ClipDecoder | null> {
    if (this.decoders.has(clip.id)) return this.decoders.get(clip.id)!;
    let decoder: ClipDecoder | null = null;
    const asset = project.assets[clip.assetId];
    try {
      if (asset) {
        const track = await this.inputFor(asset).getPrimaryVideoTrack();
        if (track && (await track.canDecode())) {
          // Keep the alpha of transparent sources (e.g. WebM with alpha) so they composite correctly.
          const alpha = await track.canBeTransparent().catch(() => false);
          decoder = new ClipDecoder(new CanvasSink(track, { poolSize: 3, alpha }), await track.getFirstTimestamp());
        }
      }
    } catch (err) {
      console.warn('[export] video source unavailable', clip.name, err);
    }
    this.decoders.set(clip.id, decoder);
    return decoder;
  }

  /** Decode every video frame needed at timeline time `t`, and free decoders of finished clips. */
  async prepare(project: Project, t: number): Promise<void> {
    const active = new Set<ID>();
    for (const item of getSceneItems(project, t)) {
      const refs = item.kind === 'layer' ? [item.layer] : [item.from, item.to];
      for (const ref of refs) {
        if (ref.clip.type !== 'video') continue;
        const asset = project.assets[ref.clip.assetId];
        if (!asset) continue;
        active.add(ref.clip.id);
        const decoder = await this.decoderFor(project, ref.clip);
        if (!decoder) continue;
        const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Infinity;
        await decoder.seek(Math.min(Math.max(sourceTimeAt(ref.clip, ref.localTime), 0), maxT));
      }
    }
    for (const [id, decoder] of this.decoders) {
      if (decoder && !active.has(id)) {
        const clip = project.clips[id];
        // Keep decoders for clips that will be needed again shortly (transition handles).
        if (!clip || clipEnd(clip) + 3 < t || clip.start > t + 3) {
          await decoder.dispose();
          this.decoders.delete(id);
        }
      }
    }
  }

  render(project: Project, t: number): void {
    this.compositor?.render(project, t, this.provider);
  }

  async dispose(): Promise<void> {
    for (const d of this.decoders.values()) await d?.dispose();
    this.decoders.clear();
    for (const input of this.inputs.values()) {
      try {
        input.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.inputs.clear();
    const compositor = this.compositor;
    this.compositor = null;
    try {
      compositor?.dispose();
      // Release the GPU context right away instead of waiting for garbage collection.
      (compositor?.ctx.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    } catch {
      /* context already lost */
    }
  }
}
