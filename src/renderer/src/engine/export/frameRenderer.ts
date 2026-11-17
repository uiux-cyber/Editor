/**
 * Offline frame rendering shared by the exporter and the export dialog's framing previews: a
 * private compositor (its own GL context, optionally transparent) plus sequential WebCodecs
 * decoders for the project's video clips. Nothing here touches the live preview.
 */

import { CanvasSink, EncodedPacketSink, type Input, type WrappedCanvas } from 'mediabunny';
import { MAX_NESTING, deepClips, instanceView } from '@/core/compound';
import { mediaInstances, pictureRefsAt, type MediaInstance } from '@/core/nested';
import { sourceTimeAt } from '@/core/project';
import { getSceneItems } from '@/core/scene';
import type { ID, MediaAsset, Project, VideoClip } from '@/core/types';
import { Compositor, type FrameImage, type MediaProvider } from '../compositor';
import { animationFrame, ensureAnimationFrame, preloadAnimations } from '../media/animated';
import { getImage, openInput, preloadImages } from '../media/assets';
import { ensureFont } from '../sources/text';

/** Hands out the frame shown at a source time for one video clip instance. */
interface FrameDecoder {
  seek(time: number): Promise<void>;
  frame(): FrameImage | null;
  dispose(): Promise<void>;
}

/** Sequential decoder for one video clip: hands out the frame shown at increasing source times. */
class ClipDecoder implements FrameDecoder {
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

/** Memory budget for the frames of one reversed clip (full resolution canvases). */
const REVERSE_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * Decoder for reversed clips, whose source time decreases from frame to frame: decodes one GOP
 * (or a bounded slice of a long one, re-decoding from its key frame) at a time and hands its
 * frames out backwards, so every packet is decoded about once instead of once per frame.
 */
class ReverseClipDecoder implements FrameDecoder {
  private frames: WrappedCanvas[] = [];
  private from = Infinity;
  private to = -Infinity;
  private current: WrappedCanvas | null = null;
  version = 0;

  constructor(
    private sink: CanvasSink,
    private packets: EncodedPacketSink,
    private firstTimestamp: number,
    private maxSpan: number,
  ) {}

  async seek(time: number): Promise<void> {
    const t = Math.max(this.firstTimestamp, time);
    if (!(t >= this.from - 1e-6 && t < this.to)) await this.load(t);
    let pick: WrappedCanvas | null = null;
    for (const f of this.frames) {
      if (f.timestamp <= t + 1e-4) pick = f;
      else break;
    }
    pick ??= this.frames[0] ?? null;
    if (pick && pick !== this.current) {
      this.current = pick;
      this.version++;
    }
  }

  private async load(time: number): Promise<void> {
    const key = await this.packets.getKeyPacket(time, { metadataOnly: true });
    let from = key ? key.timestamp : this.firstTimestamp;
    if (time - from > this.maxSpan) from = time - this.maxSpan;
    const end = time + 1e-3;
    const frames: WrappedCanvas[] = [];
    for await (const wc of this.sink.canvases(from, end)) frames.push(wc);
    this.frames = frames;
    this.from = frames.length ? Math.min(from, frames[0].timestamp) : from;
    this.to = end;
  }

  frame(): FrameImage | null {
    if (!this.current) return null;
    return { source: this.current.canvas as TexImageSource, width: this.current.canvas.width, height: this.current.canvas.height, version: this.version };
  }

