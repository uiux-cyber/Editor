/**
 * Live thumbnails for the library. One hidden compositor (its own WebGL context) renders small
 * demo projects; tiles copy the result into plain 2D canvases. Posters are rendered lazily when
 * a tile scrolls into view and cached; hovering a tile plays its animation.
 */

import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { makeImage, makeTrack, uid } from '@/core/factory';
import { createProject } from '@/core/project';
import type { Clip, MediaAsset, Project } from '@/core/types';
import { Compositor, type MediaProvider } from '@/engine/compositor';

// ---------------------------------------------------------------------------------------------
// Demo pictures (drawn once, used to preview filters, effects and transitions)
// ---------------------------------------------------------------------------------------------

const DEMO_W = 640;
const DEMO_H = 360;

function demoCanvas(draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = DEMO_W;
  c.height = DEMO_H;
  draw(c.getContext('2d')!);
  return c;
}

function ridge(ctx: CanvasRenderingContext2D, baseY: number, amp: number, seed: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, DEMO_H);
  for (let x = 0; x <= DEMO_W; x += 8) {
    const y = baseY - amp * (0.55 * Math.sin(x * 0.011 + seed) + 0.3 * Math.sin(x * 0.027 + seed * 2.3) + 0.15 * Math.sin(x * 0.061 + seed * 5.1));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(DEMO_W, DEMO_H);
  ctx.closePath();
  ctx.fill();
}

/** Warm sunset over mountains and water. */
function drawDemoA(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, DEMO_H * 0.72);
  sky.addColorStop(0, '#2b3a7a');
  sky.addColorStop(0.45, '#c8577a');
  sky.addColorStop(0.8, '#ffb25e');
  sky.addColorStop(1, '#ffe2a0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  const sun = ctx.createRadialGradient(410, 205, 0, 410, 205, 150);
  sun.addColorStop(0, 'rgba(255,250,220,1)');
  sun.addColorStop(0.16, 'rgba(255,236,170,0.95)');
  sun.addColorStop(0.2, 'rgba(255,214,130,0.5)');
  sun.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [x, y, w] of [
    [70, 60, 120],
    [250, 40, 90],
    [470, 78, 130],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, 9, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.2, y - 8, w / 3, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ridge(ctx, 232, 46, 1.2, '#7a4a86');
  ridge(ctx, 256, 38, 3.4, '#4c3270');
  ridge(ctx, 280, 30, 5.9, '#2a2150');
  const water = ctx.createLinearGradient(0, 286, 0, DEMO_H);
  water.addColorStop(0, '#e58a62');
  water.addColorStop(1, '#27224f');
  ctx.fillStyle = water;
  ctx.fillRect(0, 290, DEMO_W, 70);
  ctx.fillStyle = 'rgba(255,236,170,0.55)';
  for (let i = 0; i < 9; i++) ctx.fillRect(410 - 50 + i * 4 - i * i, 296 + i * 7, 100 - i * 8 + i * i * 2, 2.2);
  ctx.fillStyle = '#17132f';
  ctx.beginPath();
  ctx.moveTo(0, DEMO_H);
  ctx.lineTo(0, 300);
  ctx.quadraticCurveTo(90, 286, 190, 318);
  ctx.quadraticCurveTo(250, 338, 300, DEMO_H);
  ctx.closePath();
  ctx.fill();
  for (const [x, h] of [
    [40, 70],
    [78, 52],
    [120, 60],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, 310 - h);
    ctx.lineTo(x + 16, 312);
    ctx.lineTo(x - 16, 312);
    ctx.closePath();
    ctx.fill();
  }
}

/** Cool daylight scene with greens and blues. */
function drawDemoB(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, DEMO_H * 0.7);
  sky.addColorStop(0, '#1d6fd1');
  sky.addColorStop(0.6, '#7cc7f2');
  sky.addColorStop(1, '#dff3fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const [x, y, s] of [
    [120, 70, 1],
    [380, 50, 0.8],
    [540, 100, 1.1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 26 * s, y - 10 * s, 28 * s, 0, Math.PI * 2);
    ctx.arc(x + 58 * s, y, 22 * s, 0, Math.PI * 2);
    ctx.rect(x, y, 58 * s, 22 * s);
    ctx.fill();
  }
  ridge(ctx, 226, 54, 0.4, '#6f93c9');
  ridge(ctx, 258, 40, 2.7, '#3f8f6e');
  ridge(ctx, 292, 28, 4.6, '#2f7a45');
  const field = ctx.createLinearGradient(0, 300, 0, DEMO_H);
  field.addColorStop(0, '#5fb84a');
  field.addColorStop(1, '#2c7a2f');
  ctx.fillStyle = field;
  ctx.fillRect(0, 306, DEMO_W, 60);
  ctx.fillStyle = '#f6d443';
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % DEMO_W;
    const y = 316 + ((i * 53) % 38);
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e9534a';
  ctx.beginPath();
  ctx.roundRect(446, 236, 86, 72, 6);
  ctx.fill();
  ctx.fillStyle = '#8b2f2a';
  ctx.beginPath();
  ctx.moveTo(436, 240);
  ctx.lineTo(489, 200);
  ctx.lineTo(542, 240);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(462, 256, 20, 20);
  ctx.fillRect(498, 256, 20, 20);
}

