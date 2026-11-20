/**
 * Motion clips: animations written as code (by Claude, or by hand) that Kinora renders frame by
 * frame as a transparent layer. Shared by the renderer (src/renderer/src/engine/media/motion.ts),
 * the sandboxed runtime (src/motion/runtime.ts), the main process and the Claude tools.
 * No runtime imports here.
 *
 * A clip is a `.kmotion` file: a JSON header in a leading block comment, then an ES module whose
 * default export sets the animation up and returns a render function.
 */

export const MOTION_EXT = 'kmotion';
/** Where the sandboxed runtime is served from (main process: protocol host "motion"). */
export const MOTION_ORIGIN = 'kinora://motion';
export const MOTION_FRAME_URL = `${MOTION_ORIGIN}/frame.html`;
/** Largest clip source accepted. */
export const MAX_MOTION_BYTES = 1024 * 1024;

export interface MotionMeta {
  name: string;
  /** Canvas size in pixels (defaults to the project's frame size). */
  width: number;
  height: number;
  /** Seconds in one loop of the animation. */
  duration: number;
  fps: number;
  /** Seed for Math.random / k.random(). */
  seed: number;
  /** Project images handed to the clip as k.images[name] (name → asset id). */
  images?: Record<string, string>;
  /** Settings shown in Kinora's inspector; the clip reads the chosen values as k.params[id]. */
  params?: MotionParam[];
}

// ---------------------------------------------------------------------------------------------
// Settings (k.params): what a clip lets people change without touching its code
// ---------------------------------------------------------------------------------------------

export type MotionParamType = 'text' | 'color' | 'number' | 'font' | 'toggle' | 'select' | 'image';
export type MotionValue = string | number | boolean;

/** Brand kit roles a setting can follow (Motion library, "Use my brand"). */
export type MotionBrandRole = 'primary' | 'secondary' | 'accent' | 'background' | 'text' | 'heading' | 'body' | 'logo' | 'name';

export interface MotionParam {
  /** Name in k.params (letters, digits, _). */
  id: string;
  type: MotionParamType;
  /** Label in the inspector. */
  label: string;
  /** text / color / font / select: a string; number: a number; toggle: a boolean; image: '' (none). */
  default: MotionValue;
  /** number */
  min?: number;
  max?: number;
  step?: number;
  /** number: shown after the value, e.g. " s" or "%". */
  suffix?: string;
  /** select */
  options?: string[];
  /** text: allow several lines. */
  multiline?: boolean;
  /** Filled from the brand kit when the clip is added with "Use my brand". */
  brand?: MotionBrandRole;
}

export const MOTION_PARAM_TYPES: MotionParamType[] = ['text', 'color', 'number', 'font', 'toggle', 'select', 'image'];
const BRAND_ROLES: MotionBrandRole[] = ['primary', 'secondary', 'accent', 'background', 'text', 'heading', 'body', 'logo', 'name'];
const PARAM_ID = /^[A-Za-z_][\w]{0,40}$/;
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([^()]{1,60}\)|transparent)$/i;
/** Most settings a clip can declare. */
export const MAX_MOTION_PARAMS = 24;
const MAX_TEXT = 2000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Is `v` a usable value for setting `p`? */
function validValue(p: MotionParam, v: unknown): boolean {
  switch (p.type) {
    case 'text':
      return typeof v === 'string' && v.length <= MAX_TEXT;
    case 'color':
      return typeof v === 'string' && COLOR.test(v.trim());
    case 'number':
      return finite(v);
    case 'font':
      return typeof v === 'string' && MOTION_FONTS.includes(v);
    case 'toggle':
      return typeof v === 'boolean';
    case 'select':
      return typeof v === 'string' && (p.options ?? []).includes(v);
    case 'image':
      return typeof v === 'string' && v.length <= 80;
  }
}