  async dispose(): Promise<void> {
    this.frames = [];
    this.current = null;
  }
}

/** Fonts and images the project needs before its first frame can be rendered. */
export async function prepareResources(project: Project): Promise<void> {
  const fonts: Promise<void>[] = [];
  const images = new Set<ID>();
  const animations = new Set<ID>();
  // Including the clips inside compound clips.
  for (const clip of deepClips(project)) {
    if (clip.type === 'text') fonts.push(ensureFont(clip.text));
    if (clip.type === 'image') (project.assets[clip.assetId]?.kind === 'animation' ? animations : images).add(clip.assetId);
  }
  const animated = [...animations].map((id) => project.assets[id]).filter(Boolean);
  await Promise.all([...fonts, ensureFont({ fontFamily: 'Inter', fontWeight: 600, italic: false }), preloadImages([...images]), preloadAnimations(animated)]);
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
  private decoders = new Map<ID, FrameDecoder | null>();
  /** Project of the frame being prepared (animated assets need their asset record). */
  private project: Project | null = null;
  /** Clip instances (top level and inside compound clips) by instance id, for decoder lifetimes. */
  private instances: { project: Project; byId: Map<ID, MediaInstance> } | null = null;

  readonly provider: MediaProvider = {
    videoFrame: (clip) => this.decoders.get(clip.id)?.frame() ?? null,
    image: (assetId, time, hint) => {
      const asset = this.project?.assets[assetId];
      if (asset?.kind === 'animation') return animationFrame(asset, time ?? 0, hint);
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

  private async decoderFor(project: Project, clip: VideoClip): Promise<FrameDecoder | null> {
    if (this.decoders.has(clip.id)) return this.decoders.get(clip.id)!;
    let decoder: FrameDecoder | null = null;
    const asset = project.assets[clip.assetId];
    try {
      if (asset) {
        const track = await this.inputFor(asset).getPrimaryVideoTrack();
        if (track && (await track.canDecode())) {
          // Keep the alpha of transparent sources (e.g. WebM with alpha) so they composite correctly.
          const alpha = await track.canBeTransparent().catch(() => false);
          if (clip.reverse && !clip.freeze) {
            const w = Math.max(1, asset.width || 1920);
            const h = Math.max(1, asset.height || 1080);
            const fps = asset.fps > 0 ? asset.fps : 30;
            const maxFrames = Math.min(90, Math.max(8, Math.floor(REVERSE_BUDGET_BYTES / (w * h * 4))));
            decoder = new ReverseClipDecoder(new CanvasSink(track, { alpha }), new EncodedPacketSink(track), await track.getFirstTimestamp(), maxFrames / fps);
          } else {
            decoder = new ClipDecoder(new CanvasSink(track, { poolSize: 3, alpha }), await track.getFirstTimestamp());
          }
        }
      }
    } catch (err) {
      console.warn('[export] video source unavailable', clip.name, err);
    }
    this.decoders.set(clip.id, decoder);
    return decoder;
  }

  /** Animated images on screen at `t` (including inside compound clips): decode their exact frame. */
  private async prepareAnimations(project: Project, t: number, depth = 0): Promise<void> {
    for (const item of getSceneItems(project, t)) {
      const refs = item.kind === 'layer' ? [item.layer] : [item.from, item.to];
      for (const ref of refs) {
        if (ref.clip.type === 'image') {
          const anim = project.assets[ref.clip.assetId];
          if (anim?.kind === 'animation') await ensureAnimationFrame(anim, Math.min(Math.max(ref.localTime, 0), ref.clip.duration));
        } else if (ref.clip.type === 'compound' && depth < MAX_NESTING) {
          await this.prepareAnimations(instanceView(project, ref.clip), ref.clip.trimIn + ref.localTime, depth + 1);
        }
      }
    }
  }

  /** Decode every video frame needed at timeline time `t`, and free decoders of finished clips. */
  async prepare(project: Project, t: number): Promise<void> {
    this.project = project;
    if (this.instances?.project !== project) this.instances = { project, byId: new Map(mediaInstances(project).map((i) => [i.clip.id, i])) };
    await this.prepareAnimations(project, t);
    const active = new Set<ID>();
    // Every picture on screen, including clips inside compound clips (instance ids).
    for (const ref of pictureRefsAt(project, t)) {
      const asset = project.assets[ref.clip.assetId];
      if (!asset) continue;
      active.add(ref.clip.id);
      const decoder = await this.decoderFor(project, ref.clip);
      if (!decoder) continue;
      const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Infinity;
      await decoder.seek(Math.min(Math.max(sourceTimeAt(ref.clip, ref.localTime), 0), maxT));
    }
    const byId = this.instances.byId;
    for (const [id, decoder] of this.decoders) {
      if (decoder && !active.has(id)) {
        const inst = byId.get(id);
        // Keep decoders for clips that will be needed again shortly (transition handles).
        if (!inst || inst.to + 3 < t || inst.from > t + 3) {
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
