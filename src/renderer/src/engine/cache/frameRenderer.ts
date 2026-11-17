/**
 * Offline frame renderer for the background render cache: the same compositor as the preview
 * and the exporter, fed by sequential WebCodecs decoders reading the ORIGINAL media (HDR sources
 * through the raw-signal sink, exactly like the exporter), at the cache resolution.
 */

import type { Input, WrappedCanvas } from 'mediabunny';
import { sourceTimeAt } from '@/core/project';
import { getSceneItems } from '@/core/scene';
import { clipEnd } from '@/core/time';
import type { ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { Compositor, type FrameImage, type MediaProvider } from '../compositor';
import { getImage, openInput, preloadImages } from '../media/assets';
import { canvasSinkFor } from '../media/hdr';
import { ensureFont } from '../sources/text';

class SequentialDecoder {
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;
  private last = -Infinity;
  version = 0;

  constructor(
    private sink: { canvases(start?: number): AsyncGenerator<WrappedCanvas, void, unknown> },
    private first: number,
  ) {}

  private async restart(time: number): Promise<void> {
    await this.it?.return();
    this.it = this.sink.canvases(Math.max(this.first, time - 0.6));
    this.current = null;
    this.next = null;
    this.done = false;
    await this.pull();
  }

  private async pull(): Promise<void> {
    if (!this.it || this.done) {
      this.next = null;
      return;
    }
    const r = await this.it.next();
    this.done = !!r.done;
    this.next = r.done ? null : r.value;
  }

  async seek(time: number): Promise<void> {
    // Backwards (reverse playback) or a big jump forwards: restart from the nearest key frame.
    if (!this.it || time < this.last - 1e-4 || time > this.last + 2) await this.restart(time);
    this.last = time;
    while (this.next && this.next.timestamp <= time + 1e-4) {
      this.current = this.next;
      this.version++;
      await this.pull();
    }
    if (!this.current && this.next) {
      this.current = this.next;
      this.version++;
      await this.pull();
    }
  }

  frame(): FrameImage | null {
    const c = this.current?.canvas;
    return c ? { source: c as TexImageSource, width: c.width, height: c.height, version: this.version } : null;
  }

  async dispose(): Promise<void> {
    await this.it?.return().catch(() => undefined);
    this.it = null;
    this.current = this.next = null;
  }
}

export class CacheFrameRenderer {
  readonly canvas: HTMLCanvasElement;
  private compositor: Compositor;
  private inputs = new Map<ID, Input>();
  private decoders = new Map<ID, SequentialDecoder | null>();
  private provider: MediaProvider;
  private project: Project;

  constructor(project: Project, width: number, height: number) {
    this.project = project;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.compositor = new Compositor(this.canvas, { preserveDrawingBuffer: true });
    this.compositor.setSize(width, height);
    this.provider = {
      videoFrame: (clip) => this.decoders.get(clip.id)?.frame() ?? null,
      image: (assetId) => {
        const img = getImage(assetId);
        return img && img.bitmap ? { source: img.bitmap, width: img.width, height: img.height, version: img.version } : null;
      },
    };
  }

  /** Use a newer snapshot of the project (decoders of unchanged clips are kept). */
  setProject(project: Project): void {
    this.project = project;
  }

  /** Fonts and still images used by the project (call once before rendering). */
  async prepare(): Promise<void> {
    const fonts: Promise<void>[] = [];
    const images = new Set<ID>();
    for (const clip of Object.values(this.project.clips)) {
      if (clip.type === 'text') fonts.push(ensureFont(clip.text));
      if (clip.type === 'image') images.add(clip.assetId);
    }
    await Promise.all([...fonts, preloadImages([...images])]);
  }

  private input(asset: MediaAsset): Input {
    let input = this.inputs.get(asset.id);
    if (!input) {
      input = openInput(asset);
      this.inputs.set(asset.id, input);
    }
    return input;
  }

  private async decoderFor(clip: VideoClip): Promise<SequentialDecoder | null> {
    if (this.decoders.has(clip.id)) return this.decoders.get(clip.id)!;
    let decoder: SequentialDecoder | null = null;
    const asset = this.project.assets[clip.assetId];
    try {
      if (asset) {
        const track = await this.input(asset).getPrimaryVideoTrack();
        if (track && (await track.canDecode())) decoder = new SequentialDecoder(canvasSinkFor(asset, track, { poolSize: 3 }), await track.getFirstTimestamp());
      }
    } catch (err) {
      console.warn('[cache] video source unavailable', clip.name, err);
    }
    this.decoders.set(clip.id, decoder);
    return decoder;
  }

  /** Render the frame at timeline time `t` into the canvas. */
  async render(t: number): Promise<void> {
    const project = this.project;
    const active = new Set<ID>();
    for (const item of getSceneItems(project, t)) {
      for (const ref of item.kind === 'layer' ? [item.layer] : [item.from, item.to]) {
        if (ref.clip.type !== 'video') continue;
        const asset = project.assets[ref.clip.assetId];
        if (!asset) continue;
        active.add(ref.clip.id);
        const d = await this.decoderFor(ref.clip);
        const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Infinity;
        await d?.seek(Math.min(Math.max(sourceTimeAt(ref.clip, ref.localTime), 0), maxT));
      }
    }
    for (const [id, d] of this.decoders) {
      const clip = project.clips[id];
      if (!active.has(id) && (!clip || clipEnd(clip) + 3 < t)) {
        await d?.dispose();
        this.decoders.delete(id);
      }
    }
    this.compositor.render(project, t, this.provider);
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
    try {
      this.compositor.dispose();
      (this.compositor.ctx.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    } catch {
      /* context already lost */
    }
  }
}