/** Keep the valid settings of a header (unknown types, bad ids and duplicates are dropped). */
export function normalizeMotionParams(raw: unknown): MotionParam[] {
  if (!Array.isArray(raw)) return [];
  const out: MotionParam[] = [];
  for (const item of raw) {
    if (out.length >= MAX_MOTION_PARAMS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const type = r.type as MotionParamType;
    if (!PARAM_ID.test(id) || !MOTION_PARAM_TYPES.includes(type) || out.some((p) => p.id === id)) continue;
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 60) : id;
    const p: MotionParam = { id, type, label, default: '' };
    if (type === 'number') {
      let min = finite(r.min) ? r.min : 0;
      let max = finite(r.max) ? r.max : Math.max(min + 1, 100);
      if (max < min) [min, max] = [max, min];
      p.min = min;
      p.max = max;
      p.step = finite(r.step) && r.step > 0 ? r.step : max - min <= 2 ? 0.01 : max - min <= 20 ? 0.1 : 1;
      if (typeof r.suffix === 'string' && r.suffix.length <= 8) p.suffix = r.suffix;
    }
    if (type === 'select') {
      const opts = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string' && o.length > 0 && o.length <= 60) : [];
      p.options = [...new Set(opts)].slice(0, 40);
      if (!p.options.length) continue;
    }
    if (type === 'text' && r.multiline === true) p.multiline = true;
    if (typeof r.brand === 'string' && BRAND_ROLES.includes(r.brand as MotionBrandRole)) p.brand = r.brand as MotionBrandRole;
    p.default = validValue(p, r.default) ? (r.default as MotionValue) : fallbackValue(p);
    if (type === 'number') p.default = Math.min(p.max!, Math.max(p.min!, p.default as number));
    out.push(p);
  }
  return out;
}

function fallbackValue(p: MotionParam): MotionValue {
  switch (p.type) {
    case 'text':
      return '';
    case 'color':
      return '#ffffff';
    case 'number':
      return p.min ?? 0;
    case 'font':
      return 'Inter Variable';
    case 'toggle':
      return false;
    case 'select':
      return p.options?.[0] ?? '';
    case 'image':
      return '';
  }
}

/** The values a clip runs with: each setting's chosen value when valid, else its default. */
export function motionParamValues(params: MotionParam[] | undefined, chosen: Record<string, unknown> | undefined): Record<string, MotionValue> {
  const out: Record<string, MotionValue> = {};
  for (const p of params ?? []) {
    const v = chosen?.[p.id];
    if (v !== undefined && validValue(p, v)) out[p.id] = p.type === 'number' ? Math.min(p.max!, Math.max(p.min!, v as number)) : (v as MotionValue);
    else out[p.id] = p.default;
  }
  return out;
}

/** Chosen values that differ from the defaults (what a project stores). */
export function changedMotionValues(params: MotionParam[] | undefined, chosen: Record<string, unknown> | undefined): Record<string, MotionValue> {
  const all = motionParamValues(params, chosen);
  const out: Record<string, MotionValue> = {};
  for (const p of params ?? []) if (all[p.id] !== p.default) out[p.id] = all[p.id];
  return out;
}

/** Stable key for a set of values (cache key: a change restarts the clip). */
export function motionValuesKey(values: Record<string, unknown> | undefined): string {
  if (!values) return '';
  const keys = Object.keys(values).sort();
  return keys.length ? JSON.stringify(keys.map((k) => [k, values[k]])) : '';
}

const HEADER_TAG = 'kinora-motion';