let demoA: HTMLCanvasElement | null = null;
let demoB: HTMLCanvasElement | null = null;

const demoAsset = (id: string): MediaAsset => ({
  id,
  kind: 'image',
  name: id,
  source: { type: 'file', path: '' },
  duration: 0,
  width: DEMO_W,
  height: DEMO_H,
  fps: 0,
  hasVideo: false,
  hasAudio: false,
  size: 0,
  addedAt: 0,
});

export const DEMO_A = demoAsset('demo-a');
export const DEMO_B = demoAsset('demo-b');

export const demoProvider: MediaProvider = {
  videoFrame: () => null,
  image: (assetId) => {
    if (assetId === 'demo-a') return { source: (demoA ??= demoCanvas(drawDemoA)), width: DEMO_W, height: DEMO_H, version: 1 };
    if (assetId === 'demo-b') return { source: (demoB ??= demoCanvas(drawDemoB)), width: DEMO_W, height: DEMO_H, version: 2 };
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Demo projects
// ---------------------------------------------------------------------------------------------

/** Wrap layers (bottom → top) into a throw-away project of the given pixel size. */
export function projectFromLayers(layers: Clip[], width: number, height: number, background = '#101216', withDemoAssets = false): Project {
  const project = createProject({ width, height, fps: 30, background });
  project.tracks = [];
  if (withDemoAssets) {
    project.assets[DEMO_A.id] = DEMO_A;
    project.assets[DEMO_B.id] = DEMO_B;
  }
  // Layers that never overlap can share a track; keeping one track per layer is simplest and
  // always preserves the stacking order.
  for (let i = layers.length - 1; i >= 0; i--) {
    const track = makeTrack('visual', `L${i}`);
    project.tracks.push(track);
    const layer = layers[i];
    project.clips[layer.id] = { ...layer, trackId: track.id };
  }
  if (project.tracks.length === 0) project.tracks.push(makeTrack('visual', 'L0'));
  return project;
}

/** Two demo pictures back to back on one track, for previewing a transition. */
export function transitionDemoProject(type: string, width: number, height: number): Project {
  const project = createProject({ width, height, fps: 30, background: '#000000' });
  project.assets[DEMO_A.id] = DEMO_A;
  project.assets[DEMO_B.id] = DEMO_B;
  const track = project.tracks[0];
  const a = { ...makeImage(DEMO_A, { duration: 1.5, start: 0 }), trackId: track.id };
  const b = { ...makeImage(DEMO_B, { duration: 1.5, start: 1.5 }), trackId: track.id };
  // Fill the tile regardless of its aspect ratio.
  const cover = Math.max(1, (width / height) / (DEMO_W / DEMO_H), (DEMO_W / DEMO_H) / (width / height));
  a.transform.scaleX = a.transform.scaleY = cover;
  b.transform.scaleX = b.transform.scaleY = cover;
  project.clips[a.id] = a;
  project.clips[b.id] = b;
  const id = uid('tn_');
  project.transitions[id] = { id, type, duration: 1.2, fromId: a.id, toId: b.id, params: {} };
  return project;
}

/**
 * True when a template has no full-frame background of its own (lower-thirds, tickers, stream
 * overlays…). Such designs are meant to sit on footage, so their thumbnails get a backdrop.
 */
export function isOverlayDesign(clips: Clip[], cw: number, ch: number): boolean {
  for (const c of clips) {
    if (c.type === 'generator') return false;
    if (c.type === 'shape') {
      const w = c.shape.width * Math.abs(c.transform.scaleX);
      const h = c.shape.height * Math.abs(c.transform.scaleY);
      if (w >= cw * 0.95 && h >= ch * 0.95 && Math.abs(c.transform.x) < cw * 0.05 && Math.abs(c.transform.y) < ch * 0.05) return false;
    }
  }
  return true;
}

/** Thumbnail project for a built template; overlays are shown on a dimmed demo picture. */
export function templateThumbProject(clips: Clip[], width: number, height: number, cw: number, ch: number): Project {
  if (!isOverlayDesign(clips, cw, ch)) return projectFromLayers(clips, width, height, '#0d0f13');
  const frame = cw / ch;
  const img = DEMO_W / DEMO_H;
  const backdrop = makeImage(DEMO_A, { duration: Math.max(1, ...clips.map((c) => c.start + c.duration)), scale: Math.max(img / frame, frame / img), adjust: { brightness: -0.12, saturation: -0.25 } });
  return projectFromLayers([backdrop, ...clips], width, height, '#0d0f13', true);
}

/** The demo picture as a single full-frame layer. */
export function demoImageLayer(duration = 3, which: MediaAsset = DEMO_A): ReturnType<typeof makeImage> {
  return makeImage(which, { duration });
}

// ---------------------------------------------------------------------------------------------
// Renderer + job queue
// ---------------------------------------------------------------------------------------------

let compositor: Compositor | null = null;
let failed = false;

function render(project: Project, time: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (failed) return null;
  if (!compositor) {
    try {
      compositor = new Compositor(document.createElement('canvas'), { preserveDrawingBuffer: true });
    } catch (err) {
      console.warn('[thumbs] unavailable', err);
      failed = true;
      return null;
    }
  }
  compositor.setSize(project.settings.width, project.settings.height);
  compositor.render(project, time, demoProvider);
  return compositor.canvas;
}

/** Render one frame of a project straight into a 2D canvas. */
export function renderInto(target: HTMLCanvasElement, project: Project, time: number): boolean {
  const out = render(project, time);
  if (!out) return false;
  const ctx = target.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(out as CanvasImageSource, 0, 0, target.width, target.height);
  return true;
}

type Job = () => void;
const jobs: Job[] = [];
let pumping = false;

function pump(): void {
  pumping = true;
  requestAnimationFrame(() => {
    const start = performance.now();
    while (jobs.length && performance.now() - start < 7) jobs.shift()!();
    if (jobs.length) pump();
    else pumping = false;
  });
}

function enqueue(job: Job): () => void {
  jobs.push(job);
  if (!pumping) pump();
  return () => {
    const i = jobs.indexOf(job);
    if (i >= 0) jobs.splice(i, 1);
  };
}

const posterCache = new Map<string, ImageBitmap>();
const POSTER_CACHE_LIMIT = 600;

// ---------------------------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------------------------

export interface ThumbSpec {
  project: Project;
  /** Time shown while idle. */
  poster: number;
  /** Hover playback range (seconds). */
  from: number;
  to: number;
}

interface LiveThumbProps {
  /** Cache key; also identifies the content, so the tile re-renders when it changes. */
  id: string;
  /** Pixel size of the thumbnail canvas. */
  width: number;
  height: number;
  /** Built lazily, the first time the tile becomes visible. */
  build: () => ThumbSpec | null;
  /** Play on hover (default true). */
  animate?: boolean;
  /** Play continuously while visible. */
  autoplay?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A canvas showing a poster frame of a demo project, animating on hover. */
export const LiveThumb = memo(function LiveThumb({ id, width, height, build, animate = true, autoplay = false, className, style }: LiveThumbProps): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let spec: ThumbSpec | null | undefined;
    let cancelJob: (() => void) | null = null;
    let raf = 0;
    let visible = false;
    let hovering = false;
    let disposed = false;
    const getSpec = (): ThumbSpec | null => (spec === undefined ? (spec = buildRef.current()) : spec);

    const drawPoster = (): void => {
      const cached = posterCache.get(id);
      const ctx = canvas.getContext('2d');
      if (cached && ctx) {
        ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
        return;
      }
      cancelJob?.();
      cancelJob = enqueue(() => {
        cancelJob = null;
        if (disposed) return;
        const s = getSpec();
        if (!s || !renderInto(canvas, s.project, s.poster)) return;
        if (posterCache.size < POSTER_CACHE_LIMIT) {
          void createImageBitmap(canvas).then((bmp) => {
            if (!posterCache.has(id)) posterCache.set(id, bmp);
            else bmp.close();
          });
        }
      });
    };

    const play = (): void => {
      if (raf) return;
      const s = getSpec();
      if (!s) return;
      const t0 = performance.now();
      const span = Math.max(0.1, s.to - s.from);
      const step = (): void => {
        if (disposed || !(hovering || (autoplay && visible))) {
          raf = 0;
          drawPoster();
          return;
        }
        const t = s.from + (((performance.now() - t0) / 1000) % span);
        renderInto(canvas, s.project, t);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) {
          if (autoplay) play();
          else drawPoster();
        } else {
          cancelJob?.();
          cancelJob = null;
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);

    const onEnter = (): void => {
      if (!animate) return;
      hovering = true;
      play();
    };
    const onLeave = (): void => {
      hovering = false;
    };
    const host = canvas.parentElement ?? canvas;
    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointerleave', onLeave);

    return () => {
      disposed = true;
      io.disconnect();
      cancelJob?.();
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [id, animate, autoplay, width, height]);

  return <canvas ref={ref} width={width} height={height} className={className} style={style} />;
});
