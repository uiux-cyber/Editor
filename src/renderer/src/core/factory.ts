/**
 * Constructors for every clip type, with sensible defaults. The UI, the template pack and the
 * tests all create clips through these helpers so that new fields only need a default in one place.
 */

import type {
  AdjustmentClip,
  AudioClip,
  BlendMode,
  ClipAnimations,
  Crop,
  EaseId,
  EffectInstance,
  FilterRef,
  GeneratorClip,
  Grade,
  ID,
  ImageClip,
  Keyframe,
  KeyframeProp,
  Mask,
  MediaAsset,
  Paint,
  ParamValue,
  Shadow,
  ShapeClip,
  ShapeKind,
  StickerClip,
  Stroke,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  VideoClip,
  VisualProps,
} from './types';

let counter = 0;

/** Short, collision-resistant id. */
export function uid(prefix = ''): ID {
  counter = (counter + 1) % 0xffffff;
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, '0');
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

// ---------------------------------------------------------------------------------------------
// Paint helpers
// ---------------------------------------------------------------------------------------------

export const solid = (color: string): Paint => ({ type: 'solid', color });

/** Linear gradient with evenly spaced stops. `angle`: 0 = left→right, 90 = top→bottom. */
export const linear = (angle: number, ...colors: string[]): Paint => ({
  type: 'linear',
  angle,
  stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
});

/** Radial gradient (centre → edge) with evenly spaced stops. */
export const radial = (...colors: string[]): Paint => ({
  type: 'radial',
  stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
});

const toPaint = (p: Paint | string | undefined, fallback: string): Paint => (p === undefined ? solid(fallback) : typeof p === 'string' ? solid(p) : p);

export const kf = (t: number, v: number, ease: EaseId = 'easeInOut'): Keyframe => ({ t, v, ease });

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };

export const NEUTRAL_GRADE: Grade = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
  fade: 0,
  gamma: 0,
  shadowTintAmount: 0,
  shadowTint: '#000000',
  highlightTintAmount: 0,
  highlightTint: '#ffffff',
  mono: 0,
  monoTint: '#ffffff',
  vignette: 0,
  grain: 0,
  sharpen: 0,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  content: 'Your text here',
  fontFamily: 'Inter',
  fontSize: 96,
  fontWeight: 700,
  italic: false,
  underline: false,
  uppercase: false,
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
  fill: { type: 'solid', color: '#ffffff' },
};

export const DEFAULT_MASK: Mask = { shape: 'rect', cx: 0, cy: 0, w: 0.8, h: 0.8, rotation: 0, feather: 0, radius: 0, invert: false };
export const DEFAULT_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

// ---------------------------------------------------------------------------------------------
// Common options
// ---------------------------------------------------------------------------------------------

export interface CommonOpts {
  name?: string;
  /** Seconds (default 0). */
  start?: number;
  /** Seconds (default 5). */
  duration?: number;
  /** Design px offset from the composition centre. */
  x?: number;
  y?: number;
  /** Uniform scale (sets both axes). */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  blendMode?: BlendMode;
  anim?: ClipAnimations;
  effects?: EffectInstance[];
  filter?: FilterRef;
  adjust?: Partial<Grade>;
  mask?: Mask;
  crop?: Crop;
  cornerRadius?: number;
  flipH?: boolean;
  flipV?: boolean;
  keyframes?: Partial<Record<KeyframeProp, Keyframe[]>>;
  groupId?: ID;
}

function visual(o: CommonOpts): VisualProps {
  const props: VisualProps = {
    transform: {
      x: o.x ?? 0,
      y: o.y ?? 0,
      scaleX: o.scaleX ?? o.scale ?? 1,
      scaleY: o.scaleY ?? o.scale ?? 1,
      rotation: o.rotation ?? 0,
      opacity: o.opacity ?? 1,
    },
    blendMode: o.blendMode ?? 'normal',
    effects: o.effects ?? [],
  };
  if (o.anim) props.anim = o.anim;
  if (o.filter) props.filter = o.filter;
  if (o.adjust) props.adjust = o.adjust;
  if (o.mask) props.mask = o.mask;
  if (o.crop) props.crop = o.crop;
  if (o.cornerRadius) props.cornerRadius = o.cornerRadius;
  if (o.flipH) props.flipH = true;
  if (o.flipV) props.flipV = true;
  return props;
}

function core(prefix: string, name: string, o: CommonOpts): { id: ID; trackId: ID; name: string; start: number; duration: number; groupId?: ID; keyframes?: Partial<Record<KeyframeProp, Keyframe[]>> } {
  const base: ReturnType<typeof core> = {
    id: uid(prefix),
    trackId: '',
    name: o.name ?? name,
    start: o.start ?? 0,
    duration: o.duration ?? 5,
  };
  if (o.groupId) base.groupId = o.groupId;
  if (o.keyframes) base.keyframes = o.keyframes;
  return base;
}

