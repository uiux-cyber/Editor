/**
 * Kinora Motion runtime: runs inside the sandboxed frame kinora://motion/frame.html (opaque origin,
 * no network, no access to Kinora). It loads one clip module, then renders the frames Kinora asks
 * for and hands each one back as an ImageBitmap.
 *
 * Determinism: the clip sees a virtual clock. performance.now(), Date.now() and
 * requestAnimationFrame follow the requested frame time; Math.random is seeded; library clocks
 * (GSAP, anime.js) are driven from here (bundles register through globalThis.__kinoraMotion).
 */

type Images = Record<string, ImageBitmap>;
interface Meta {
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed: number;
}
type Render = (t: number) => void | Promise<void>;
type Values = Record<string, string | number | boolean | ImageBitmap | null>;
interface Msg {
  __kinoraMotion: true;
  id: number;
  type: 'init' | 'render';
  code?: string;
  meta?: Meta;
  images?: Images;
  /** Settings (k.params), image settings already resolved to pictures. */
  params?: Values;
  t?: number;
}

const post = (msg: Record<string, unknown>, transfer: Transferable[] = []): void => parent.postMessage({ __kinoraMotion: true, ...msg }, '*', transfer);

// ---------------------------------------------------------------------------------------------
// Virtual clock, seeded randomness, captured console
// ---------------------------------------------------------------------------------------------

let nowMs = 0;
const EPOCH = Date.UTC(2026, 0, 1);
performance.now = () => nowMs;
Date.now = () => EPOCH + nowMs;

let rafSeq = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>();
window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  rafCallbacks.set(++rafSeq, cb);
  return rafSeq;
};
window.cancelAnimationFrame = (id: number): void => void rafCallbacks.delete(id);
function flushAnimationFrames(): void {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(nowMs);
}

// Same results on every PC: libraries that read the language (p5's messages) see en-US.
Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });

const timeHooks = new Set<(t: number) => void>();
(globalThis as unknown as { __kinoraMotion: unknown }).__kinoraMotion = {
  /** Library bundles (GSAP, anime.js) register their clock here. */
  onTime: (fn: (t: number) => void) => timeHooks.add(fn),
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    post({ type: 'log', level, text: args.map(fmt).join(' ').slice(0, 2000) });
    orig(...args);
  };
}

