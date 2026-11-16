/**
 * Contracts for Kinora's content packs. Each pack is plain data + small pure functions that the
 * engine consumes through the registries in `library/index.ts`.
 *
 * GLSL conventions (GLSL ES 3.00, WebGL2)
 * ---------------------------------------
 * - Snippets are *bodies*: do not write `#version`, `precision`, `in`/`out` or `main()`.
 * - Every param in `params` is auto-declared as a uniform named after its `key`:
 *     float / int / select / bool → `uniform float <key>;`   (bool is 0.0 or 1.0, int is rounded)
 *     color                       → `uniform vec3 <key>;`    (sRGB, 0..1)
 *   Never declare those uniforms yourself, and never name a param with a `u_` or `gl_` prefix.
 * - All colours are premultiplied-alpha RGBA.
 * - The following helpers are always available in every snippet:
 *     float hash11(float), float hash21(vec2), vec2 hash22(vec2),
 *     float vnoise(vec2)  (value noise, 0..1), float fbm(vec2) (4 octaves, 0..1),
 *     vec3 rgb2hsv(vec3), vec3 hsv2rgb(vec3), float luma(vec3),
 *     mat2 rot2(float radians), const float PI, const float TAU
 */

import type { ClipAnimations, Clip, Grade, MediaAsset, ParamValue, TextStyle } from '@/core/types';
import type { BundledFontFamily } from './fonts';

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

