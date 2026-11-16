/**
 * Renders single frames of one clip for the trim monitor (the two-up view shown while rolling or
 * slipping). It uses its own instance of the compositor that drives the preview and the export,
 * with a provider that decodes the exact source frame through Mediabunny, so what the monitor
 * shows is the frame the export will contain.
 */

import { CanvasSink } from 'mediabunny';
import type { ID, MediaAsset, Project } from '@/core/types';
import { Compositor, type FrameImage, type MediaProvider } from '@/engine/compositor';
import { getImage, sharedInput } from '@/engine/media/assets';

/** Longest side of the rendered frames, px. */
const MAX_EDGE = 720;

interface Decoded {
  sourceTime: number;
  frame: FrameImage;
}

class FrameGrabber {
  private compositor: Compositor | null = null;
  private unavailable = false;
  private sinks = new Map<ID, Promise<CanvasSink | null>>();
  private decoded = new Map<ID, Decoded>();
  /** Source times the compositor asked for and did not get during the last pass. */
  private wanted = new Map<ID, { assetId: ID; sourceTime: number }>();
  private version = 1;
  private queue: Promise<void> = Promise.resolve();

  private provider: MediaProvider = {
    videoFrame: (clip, sourceTime) => {
      const hit = this.decoded.get(clip.id);
      const asset = this.assets?.[clip.assetId];
      const tolerance = 0.5 / Math.max(1, asset?.fps || 30);
      if (hit && Math.abs(hit.sourceTime - sourceTime) <= tolerance) return hit.frame;
      this.wanted.set(clip.id, { assetId: clip.assetId, sourceTime });
      return hit?.frame ?? null;
    },
    image: (assetId) => {
      const img = getImage(assetId);
      return img && img.bitmap ? { source: img.bitmap, width: img.width, height: img.height, version: img.version } : null;
    },
  };

  private assets: Record<ID, MediaAsset> | null = null;

  private getCompositor(): Compositor | null {
    if (this.compositor || this.unavailable) return this.compositor;
    try {
      this.compositor = new Compositor(new OffscreenCanvas(16, 16), { preserveDrawingBuffer: true });
    } catch (err) {
      this.unavailable = true;
      console.warn('[trim monitor] no compositor available', err);
    }
    return this.compositor;
  }

  private sink(asset: MediaAsset): Promise<CanvasSink | null> {
    let sink = this.sinks.get(asset.id);
    if (!sink) {
      sink = (async () => {
        const track = await sharedInput(asset).getPrimaryVideoTrack();
        return track ? new CanvasSink(track, { height: Math.min(MAX_EDGE, asset.height || MAX_EDGE), poolSize: 0 }) : null;
      })().catch((err) => {
        console.warn('[trim monitor] cannot decode', asset.name, err);
        return null;
      });
      this.sinks.set(asset.id, sink);
    }
    return sink;
  }

  private async fetchWanted(project: Project): Promise<void> {
    const jobs = [...this.wanted].map(async ([clipId, w]) => {
      const asset = project.assets[w.assetId];
      if (!asset) return;
      const sink = await this.sink(asset);
      const wrapped = sink ? await sink.getCanvas(w.sourceTime) : null;
      if (!wrapped) return;
      const canvas = wrapped.canvas;
      this.decoded.set(clipId, { sourceTime: w.sourceTime, frame: { source: canvas as TexImageSource, width: canvas.width, height: canvas.height, version: this.version++ } });
    });
    this.wanted.clear();
    await Promise.all(jobs);
  }

  private async renderNow(project: Project, clipId: ID, time: number, target: HTMLCanvasElement): Promise<void> {
    const clip = project.clips[clipId];
    const track = clip && project.tracks.find((t) => t.id === clip.trackId);
    if (!clip || !track || clip.type === 'audio') return;
    const compositor = this.getCompositor();
    if (!compositor) return;
    // The clip on its own, so the frame is not hidden by layers above it.
    const solo: Project = { ...project, tracks: [{ ...track, hidden: false }], clips: { [clip.id]: clip }, transitions: {} };
    const t = Math.min(Math.max(time, clip.start), clip.start + clip.duration - 1e-4);
    const { width, height } = project.settings;
    const k = Math.min(1, MAX_EDGE / Math.max(width, height));
    compositor.setSize(Math.max(16, Math.round(width * k)), Math.max(16, Math.round(height * k)));
    this.assets = project.assets;
    this.wanted.clear();
    compositor.render(solo, t, this.provider);
    if (this.wanted.size) {
      await this.fetchWanted(project);
      compositor.render(solo, t, this.provider);
    }
    const src = compositor.canvas;
    if (target.width !== src.width || target.height !== src.height) {
      target.width = src.width;
      target.height = src.height;
    }
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(src as OffscreenCanvas, 0, 0);
  }

  /**
   * Render `clipId` alone at timeline `time` into `target`. Requests run one at a time; a
   * request whose `isCurrent()` turned false while it waited is skipped.
   */
  render(project: Project, clipId: ID, time: number, target: HTMLCanvasElement, isCurrent: () => boolean): Promise<void> {
    this.queue = this.queue
      .then(() => (isCurrent() ? this.renderNow(project, clipId, time, target) : undefined))
      .catch((err) => console.warn('[trim monitor] render failed', err));
    return this.queue;
  }

  /** Forget decoded frames (they hold canvases) once the monitor closes. */
  release(): void {
    this.decoded.clear();
    this.wanted.clear();
  }
}

export const frameGrabber = new FrameGrabber();