/** "message (line 12:5)", with the line in the clip's own code. */
function describe(err: unknown): string {
  const e = err instanceof Error ? err : new Error(fmt(err));
  const where = /blob:[^\s)]*?:(\d+):(\d+)/.exec(e.stack ?? '');
  const name = e.name && e.name !== 'Error' ? `${e.name}: ` : '';
  return `${name}${e.message}${where ? ` (line ${where[1]}:${where[2]})` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// The kit handed to setup(k)
// ---------------------------------------------------------------------------------------------

const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const outBounce = (x: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const ease: Record<string, (x: number) => number> = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  inBack: (x) => c3 * x ** 3 - c1 * x * x,
  outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inOutBack: (x) => (x < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  outBounce,
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};
const easeOf = (e: unknown): ((x: number) => number) => (typeof e === 'function' ? (e as (x: number) => number) : (ease[String(e ?? 'linear')] ?? ease.linear));

const probe = document.createElement('canvas').getContext('2d')!;
function rgba(color: string): [number, number, number, number] {
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  const s = probe.fillStyle;
  if (s.startsWith('#')) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  const m = /rgba?\(([^)]+)\)/.exec(s);
  const p = m ? m[1].split(',').map((v) => parseFloat(v)) : [0, 0, 0, 1];
  return [p[0], p[1], p[2], p[3] ?? 1];
}

function makeKit(meta: Meta, canvas: HTMLCanvasElement, images: Images, params: Values) {
  let ctx2d: CanvasRenderingContext2D | null = null;
  const kit = {
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    fps: meta.fps,
    seed: meta.seed,
    canvas,
    images,
    params: Object.freeze({ ...params }),
    ease,
    clamp,
    lerp,
    /** Set by k.pixi(): rendered after each render call. */
    _after: null as null | (() => void),
    ctx2d(): CanvasRenderingContext2D {
      ctx2d ??= canvas.getContext('2d', { alpha: true })!;
      return ctx2d;
    },
    three(THREE: Record<string, any>, opts: { antialias?: boolean } = {}) {
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: opts.antialias ?? true, preserveDrawingBuffer: true, premultipliedAlpha: true });
      r.setPixelRatio(1);
      r.setSize(meta.width, meta.height, false);
      r.setClearColor(0x000000, 0);
      if (THREE.SRGBColorSpace) r.outputColorSpace = THREE.SRGBColorSpace;
      return r;
    },
    async pixi(PIXI: Record<string, any>, opts: Record<string, unknown> = {}) {
      const app = new PIXI.Application();
      await app.init({ canvas, width: meta.width, height: meta.height, backgroundAlpha: 0, antialias: true, autoStart: false, sharedTicker: false, resolution: 1, autoDensity: false, preference: 'webgl', preserveDrawingBuffer: true, ...opts });
      app.ticker?.stop();
      kit._after = () => app.render();
      return app;
    },
    progress: (t: number, start: number, end: number): number => (end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start))),
    tween(t: number, times: number[], values: number[], e?: unknown): number {
      if (!times.length) return 0;
      if (t <= times[0]) return values[0];
      for (let i = 1; i < times.length; i++) {
        if (t <= times[i]) return lerp(values[i - 1], values[i], easeOf(e)((t - times[i - 1]) / Math.max(1e-9, times[i] - times[i - 1])));
      }
      return values[values.length - 1];
    },
    spring(x: number, o: { stiffness?: number; damping?: number; mass?: number } = {}): number {
      if (x <= 0) return 0;
      const k = o.stiffness ?? 120;
      const c = o.damping ?? 12;
      const m = o.mass ?? 1;
      const w0 = Math.sqrt(k / m);
      const zeta = c / (2 * Math.sqrt(k * m));
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * x) * (Math.cos(wd * x) + ((zeta * w0) / wd) * Math.sin(wd * x));
      }
      return 1 - Math.exp(-w0 * x) * (1 + w0 * x);
    },
    stagger: (i: number, each: number, from = 0): number => from + i * each,
    mix(a: string, b: string, x: number): string {
      const p = rgba(a);
      const q = rgba(b);
      const v = p.map((pv, i) => lerp(pv, q[i], clamp(x)));
      return `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${v[3].toFixed(3)})`;
    },
    random: (): number => Math.random(),
    rand(i: number, salt = 0): number {
      let h = (Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((salt | 0) + meta.seed, 0xc2b2ae35)) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },
    async font(spec: string): Promise<boolean> {
      try {
        const faces = await document.fonts.load(spec);
        return faces.length > 0;
      } catch {
        return false;
      }
    },
    fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontFor: (size: number) => string, range: { min?: number; max?: number } = {}): number {
      let lo = range.min ?? 8;
      let hi = range.max ?? 600;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        ctx.font = fontFor(mid);
        if (ctx.measureText(text).width <= maxWidth) lo = mid;
        else hi = mid;
      }
      ctx.font = fontFor(lo);
      return lo;
    },
    bake<T>(step: (i: number, dt: number) => T, o: { fps?: number } = {}) {
      const fps = o.fps ?? meta.fps;
      const n = Math.max(1, Math.ceil(meta.duration * fps) + 1);
      const frames: T[] = [];
      for (let i = 0; i < n; i++) frames.push(step(i, 1 / fps));
      return { frames, fps, at: (t: number): T => frames[Math.min(n - 1, Math.max(0, Math.round(t * fps)))] };
    },
    async drawSVG(svg: SVGSVGElement | string, ctx?: CanvasRenderingContext2D, x = 0, y = 0, w = meta.width, h = meta.height): Promise<void> {
      const target = ctx ?? kit.ctx2d();
      let text = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
      if (!/xmlns=/.test(text)) text = text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        target.drawImage(img, x, y, w, h);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
  return kit;
}

// ---------------------------------------------------------------------------------------------
// Messages from Kinora (handled one at a time)
// ---------------------------------------------------------------------------------------------

let render: Render | null = null;
let output: HTMLCanvasElement | OffscreenCanvas | null = null;
let after: (() => void) | null = null;
let kitRef: ReturnType<typeof makeKit> | null = null;

async function init(msg: Msg): Promise<void> {
  const meta = msg.meta!;
  Math.random = mulberry32(meta.seed || 1);
  nowMs = 0;
  rafCallbacks.clear();
  const canvas = document.createElement('canvas');
  canvas.width = meta.width;
  canvas.height = meta.height;
  const kit = makeKit(meta, canvas, msg.images ?? {}, msg.params ?? {});
  kitRef = kit;
  const url = URL.createObjectURL(new Blob([msg.code ?? ''], { type: 'text/javascript' }));
  let mod: { default?: unknown };
  try {
    mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  } finally {
    URL.revokeObjectURL(url);
  }
  if (typeof mod.default !== 'function') throw new Error('The clip must `export default function setup(k) { … }`.');
  const result: unknown = await (mod.default as (k: unknown) => unknown)(kit);
  if (typeof result === 'function') {
    render = result as Render;
    output = canvas;
  } else if (result && typeof (result as { render?: unknown }).render === 'function') {
    render = (result as { render: Render }).render;
    output = (result as { canvas?: HTMLCanvasElement | OffscreenCanvas }).canvas ?? canvas;
  } else {
    throw new Error('setup(k) must return a render function `(t) => { … }` or `{ render, canvas }`.');
  }
  after = kit._after;
}

/** Step-by-step timing of each frame, posted as 'trace' logs when Kinora asks for it (diagnostics). */
let tracing = false;
const trace = (text: string): void => {
  if (tracing) post({ type: 'log', level: 'trace', text: `${Math.round(performance.now())} ${text}` });
};

async function renderAt(t: number): Promise<ImageBitmap> {
  if (!render || !output) throw new Error('The clip is not loaded.');
  nowMs = t * 1000;
  trace(`frame ${t.toFixed(3)}: start`);
  for (const hook of timeHooks) hook(t);
  flushAnimationFrames();
  await render(t);
  (after ?? kitRef?._after)?.();
  trace(`frame ${t.toFixed(3)}: drawn`);
  const bitmap = await createImageBitmap(output);
  trace(`frame ${t.toFixed(3)}: captured`);
  return bitmap;
}

let chain: Promise<void> = Promise.resolve();
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== parent) return;
  const msg = e.data as Msg;
  if (!msg || msg.__kinoraMotion !== true) return;
  if ((msg as { trace?: boolean }).trace) tracing = true;
  trace(`received ${msg.type} #${msg.id}`);
  chain = chain.then(async () => {
    if (msg.type === 'init') {
      try {
        await init(msg);
        post({ type: 'init', id: msg.id, ok: true });
      } catch (err) {
        post({ type: 'init', id: msg.id, ok: false, error: describe(err) });
      }
    } else if (msg.type === 'render') {
      try {
        const bitmap = await renderAt(msg.t ?? 0);
        post({ type: 'frame', id: msg.id, t: msg.t, bitmap }, [bitmap]);
      } catch (err) {
        post({ type: 'frame', id: msg.id, t: msg.t, error: describe(err) });
      }
    }
  });
});
window.addEventListener('error', (e) => post({ type: 'log', level: 'error', text: describe(e.error ?? e.message) }));
window.addEventListener('unhandledrejection', (e) => post({ type: 'log', level: 'error', text: describe(e.reason) }));

post({ type: 'ready' });