/** Read the header of a .kmotion file; the code is everything after it. */
export function parseMotionFile(text: string): { meta: Partial<MotionMeta>; code: string } {
  const src = text.replace(/^﻿/, '');
  const m = /^\s*\/\*\s*kinora-motion\s*([\s\S]*?)\*\/\r?\n?/.exec(src);
  if (!m) return { meta: {}, code: src };
  let meta: Partial<MotionMeta> = {};
  try {
    const parsed: unknown = JSON.parse(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Partial<MotionMeta>;
  } catch {
    /* an unreadable header: defaults apply */
  }
  return { meta, code: src.slice(m[0].length) };
}

/** Write a .kmotion file: header + code. */
export function serializeMotionFile(meta: MotionMeta, code: string): string {
  const header = JSON.stringify(meta, null, 2).replace(/\*\//g, '* /');
  return `/* ${HEADER_TAG}\n${header}\n*/\n${code.replace(/^\s*\/\*\s*kinora-motion[\s\S]*?\*\/\r?\n?/, '')}`;
}

/** Fill in missing / invalid header values. */
export function normalizeMotionMeta(meta: Partial<MotionMeta>, defaults: { width: number; height: number; fps: number; name?: string }): MotionMeta {
  const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const images: Record<string, string> = {};
  if (meta.images && typeof meta.images === 'object') for (const [k, v] of Object.entries(meta.images)) if (/^[A-Za-z_$][\w$]{0,40}$/.test(k) && typeof v === 'string') images[k] = v;
  const params = normalizeMotionParams(meta.params);
  return {
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 80) : (defaults.name ?? 'Motion'),
    width: Math.round(num(meta.width, 16, 4096, defaults.width)),
    height: Math.round(num(meta.height, 16, 4096, defaults.height)),
    duration: num(meta.duration, 0.1, 600, 5),
    fps: num(meta.fps, 1, 120, defaults.fps),
    seed: Math.round(num(meta.seed, 0, 2 ** 31 - 1, 1)),
    ...(Object.keys(images).length ? { images } : {}),
    ...(params.length ? { params } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Libraries and fonts available to clips
// ---------------------------------------------------------------------------------------------

export interface MotionLibrary {
  /** Import specifier(s), e.g. "three". */
  imports: string[];
  name: string;
  license: string;
  use: string;
}

export const MOTION_LIBRARIES: MotionLibrary[] = [
  { imports: ['three', 'three/addons/…'], name: 'three.js', license: 'MIT', use: '3D scenes, materials, lights, post-processing (bloom, film, glitch, bokeh, halftone, pixelate), rounded boxes, SVG and glTF loading, thick lines, sky.' },
  { imports: ['gsap', 'gsap/SplitText', 'gsap/MorphSVGPlugin', 'gsap/DrawSVGPlugin', 'gsap/MotionPathPlugin', 'gsap/CustomEase', 'gsap/…'], name: 'GSAP + plugins', license: 'GSAP Standard License', use: 'Timelines and tweens. Tweens and timelines created in setup follow the clip clock automatically, so plain gsap.to / gsap.timeline() calls are frame-accurate. Use named imports.' },
  { imports: ['pixi.js'], name: 'PixiJS', license: 'MIT', use: 'Fast 2D WebGL: sprites, graphics, text, filters. Create it with await k.pixi(PIXI).' },
  { imports: ['animejs'], name: 'anime.js', license: 'MIT', use: 'Tweens and timelines on plain objects: create with autoplay: false and call .seek(t * 1000) in render.' },
  { imports: ['d3'], name: 'D3', license: 'ISC', use: 'Scales, shapes, paths, interpolators, colour, data layouts for animated charts.' },
  { imports: ['matter-js'], name: 'Matter.js', license: 'MIT', use: '2D physics. Simulate in setup with k.bake(), then look the state up in render.' },
  { imports: ['p5'], name: 'p5.js', license: 'LGPL-2.1', use: 'Generative art in instance mode (noLoop, redraw in render); return its canvas.' },
  { imports: ['lottie-web'], name: 'Lottie', license: 'MIT', use: 'Lottie JSON animations on canvas (renderer "canvas", goToAndStop(t * 1000)).' },
  { imports: ['simplex-noise'], name: 'simplex-noise', license: 'MIT', use: 'Smooth noise for organic motion: createNoise2D(k.random).' },
  { imports: ['roughjs'], name: 'Rough.js', license: 'MIT', use: 'Hand-drawn, sketchy shapes on a 2D canvas.' },
];

/** Typefaces available in clips (CSS family names); load before drawing with k.font(). */
export const MOTION_FONTS = [
  'Inter Variable',
  'Montserrat Variable',
  'Raleway Variable',
  'Rubik Variable',
  'Space Grotesk Variable',
  'Syne Variable',
  'Oswald Variable',
  'Playfair Display Variable',
  'Dancing Script Variable',
  'Caveat Variable',
  'JetBrains Mono Variable',
  'Poppins',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Righteous',
  'Bangers',
  'Shrikhand',
  'Press Start 2P',
  'DM Serif Display',
  'Abril Fatface',
  'Lobster',
  'Pacifico',
  'Permanent Marker',
];

// ---------------------------------------------------------------------------------------------
// Examples (also used by the tests: every example must load and render without errors)
// ---------------------------------------------------------------------------------------------

export const MOTION_EXAMPLES: { name: string; about: string; duration: number; params?: MotionParam[]; code: string }[] = [
  {
    name: 'Kinetic title',
    about: '2D canvas + GSAP: words rise in with a stagger, an underline draws, everything eases out. The words, colours, font and speed are settings.',
    duration: 4,
    params: [
      { id: 'title', type: 'text', label: 'Title', default: 'MAKE IT MOVE', brand: 'name' },
      { id: 'color', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'accent', type: 'color', label: 'Underline', default: '#5ce3df', brand: 'accent' },
      { id: 'font', type: 'font', label: 'Font', default: 'Montserrat Variable', brand: 'heading' },
      { id: 'speed', type: 'number', label: 'Speed', default: 1, min: 0.5, max: 2, step: 0.05, suffix: '×' },
    ],
    code: `import { gsap } from 'gsap';

export default async function setup(k) {
  const { title, color, accent, font, speed } = k.params;
  const s = k.height / 1080;
  const ctx = k.ctx2d();
  const words = title.split(/\\s+/).filter(Boolean).map((text) => ({ text, y: 60 * s, o: 0 }));
  await k.font(\`800 100px "\${font}"\`);
  const size = k.fitText(ctx, title, k.width * 0.8, (px) => \`800 \${px}px "\${font}"\`, { max: 140 * s });
  const line = { w: 0 };
  const tl = gsap.timeline({ paused: true });
  tl.to(words, { y: 0, o: 1, duration: 0.9, ease: 'expo.out', stagger: 0.12 })
    .to(line, { w: 1, duration: 0.8, ease: 'power3.inOut' }, 0.5)
    .to(words, { y: -40 * s, o: 0, duration: 0.6, ease: 'power2.in', stagger: 0.05 }, 3.2);

  return (t) => {
    tl.seek(Math.min(t * speed, tl.duration()));
    ctx.clearRect(0, 0, k.width, k.height);
    ctx.font = \`800 \${size}px "\${font}"\`;
    ctx.textBaseline = 'middle';
    const gap = size * 0.28;
    const widths = words.map((w) => ctx.measureText(w.text).width);
    const total = widths.reduce((a, b) => a + b + gap, -gap);
    let x = (k.width - total) / 2;
    words.forEach((w, i) => {
      ctx.globalAlpha = w.o;
      ctx.fillStyle = color;
      ctx.fillText(w.text, x, k.height / 2 + w.y);
      x += widths[i] + gap;
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    const lw = Math.min(total, 520 * s) * line.w;
    ctx.fillRect((k.width - lw) / 2, k.height / 2 + size * 0.72, lw, 10 * s);
  };
}
`,
  },
  {
    name: '3D rounded box with bloom',
    about: 'three.js: a glossy rounded box turns under coloured lights, with a bloom pass.',
    duration: 6,
    code: `import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export default function setup(k) {
  const renderer = k.three(THREE);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, k.width / k.height, 0.1, 100);
  camera.position.set(0, 0.6, 6);
  const box = new THREE.Mesh(
    new RoundedBoxGeometry(1.6, 1.6, 1.6, 6, 0.25),
    new THREE.MeshStandardMaterial({ color: '#16c4c9', metalness: 0.35, roughness: 0.25 }),
  );
  scene.add(box);
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));
  const key = new THREE.PointLight('#9d85ff', 60);
  key.position.set(3, 3, 3);
  scene.add(key);
  const rim = new THREE.PointLight('#5ce3df', 40);
  rim.position.set(-3, -1, -2);
  scene.add(rim);
  const composer = new EffectComposer(renderer);
  composer.setSize(k.width, k.height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(k.width, k.height), 0.6, 0.4, 0.2));
  composer.addPass(new OutputPass());

  return (t) => {
    const p = k.ease.inOutCubic(k.progress(t, 0, k.duration));
    box.rotation.set(0.5 + p * Math.PI * 0.6, p * Math.PI * 2, 0);
    box.scale.setScalar(0.6 + 0.4 * k.ease.outBack(k.progress(t, 0, 0.8)));
    composer.render();
  };
}
`,
  },
  {
    name: 'Animated bar chart',
    about: 'D3 scales + 2D canvas: bars grow in one after another with values counting up.',
    duration: 5,
    code: `import * as d3 from 'd3';

export default async function setup(k) {
  await k.font('700 40px "Inter Variable"');
  const ctx = k.ctx2d();
  const data = [
    { label: 'Mon', value: 42 }, { label: 'Tue', value: 67 }, { label: 'Wed', value: 54 },
    { label: 'Thu', value: 88 }, { label: 'Fri', value: 73 },
  ];
  const m = { top: 160, right: 160, bottom: 140, left: 160 };
  const x = d3.scaleBand().domain(data.map((d) => d.label)).range([m.left, k.width - m.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, 100]).range([k.height - m.bottom, m.top]);

  return (t) => {
    ctx.clearRect(0, 0, k.width, k.height);
    data.forEach((d, i) => {
      const p = k.ease.outExpo(k.progress(t, 0.3 + k.stagger(i, 0.18), 1.6 + k.stagger(i, 0.18)));
      const v = d.value * p;
      const top = y(v);
      ctx.fillStyle = i === 3 ? '#5ce3df' : 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.roundRect(x(d.label), top, x.bandwidth(), y(0) - top, [14, 14, 0, 0]);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '700 40px "Inter Variable"';
      ctx.fillText(String(Math.round(v)), x(d.label) + x.bandwidth() / 2, top - 22);
      ctx.font = '500 32px "Inter Variable"';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(d.label, x(d.label) + x.bandwidth() / 2, y(0) + 56);
    });
  };
}
`,
  },
];

// ---------------------------------------------------------------------------------------------
// Guide (what Claude reads before writing a clip)
// ---------------------------------------------------------------------------------------------

export function motionGuide(): string {
  const libs = MOTION_LIBRARIES.map((l) => `- ${l.imports.map((i) => `\`${i}\``).join(', ')}: ${l.name} (${l.license}). ${l.use}`).join('\n');
  const examples = MOTION_EXAMPLES.map((e) => `### ${e.name} (${e.duration} s)\n${e.about}\n${e.params?.length ? `\nparams: ${JSON.stringify(e.params)}\n` : ''}\n\`\`\`js\n${e.code}\`\`\``).join('\n\n');
  return `# Kinora Motion clips

A Motion clip is a JavaScript ES module that draws an animation onto a transparent canvas. Kinora renders it frame by frame, exactly, as a layer on the timeline: it can be moved, scaled, trimmed, layered over video and exported like any clip. Create one with create_motion, change it with update_motion, read it back with get_motion.

## The module

\`\`\`js
export default async function setup(k) {   // runs once (may be async)
  const ctx = k.ctx2d();                     // or k.three(THREE), await k.pixi(PIXI), your own canvas
  return (t) => {                            // called for every frame, t in seconds, 0 ≤ t < duration
    ctx.clearRect(0, 0, k.width, k.height);
    // draw the frame at time t
  };
}
\`\`\`

- Render frames in ANY order (scrubbing, export): a frame must depend only on t, never on the previous call. Keep animation state as functions of t (k.progress / k.tween / k.ease), or in GSAP timelines (driven by the clip clock), or precompute with k.bake().
- Draw on \`k.canvas\` (k.width × k.height pixels, transparent background). To show a canvas a library created (p5, Lottie, your own), return \`{ canvas, render }\` instead of a function.
- The background stays transparent unless you paint it, so a clip can sit over video. Paint a full-frame background for a stand-alone scene.
- render may be async (await inside it), but keep frames fast: well under 50 ms at 1080p.
- Time is virtual: performance.now(), Date.now() and requestAnimationFrame follow the clip clock; Math.random is seeded (repeatable). setTimeout / setInterval are not frame-accurate: don't animate with them.
- Sandbox: no network, no access to Kinora or the user's files. Only the canvas is captured (HTML elements are not rendered; for SVG, build an <svg> element and \`await k.drawSVG(svg)\` in render).
- Errors in setup or render are reported back to you with the message: fix and call update_motion.

## The kit (k)

- \`k.width\`, \`k.height\`, \`k.duration\`, \`k.fps\`, \`k.seed\`, \`k.canvas\`
- \`k.ctx2d()\`: the canvas' 2D context.
- \`k.three(THREE, { antialias = true })\`: a WebGLRenderer on k.canvas (transparent, sized, sRGB, preserveDrawingBuffer). Use with EffectComposer for post-processing.
- \`await k.pixi(PIXI)\`: a PixiJS Application on k.canvas (no ticker; Kinora renders it after your render function).
- \`k.progress(t, start, end)\`: 0..1 progress of t between start and end (clamped).
- \`k.tween(t, times, values, ease?)\`: keyframes, e.g. k.tween(t, [0, 1, 3], [0, 400, 0], 'inOutCubic').
- \`k.ease.<name>(x)\`: linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, inQuart, outQuart, inOutQuart, inExpo, outExpo, inOutExpo, inBack, outBack, inOutBack, outElastic, outBounce, inSine, outSine, inOutSine.
- \`k.spring(x, { stiffness = 120, damping = 12 })\`: overshooting 0→1 spring for progress x (seconds).
- \`k.stagger(i, each, from = 0)\`: delay for item i.
- \`k.lerp(a, b, x)\`, \`k.clamp(x, lo = 0, hi = 1)\`, \`k.mix(colorA, colorB, x)\` (CSS colours).
- \`k.random()\`: seeded random 0..1; \`k.rand(i, salt?)\`: stable random 0..1 for an index (use in render).
- \`await k.font('700 96px "Montserrat Variable"')\`: load a typeface before drawing text with it, once for every weight you draw with (static fonts such as Poppins load each weight separately; a weight that is not loaded makes frames differ).
- \`k.fitText(ctx, text, maxWidth, size => '700 ' + size + 'px "Inter Variable"')\`: largest size that fits.
- \`k.bake(step, { fps })\`: run a simulation once (step(i, dt) returns a snapshot for frame i), then \`bake.at(t)\` returns the snapshot for t. Use for physics.
- \`await k.drawSVG(svgElement, ctx?)\`: rasterise an SVG element into the canvas.
- \`k.images.<name>\`: project images passed with create_motion's images parameter (ImageBitmap).
- \`k.params.<id>\`: the value of each setting (see below), always filled in (the default when the user has not changed it).

## Settings (k.params): let the user change the clip without code

Declare the things people will want to change (the words, colours, font, speed, a logo…) with create_motion's \`params\` and read them from \`k.params\` in setup. Kinora shows them in its inspector; changing one restarts the clip with the new values, so read them once in setup. Always declare settings for the visible text and the main colours.

Each setting: \`{ "id": "title", "type": "text", "label": "Title", "default": "Summer Sale" }\`. Types:
- \`text\` (string; \`"multiline": true\` for several lines)
- \`color\` (CSS colour string, e.g. "#ff6b35")
- \`number\` (\`min\`, \`max\`, \`step\`, optional \`suffix\` like " s" or "%"), e.g. a speed multiplier
- \`font\` (one of the font names below; load it with \`await k.font('700 100px "' + k.params.font + '"')\`)
- \`toggle\` (boolean)
- \`select\` (\`options\`: list of strings)
- \`image\` (a picture the user picks from the project: \`k.params.<id>\` is an ImageBitmap, or null when none is chosen)

Optional \`"brand"\` links a setting to the user's brand kit: "primary", "secondary", "accent", "background", "text" (colours), "heading", "body" (fonts), "logo" (image), "name" (text). Speed: multiply time, e.g. \`const s = k.params.speed; return (t) => draw(Math.min(t * s, k.duration))\`.

## Libraries (import by name; all bundled, offline)

${libs}

three.js addons available under \`three/addons/…\` (same paths as three's examples): postprocessing/EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, FilmPass, GlitchPass, AfterimagePass, BokehPass, HalftonePass, RenderPixelatedPass, DotScreenPass, SMAAPass; geometries/RoundedBoxGeometry, ParametricGeometry, ConvexGeometry; loaders/GLTFLoader, SVGLoader; lines/Line2, LineMaterial, LineGeometry; objects/Sky; environments/RoomEnvironment; math/SimplexNoise, ImprovedNoise; utils/BufferGeometryUtils; shaders/RGBShiftShader, VignetteShader, FXAAShader, CopyShader. For text in 3D, draw it on a canvas and use a THREE.CanvasTexture.

GSAP plugins (named imports from \`gsap/<Plugin>\`): SplitText, MorphSVGPlugin, DrawSVGPlugin, MotionPathPlugin, CustomEase, CustomBounce, CustomWiggle, EasePack, TextPlugin, ScrambleTextPlugin, Physics2DPlugin, PhysicsPropsPlugin, PixiPlugin. All are registered already.

## Fonts

${MOTION_FONTS.map((f) => `"${f}"`).join(', ')}. Variable fonts accept any weight 100–900.

## Examples

${examples}
`;
}