export interface ParamDef {
  /** GLSL-safe identifier (letters, digits, underscore; must not start with `u_` or `gl_`). */
  key: string;
  label: string;
  type: 'float' | 'int' | 'bool' | 'color' | 'select';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  /** For `select`: the numeric value is passed to the shader. */
  options?: { label: string; value: number }[];
  unit?: string;
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

export type TransitionCategory = 'basic' | 'wipe' | 'slide' | 'zoom' | 'blur' | 'glitch' | 'light' | 'shape' | 'distort' | '3d' | 'stylized';

/**
 * A transition between an outgoing and an incoming picture.
 *
 * `glsl` must define:
 *     vec4 transition(vec2 uv)
 * Available: `uniform float progress;` (0 → 1), `uniform float ratio;` (width / height),
 * `vec4 getFromColor(vec2 uv)`, `vec4 getToColor(vec2 uv)`.
 * `uv` is 0..1 with the origin at the BOTTOM-LEFT (y up), exactly like gl-transitions.
 * At progress 0 the result must equal getFromColor(uv); at progress 1, getToColor(uv).
 */
export interface TransitionDef {
  id: string;
  name: string;
  category: TransitionCategory;
  glsl: string;
  params?: ParamDef[];
  /** Suggested duration in seconds (default 0.6). */
  duration?: number;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export type EffectCategory = 'blur' | 'stylize' | 'distort' | 'glitch' | 'retro' | 'light' | 'color' | 'motion';

/**
 * A full-frame post effect applied to a layer (or, on an adjustment layer, to everything below).
 *
 * `glsl` must define:
 *     vec4 effect(vec2 uv)
 * `uv` is 0..1 with the origin at the TOP-LEFT (y down).
 * Available uniforms:
 *     sampler2D u_tex   – the input picture (premultiplied). Sample it with the helpers:
 *                           `tex(uv)`  – clamps to the edge pixels outside 0..1 (use for blurs)
 *                           `texZ(uv)` – transparent outside 0..1 (use when moving the picture)
 *                           `texM(uv)` – mirrored repeat outside 0..1
 *     sampler2D u_orig  – the untouched input of pass 0 (only differs from u_tex when passes > 1);
 *                         helper `orig(uv)`
 *     vec2  u_res       – render target size in real pixels
 *     float u_px        – real pixels per design pixel. Express every size parameter in design
 *                         pixels and convert with `u_px` so previews and exports match:
 *                         `vec2 off = vec2(radius * u_px) / u_res;`
 *     float u_time      – seconds since the start of the clip
 *     float u_progress  – 0..1 position inside the clip
 *     float u_aspect    – width / height
 *     int   u_pass      – current pass index (0-based) when `passes` > 1
 * The returned colour must be premultiplied. An effect must be an identity (return tex(uv)) when
 * its main "amount"-style parameter is 0 wherever that makes sense.
 */
export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  glsl: string;
  params: ParamDef[];
  /** Number of sequential passes (default 1). Use 2 for separable blurs: pass 0 = X, pass 1 = Y. */
  passes?: number;
  /** True if the picture changes over time even with constant params (i.e. it reads u_time). */
  animated?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Generators (procedural animated backgrounds)
// ---------------------------------------------------------------------------------------------

export type GeneratorCategory = 'gradient' | 'abstract' | 'pattern' | 'particles' | 'light' | 'retro';

/**
 * `glsl` must define:
 *     vec4 generate(vec2 uv)
 * `uv` is 0..1, origin TOP-LEFT. Available: `u_res`, `u_time`, `u_aspect`, `u_px` (as for effects).
 * Must look good and loop-free for any duration, be fully opaque unless transparency is the
 * point, and stay smooth at 4K (no per-pixel aliasing; band-limit patterns with `fwidth`/smoothstep).
 */
export interface GeneratorDef {
  id: string;
  name: string;
  category: GeneratorCategory;
  glsl: string;
  params: ParamDef[];
}

// ---------------------------------------------------------------------------------------------
// Filters (colour grade presets)
// ---------------------------------------------------------------------------------------------

export type FilterCategory = 'cinematic' | 'film' | 'portrait' | 'vivid' | 'mono' | 'retro' | 'mood' | 'nature';

export interface FilterDef {
  id: string;
  name: string;
  category: FilterCategory;
  /** Grade applied at intensity 1; the engine interpolates from neutral. */
  grade: Partial<Grade>;
}

// ---------------------------------------------------------------------------------------------
// Clip animations (in / out / loop)
// ---------------------------------------------------------------------------------------------

export interface AnimEnv {
  /** Layer size in design px (after the clip's own scale). */
  w: number;
  h: number;
  /** Composition size in design px. */
  cw: number;
  ch: number;
}

/** A modifier layered on top of the clip's transform. Omitted fields are neutral. */
export interface AnimMod {
  /** Offset in design px. */
  x?: number;
  y?: number;
  /** Uniform scale multiplier (1 = none). */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  /** Degrees added to the rotation. */
  rotation?: number;
  /** Opacity multiplier (0..1). */
  opacity?: number;
  /** Gaussian blur in design px. */
  blur?: number;
  /** Reveal insets: fraction (0..1) of the layer hidden from each side. */
  clipL?: number;
  clipR?: number;
  clipT?: number;
  clipB?: number;
}

export type AnimKind = 'in' | 'out' | 'loop';

/**
 * - kind 'in':   `p` runs 0 → 1 over the entrance. `apply(1)` MUST be neutral ({}).
 * - kind 'out':  `p` runs 0 → 1 over the exit.     `apply(0)` MUST be neutral.
 * - kind 'loop': `p` is the phase 0 → 1 of one period and must be seamless (apply(0) ≡ apply(1)).
 * `apply` must be pure and cheap; apply easing inside using `@/core/easing`.
 */
export interface AnimationDef {
  id: string;
  name: string;
  kind: AnimKind;
  /** Default duration (or loop period) in seconds. */
  duration: number;
  apply: (p: number, env: AnimEnv) => AnimMod;
}

// ---------------------------------------------------------------------------------------------
// Text animations (per character / word / line)
// ---------------------------------------------------------------------------------------------

export interface GlyphEnv {
  /** Index of this unit in animation order and the total number of units. */
  index: number;
  count: number;
  /** Seconds since the start of the clip. */
  time: number;
}

/** Modifier for one text unit. Offsets are in em (multiples of the font size). */
export interface GlyphMod {
  x?: number;
  y?: number;
  scale?: number;
  /** Degrees, around the unit's centre. */
  rotation?: number;
  opacity?: number;
  /** Blur in em. */
  blur?: number;
}

/**
 * The engine staggers units for you: for 'in'/'out' it derives a local 0..1 progress per unit from
 * `stagger` (0 = all together … 1 = strictly one after another) and `order`, then calls `apply`
 * with that local progress. For 'loop', `p` is the phase offset per unit by `stagger`.
 * Neutrality rules are the same as for AnimationDef.
 */
export interface TextAnimDef {
  id: string;
  name: string;
  kind: AnimKind;
  unit: 'char' | 'word' | 'line' | 'block';
  /** Default duration (or loop period) in seconds. */
  duration: number;
  stagger: number;
  order?: 'forward' | 'reverse' | 'center' | 'edges' | 'random';
  apply: (p: number, env: GlyphEnv) => GlyphMod;
}

// ---------------------------------------------------------------------------------------------
// Text presets
// ---------------------------------------------------------------------------------------------

export type TextPresetCategory = 'basic' | 'title' | 'subtitle' | 'caption' | 'social' | 'neon' | 'retro' | 'elegant' | 'bold' | 'handwritten' | 'lower-third';

export interface TextPresetDef {
  id: string;
  name: string;
  category: TextPresetCategory;
  /** Text shown in the library tile and used as the initial content. */
  sample: string;
  /** Style overrides. `fontFamily` must be a bundled font. */
  style: Partial<Omit<TextStyle, 'content' | 'fontFamily'>> & { fontFamily?: BundledFontFamily };
  /** Optional clip-level animation presets (ids from the animation pack). */
  anim?: ClipAnimations;
  /** Optional per-character animation presets (ids from the text animation pack). */
  textAnim?: ClipAnimations;
}

// ---------------------------------------------------------------------------------------------
// Stickers
// ---------------------------------------------------------------------------------------------

export type StickerCategory =
  | 'smileys'
  | 'gestures'
  | 'people'
  | 'animals'
  | 'food'
  | 'travel'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'nature'
  | 'animated'
  | 'social'
  | 'arrows'
  | 'badges'
  | 'callouts'
  | 'decor'
  | 'celebration';

interface StickerBase {
  id: string;
  name: string;
  category: StickerCategory;
  /** Lower-case search terms. */
  keywords: string[];
}

/** Rendered with the system colour-emoji font. */
export interface EmojiStickerDef extends StickerBase {
  kind: 'emoji';
  char: string;
}

export interface StickerDrawEnv {
  /** Logical drawing box: h is always 256, w = 256 * aspect. */
  w: number;
  h: number;
  /** Colours to use; defaults to the sticker's `colors`, may be overridden by the user. */
  colors: string[];
}

/**
 * Vector sticker drawn with Canvas 2D. `draw` receives a context already scaled so that the
 * logical box (0,0)-(w,h) fills the sticker; the background is transparent and already cleared.
 * `t` is seconds since the clip start. Animated stickers must loop seamlessly every `period`
 * seconds. Draw only inside the box (leave ~4% margin). Must be deterministic: no Math.random()
 * without a fixed seed, no Date.now().
 */
export interface CanvasStickerDef extends StickerBase {
  kind: 'canvas';
  /** width / height */
  aspect: number;
  animated: boolean;
  /** Loop length in seconds (animated only). */
  period?: number;
  colors?: string[];
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, t: number, env: StickerDrawEnv) => void;
}

export type StickerDef = EmojiStickerDef | CanvasStickerDef;

// ---------------------------------------------------------------------------------------------
// Sounds (synthesised with Web Audio — no audio files are shipped)
// ---------------------------------------------------------------------------------------------

export type SoundCategory = 'whoosh' | 'impact' | 'riser' | 'ui' | 'notification' | 'glitch' | 'cartoon' | 'ambience' | 'music';

/**
 * `render` builds a Web Audio graph inside the given (offline) context and connects it to `dest`.
 * It must schedule everything relative to time 0 and finish within `duration` seconds, fading to
 * silence before the end (no clicks). Stereo, 48 kHz. Peak level should stay below -1 dBFS.
 * Must be deterministic: use `seededRandom` from `@/core/easing` for noise, never Math.random().
 */
export interface SoundDef {
  id: string;
  name: string;
  category: SoundCategory;
  duration: number;
  keywords: string[];
  /** Music beds only: tempo and whether the clip loops seamlessly. */
  bpm?: number;
  loop?: boolean;
  render: (ctx: BaseAudioContext, dest: AudioNode) => void;
}

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

export interface Palette {
  id: string;
  name: string;
  /** True when the background colours are dark. */
  dark: boolean;
  bg: string;
  bg2: string;
  /** Cards / panels sitting on the background. */
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  /** Main text colour on `bg`. */
  text: string;
  textMuted: string;
  /** Text colour on `primary`. */
  onPrimary: string;
}

export interface FontRole {
  family: BundledFontFamily;
  weight: number;
  uppercase?: boolean;
  letterSpacing?: number;
}

export interface FontPair {
  id: string;
  name: string;
  heading: FontRole;
  body: FontRole;
}

export type TemplateCategory =
  | 'intro'
  | 'outro'
  | 'title'
  | 'lower-third'
  | 'social'
  | 'promo'
  | 'quote'
  | 'slideshow'
  | 'countdown'
  | 'youtube'
  | 'business'
  | 'event'
  | 'vlog'
  | 'gaming'
  | 'news';

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5';

export interface TemplateEnv {
  /** Composition size in design px (shorter side is always 1080). */
  cw: number;
  ch: number;
  aspect: AspectId;
  portrait: boolean;
  square: boolean;
  palette: Palette;
  fonts: FontPair;
  /** Seeded PRNG for tasteful variation; never use Math.random(). */
  rng: () => number;
  /** Requested total duration in seconds. */
  duration: number;
}

/**
 * Music bed added under a template's layers when it is applied (if the user keeps "Include
 * music" on). The synthesised sound is trimmed to the template length and faded.
 */
export interface TemplateMusic {
  /** Id of a sound in the `music` category. */
  soundId: string;
  /** 0..2, default 0.8. */
  volume?: number;
  /** Seconds, default 0.4. */
  fadeIn?: number;
  /** Seconds, default 1.2 (capped to a third of the template). */
  fadeOut?: number;
}

/** Where a runtime-registered design comes from (built-in designs omit it). */
export interface TemplateOrigin {
  kind: 'user' | 'pack';
  /** The user template id, or the content pack id. */
  id: string;
}

/**
 * A parametric design. `build` returns the clips of one instance, ordered bottom → top, with
 * `start` relative to the template start and an empty `trackId` (the app assigns tracks).
 * Build clips with the helpers from `@/core/factory` only. Designs must adapt to every aspect
 * ratio they claim to support by laying out from `env.cw` / `env.ch`.
 *
 * A media placeholder named `Logo` (`makeSlot({ name: 'Logo', … })`) is filled with the brand
 * logo when the user renders templates with their brand kit.
 */
export interface TemplateDef {
  id: string;
  name: string;
  category: TemplateCategory;
  tags: string[];
  /** Default duration in seconds. */
  duration: number;
  /** Supported aspect ratios; omit when the layout adapts to all of them. */
  aspects?: AspectId[];
  /** 0..1 position of the frame used as the poster (default 0.6). */
  poster?: number;
  /** Optional music bed (a `music` sound) added when the template is applied. */
  music?: TemplateMusic;
  build: (env: TemplateEnv) => Clip[];
  // --- Runtime-registered designs (user templates, content packs) ---------------------------
  /** Set for designs registered at runtime. */
  origin?: TemplateOrigin;
  /** The design ignores palette / font pair (e.g. a saved user template): shown once, not as variations. */
  fixed?: boolean;
  /** Media the design references (embedded in a user template); added to the project on apply. */
  assets?: MediaAsset[];
}