// ---------------------------------------------------------------------------------------------
// Clip constructors
// ---------------------------------------------------------------------------------------------

export interface TextOpts extends CommonOpts {
  style?: Partial<TextStyle>;
  /** Per-character / per-word animation presets. */
  textAnim?: ClipAnimations;
}

export function makeText(content: string, o: TextOpts = {}): TextClip {
  const clip: TextClip = {
    ...core('tx_', content.split('\n')[0].slice(0, 40) || 'Text', o),
    ...visual(o),
    type: 'text',
    text: { ...DEFAULT_TEXT_STYLE, ...o.style, content },
  };
  if (o.textAnim) clip.textAnim = o.textAnim;
  return clip;
}

export interface ShapeOpts extends CommonOpts {
  /** Design px */
  width: number;
  height: number;
  /** A Paint or a CSS colour string. Default white. */
  fill?: Paint | string;
  stroke?: Stroke;
  /** Corner radius in design px. */
  radius?: number;
  shadow?: Shadow;
}

export function makeShape(kind: ShapeKind, o: ShapeOpts): ShapeClip {
  const clip: ShapeClip = {
    ...core('sh_', kind.charAt(0).toUpperCase() + kind.slice(1), o),
    ...visual(o),
    type: 'shape',
    shape: { kind, width: o.width, height: o.height, fill: toPaint(o.fill, '#ffffff'), radius: o.radius ?? 0 },
  };
  if (o.stroke) clip.shape.stroke = o.stroke;
  if (o.shadow) clip.shape.shadow = o.shadow;
  return clip;
}

/** A media placeholder: users drop a photo or video on it to replace it. */
export function makeSlot(o: ShapeOpts): ShapeClip {
  const clip = makeShape('rect', { fill: linear(135, '#3a3f4b', '#23262e'), ...o, name: o.name ?? 'Media placeholder' });
  clip.shape.slot = true;
  return clip;
}

export interface StickerOpts extends CommonOpts {
  /** Height in design px at scale 1 (default 320). */
  size?: number;
  colors?: string[];
}

export function makeSticker(stickerId: string, o: StickerOpts = {}): StickerClip {
  const clip: StickerClip = {
    ...core('st_', 'Sticker', o),
    ...visual(o),
    type: 'sticker',
    stickerId,
    size: o.size ?? 320,
  };
  if (o.colors) clip.colors = o.colors;
  return clip;
}

export interface GeneratorOpts extends CommonOpts {
  params?: Record<string, ParamValue>;
}

export function makeGenerator(generatorId: string, o: GeneratorOpts = {}): GeneratorClip {
  return {
    ...core('gn_', 'Background', o),
    ...visual(o),
    type: 'generator',
    generatorId,
    params: o.params ?? {},
  };
}

export function makeAdjustment(o: CommonOpts = {}): AdjustmentClip {
  return { ...core('ad_', 'Adjustment layer', o), ...visual(o), type: 'adjustment' };
}

export interface MediaOpts extends CommonOpts {
  trimIn?: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

export function makeVideo(asset: MediaAsset, o: MediaOpts = {}): VideoClip {
  const speed = o.speed ?? 1;
  const trimIn = o.trimIn ?? 0;
  return {
    ...core('vd_', asset.name, { ...o, duration: o.duration ?? Math.max(0.1, (asset.duration - trimIn) / speed) }),
    ...visual(o),
    type: 'video',
    assetId: asset.id,
    trimIn,
    speed,
    volume: o.volume ?? 1,
    muted: o.muted ?? false,
    fadeIn: o.fadeIn ?? 0,
    fadeOut: o.fadeOut ?? 0,
  };
}

export function makeImage(asset: MediaAsset, o: CommonOpts = {}): ImageClip {
  return { ...core('im_', asset.name, o), ...visual(o), type: 'image', assetId: asset.id };
}

export function makeAudio(asset: MediaAsset, o: MediaOpts = {}): AudioClip {
  const speed = o.speed ?? 1;
  const trimIn = o.trimIn ?? 0;
  return {
    ...core('au_', asset.name, { ...o, duration: o.duration ?? Math.max(0.1, (asset.duration - trimIn) / speed) }),
    type: 'audio',
    assetId: asset.id,
    trimIn,
    speed,
    volume: o.volume ?? 1,
    muted: o.muted ?? false,
    fadeIn: o.fadeIn ?? 0,
    fadeOut: o.fadeOut ?? 0,
  };
}

export function makeEffect(effectId: string, params: Record<string, ParamValue> = {}): EffectInstance {
  return { uid: uid('fx_'), effectId, enabled: true, params };
}

export function makeTrack(kind: TrackKind, name: string): Track {
  return { id: uid('tr_'), kind, name, muted: false, hidden: false, locked: false };
}
