/**
 * The preview engine: owns the transport (play / pause / seek), the render loop, the live media
 * pool and the preview compositor. A single instance is shared by the whole UI.
 */

import { create } from 'zustand';
import { projectDuration } from '@/core/project';
import { snapToFrame } from '@/core/time';
import type { ID, Project } from '@/core/types';
import { useProjectStore } from '@/store/project';
import { useUI } from '@/store/ui';
import { Compositor, type LayerBox, type MediaProvider } from './compositor';
import { getImage, onImageLoaded, useAssetRuntime } from './media/assets';
import { MediaPool } from './preview/mediaPool';
import { onFontsChanged } from './sources/text';

interface PlaybackState {
  playing: boolean;
  /** Playhead time, updated a few times per second while playing and exactly on seeks. */
  time: number;
  /** Bumped after each rendered frame that changed the layer layout (for on-canvas handles). */
  layoutVersion: number;
}

/** Coarse playback state for React components. Per-frame consumers use `engine.onTime`. */
export const usePlayback = create<PlaybackState>()(() => ({ playing: false, time: 0, layoutVersion: 0 }));

type TimeListener = (time: number) => void;

class Engine {
  time = 0;
  playing = false;
  private compositor: Compositor | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private pool: MediaPool | null = null;
  private raf = 0;
  private dirty = true;
  private playWall = 0;
  private playFrom = 0;
  private lastCoarse = 0;
  private viewport = { w: 0, h: 0, dpr: 1 };
  private timeListeners = new Set<TimeListener>();
  private unsubs: (() => void)[] = [];
  private suspended = false;
  private lastLayoutSig = '';

  private provider: MediaProvider = {
    videoFrame: (clip) => this.pool?.videoFrame(clip) ?? null,
    image: (assetId) => {
      const img = getImage(assetId);
      return img && img.bitmap ? { source: img.bitmap, width: img.width, height: img.height, version: img.version } : null;
    },
  };

  private get project(): Project {
    return useProjectStore.getState().project;
  }

  get duration(): number {
    return projectDuration(this.project);
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return;
    this.detach();
    this.canvas = canvas;
    this.pool = new MediaPool();
    this.pool.onFrame = () => this.invalidate();
    this.pool.setMasterVolume(useUI.getState().masterVolume);
    this.createCompositor();

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    let lastProject = this.project;
    let lastDoc = useProjectStore.getState().docVersion;
    this.unsubs.push(
      useProjectStore.subscribe((s) => {
        if (s.docVersion !== lastDoc) {
          lastDoc = s.docVersion;
          this.pause();
          this.pool?.reset();
          this.time = 0;
          this.emitTime(true);
        }
        if (s.project !== lastProject) {
          lastProject = s.project;
          const end = projectDuration(s.project);
          if (this.time > end) {
            this.time = Math.max(0, end);
            this.emitTime(true);
          }
          this.updateSize();
          this.syncMedia();
          this.invalidate();
        }
      }),
      useUI.subscribe((s, prev) => {
        if (s.previewQuality !== prev.previewQuality) {
          this.updateSize();
          this.invalidate();
        }
        if (s.masterVolume !== prev.masterVolume) this.pool?.setMasterVolume(s.masterVolume);
      }),
      useAssetRuntime.subscribe(() => {
        this.syncMedia();
        this.invalidate();
      }),
      onFontsChanged(() => this.invalidate()),
      onImageLoaded(() => this.invalidate()),
    );
    this.updateSize();
    this.syncMedia();
    this.invalidate();
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.playing = false;
    usePlayback.setState({ playing: false });
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    this.pool?.dispose();
    this.pool = null;
    try {
      this.compositor?.dispose();
    } catch {
      /* context may already be gone */
    }
    this.compositor = null;
    this.canvas = null;
  }

  private createCompositor(): void {
    if (!this.canvas) return;
    try {
      this.compositor = new Compositor(this.canvas);
    } catch (err) {
      console.error('[engine] could not create the compositor', err);
      this.compositor = null;
    }
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.compositor = null;
  };

  private onContextRestored = (): void => {
    this.createCompositor();
    this.updateSize();
    this.invalidate();
  };

  /** Pause rendering and playback while an export owns the GPU and the decoders. */
  setSuspended(on: boolean): void {
    this.suspended = on;
    if (on) {
      this.pause();
      this.pool?.pauseAll();
    } else {
      this.invalidate();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------------------------

  /** Tell the engine how large the canvas is on screen (CSS pixels). */
  setViewport(cssWidth: number, cssHeight: number, dpr: number): void {
    this.viewport = { w: cssWidth, h: cssHeight, dpr };
    this.updateSize();
    this.invalidate();
  }

  private updateSize(): void {
    if (!this.compositor) return;
    const { width, height } = this.project.settings;
    const quality = useUI.getState().previewQuality;
    // Never render more pixels than the screen shows, nor more than the project has.
    const screenW = Math.max(16, this.viewport.w * this.viewport.dpr);
    const scale = Math.min(quality, screenW / width, 1);
    this.compositor.setSize(Math.max(16, Math.round(width * scale)), Math.max(16, Math.round(height * scale)));
  }

  // -------------------------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------------------------

  onTime(cb: TimeListener): () => void {
    this.timeListeners.add(cb);
    return () => this.timeListeners.delete(cb);
  }

  private emitTime(coarse: boolean): void {
    for (const cb of this.timeListeners) cb(this.time);
    const now = performance.now();
    if (coarse || now - this.lastCoarse > 120) {
      this.lastCoarse = now;
      if (usePlayback.getState().time !== this.time) usePlayback.setState({ time: this.time });
    }
  }

  play(): void {
    if (this.playing || this.suspended) return;
    const end = this.duration;
    if (end <= 0) return;
    if (this.time >= end - 1 / this.project.settings.fps) this.time = 0;
    this.playing = true;
    this.playWall = performance.now();
    this.playFrom = this.time;
    usePlayback.setState({ playing: true });
    this.syncMedia();
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.time = snapToFrame(this.time, this.project.settings.fps);
    usePlayback.setState({ playing: false });
    this.emitTime(true);
    this.syncMedia();
    this.invalidate();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Move the playhead. Times are clamped to the project and snapped to the frame grid. */
  seek(time: number, opts: { snap?: boolean } = {}): void {
    const fps = this.project.settings.fps;
    const end = Math.max(0, this.duration);
    let t = Math.min(Math.max(0, time), end);
    if (opts.snap !== false) t = snapToFrame(t, fps);
    if (t === this.time && !this.playing) return;
    this.time = t;
    if (this.playing) {
      this.playWall = performance.now();
      this.playFrom = t;
    }
    this.emitTime(true);
    this.syncMedia();
    this.invalidate();
  }

  stepFrames(n: number): void {
    this.pause();
    this.seek(this.time + n / this.project.settings.fps);
  }

  // -------------------------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------------------------

  /** Request a repaint of the preview. */
  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || !this.canvas) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private syncMedia(): void {
    if (this.suspended) return;
    this.pool?.sync(this.project, this.time, this.playing);
  }

  private frame = (): void => {
    this.raf = 0;
    if (this.suspended) return;
    const project = this.project;
    if (this.playing) {
      const end = projectDuration(project);
      let t = this.playFrom + (performance.now() - this.playWall) / 1000;
      if (t >= end) {
        if (useUI.getState().loop && end > 0) {
          t = 0;
          this.playWall = performance.now();
          this.playFrom = 0;
        } else {
          this.time = end;
          this.playing = false;
          usePlayback.setState({ playing: false });
          this.emitTime(true);
          this.syncMedia();
          this.renderFrame(project);
          return;
        }
      }
      this.time = t;
      this.emitTime(false);
      this.syncMedia();
      this.renderFrame(project);
      this.schedule();
      return;
    }
    if (this.dirty) {
      this.dirty = false;
      // Elements that just finished loading still need to be moved to the playhead.
      this.syncMedia();
      this.renderFrame(project);
      // While a paused seek is still decoding, keep polling so the final frame appears.
      if (this.pool?.isSettling()) {
        this.dirty = true;
        this.schedule();
      }
    }
  };

  /** Number of frames rendered so far (for performance diagnostics). */
  framesRendered = 0;

  private renderFrame(project: Project): void {
    if (!this.compositor) return;
    this.framesRendered++;
    const fps = project.settings.fps;
    // Sample on the frame grid so the preview shows exactly what an export would.
    const t = Math.floor(this.time * fps + 1e-4) / fps;
    try {
      this.compositor.render(project, t, this.provider);
    } catch (err) {
      console.error('[engine] render failed', err);
      return;
    }
    // Let on-canvas handles follow animated layers without re-rendering React every frame.
    let sig = '';
    for (const id of useUI.getState().selection) {
      const box = this.compositor.layout.get(id);
      if (box) sig += `${id}:${box.cx.toFixed(1)},${box.cy.toFixed(1)},${box.w.toFixed(1)},${box.h.toFixed(1)},${box.rotation.toFixed(1)};`;
    }
    if (sig !== this.lastLayoutSig) {
      this.lastLayoutSig = sig;
      usePlayback.setState((s) => ({ layoutVersion: s.layoutVersion + 1 }));
    }
  }

  /** Placement of a layer in the last rendered frame (design px, relative to the centre). */
  layerBox(id: ID): LayerBox | undefined {
    return this.compositor?.layout.get(id);
  }

  /** Every layer box of the last rendered frame. */
  layerBoxes(): Map<ID, LayerBox> {
    return this.compositor?.layout ?? new Map();
  }

  /** Output level 0..1 for the meter. */
  level(): number {
    return this.playing ? (this.pool?.level() ?? 0) : 0;
  }

  /** PNG of the current frame at preview resolution. */
  async snapshot(): Promise<Blob | null> {
    if (!this.canvas || !this.compositor) return null;
    this.renderFrame(this.project);
    return new Promise((resolve) => this.canvas!.toBlob((b) => resolve(b), 'image/png'));
  }
}

export const engine = new Engine();
