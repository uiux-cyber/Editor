/**
 * Kinora project model.
 *
 * Units
 * -----
 * - Time is in seconds (floats), quantised to the project frame grid by editing operations.
 * - Geometry is in "design pixels": the composition's shorter side is always 1080 design px,
 *   regardless of the real export resolution. `x`/`y` are offsets of the layer centre from the
 *   composition centre (y grows downwards). This keeps projects resolution independent.
 */

export type ID = string;

export const DESIGN_SHORT_SIDE = 1080;

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

/** `animation` = animated GIF / WebP / APNG or Lottie JSON (see `MediaAsset.format`). */
export type AssetKind = 'video' | 'audio' | 'image' | 'animation';

export type AssetSource =
  | { type: 'file'; path: string }
  /** A sound synthesised by the built-in sound library; regenerated on load from its id. */
  | { type: 'generated'; soundId: string };

export interface MediaAsset {
  id: ID;
  kind: AssetKind;
  name: string;
  source: AssetSource;
  /** Seconds. 0 for still images. */
  duration: number;
  /** Display dimensions in real pixels (after rotation). 0 for audio. */
  width: number;
  height: number;
  /** Frames per second, 0 when unknown / not applicable. */
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** File size in bytes. */
  size: number;
  videoCodec?: string;
  audioCodec?: string;
  addedAt: number;
  /** Animated assets: container format. */
  format?: 'gif' | 'webp' | 'apng' | 'lottie' | 'motion';
  /** Lightweight editing copy used by the preview (export always uses the original). */
  proxy?: { path: string; width: number; height: number };
  /** Source uses a high-dynamic-range transfer (PQ / HLG) and is tone-mapped for display. */
  hdr?: boolean;
  /** When the file was converted on import (e.g. ProRes via FFmpeg), the original file. */
  transcodedFrom?: string;
  /** Motion clips: settings changed in the inspector (id → value); the others use the clip's defaults. */
  motionValues?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------------------------

export type EaseId =
  | 'linear'
  | 'hold'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeOutElastic'
  | 'easeOutBounce';

export interface Keyframe {
  /** Seconds from the start of the clip. */
  t: number;
  v: number;
  /** Easing used from this keyframe to the next one. */
  ease: EaseId;
}

export type KeyframeProp = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'volume';

export interface Transform {
  /** Offset of the layer centre from the composition centre, design px. */
  x: number;
  y: number;
  /** 1 = natural size. */
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0..1 */
  opacity: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'add'
  | 'subtract';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'add',
  'subtract',
];

export interface GradientStop {
  offset: number;
  color: string;
}

export type Paint =
  | { type: 'solid'; color: string }
  /** `angle` in degrees; 0 = left→right, 90 = top→bottom. */
  | { type: 'linear'; angle: number; stops: GradientStop[] }
  | { type: 'radial'; stops: GradientStop[] };

export interface Stroke {
  color: string;
  /** Design px. */
  width: number;
}

export interface Shadow {
  color: string;
  /** Design px. */
  blur: number;
  x: number;
  y: number;
}

/**
 * Colour grade. Every field is neutral at 0, so `{}` is "no change". The same structure backs
 * both the manual Adjust panel and the filter presets.
 */
export interface Grade {
  /** Stops, -2..2 */
  exposure: number;
  /** -1..1 */
  brightness: number;
  /** -1..1 */
  contrast: number;
  /** -1..1 (-1 = greyscale) */
  saturation: number;
  /** -1..1 */
  vibrance: number;
  /** -1 (cool) .. 1 (warm) */
  temperature: number;
  /** -1 (green) .. 1 (magenta) */
  tint: number;
  /** Degrees, -180..180 */
  hue: number;
  /** -1..1 */
  highlights: number;
  /** -1..1 */
  shadows: number;
  /** 0..1, lifts the blacks for a matte look */
  fade: number;
  /** -1..1, midtone gamma */
  gamma: number;
  /** 0..1 strength of the shadow tint */
  shadowTintAmount: number;
  /** Colour pushed into the shadows, e.g. '#103a5c' */
  shadowTint: string;
  /** 0..1 strength of the highlight tint */
  highlightTintAmount: number;
  highlightTint: string;
  /** 0..1 strength of the monochrome toning (0 = colour, 1 = fully toned) */
  mono: number;
  /** Tone colour used when `mono` > 0, '#ffffff' = neutral black & white */
  monoTint: string;
  /** 0..1 */
  vignette: number;
  /** 0..1 */
  grain: number;
  /** 0..1 */
  sharpen: number;
  /** Tone curves (optional; absent = identity). */
  curves?: Curves;
  /** Lift / gamma / gain / offset colour wheels (optional; absent = neutral). */
  wheels?: ColorWheels;
}

/** Curve control points in 0..1, sorted by x, always including x = 0 and x = 1. */
export type CurvePoints = [number, number][];

export interface Curves {
  master: CurvePoints;
  r: CurvePoints;
  g: CurvePoints;
  b: CurvePoints;
}

/** A colour wheel: hue (degrees) + strength (0..1) of the push, and a luminance offset (-1..1). */
export interface WheelValue {
  hue: number;
  amount: number;
  luma: number;
}

export interface ColorWheels {
  lift: WheelValue;
  gamma: WheelValue;
  gain: WheelValue;
  offset: WheelValue;
}

/** Reference to a user-imported .cube LUT (stored by the app, see the colour feature). */
export interface LutRef {
  id: string;
  /** 0..1 */
  intensity: number;
}

/** On-device background removal (person segmentation). */
export interface Cutout {
  enabled: boolean;
  /** 0..1 edge softness. */
  feather: number;
  /** -1..1 shrinks (negative) or grows (positive) the matte. */
  choke: number;
}

export interface EqBand {
  type: 'lowshelf' | 'peaking' | 'highshelf' | 'highpass' | 'lowpass';
  /** Hz */
  frequency: number;
  /** dB (ignored by pass filters) */
  gain: number;
  q: number;
}

export interface CompressorSettings {
  enabled: boolean;
  /** dBFS */
  threshold: number;
  ratio: number;
  /** seconds */
  attack: number;
  release: number;
  /** dB of make-up gain */
  makeup: number;
}

export type ParamValue = number | string | boolean;

export interface EffectInstance {
  uid: ID;
  effectId: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export interface FilterRef {
  id: string;
  /** 0..1 */
  intensity: number;
}

/** Preset animation reference. `duration` is seconds (for loops: the period). */
export interface AnimRef {
  id: string;
  duration: number;
}

export interface ClipAnimations {
  in?: AnimRef;
  out?: AnimRef;
  loop?: AnimRef;
}

/** Fractions (0..1) trimmed from each side of the source image. */
export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export type MaskShape = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'heart' | 'hexagon';

export interface Mask {
  shape: MaskShape;
  /** Centre, as a fraction of the layer box (-0.5..0.5, 0 = centre). */
  cx: number;
  cy: number;
  /** Size as a fraction of the layer box (1 = full). */
  w: number;
  h: number;
  /** Degrees. */
  rotation: number;
  /** 0..1 softness of the edge. */
  feather: number;
  /** 0..1 corner rounding (rect only). */
  radius: number;
  invert: boolean;
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  /** 0..1 */
  similarity: number;
  /** 0..1 */
  smoothness: number;
  /** 0..1 */
  spill: number;
}

// ---------------------------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------------------------

export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'sticker' | 'shape' | 'generator' | 'adjustment' | 'compound';

export const VISUAL_CLIP_TYPES: ClipType[] = ['video', 'image', 'text', 'sticker', 'shape', 'generator', 'adjustment', 'compound'];

interface ClipCore {
  id: ID;
  trackId: ID;
  name: string;
  /** Timeline start, seconds. */
  start: number;
  /** Timeline duration, seconds. */
  duration: number;
  /** Clips created together (e.g. from one template) share a group id. */
  groupId?: ID;
  /** Clips sharing a link id (a video and its detached audio) move, trim and delete together. */
  linkId?: ID;
  keyframes?: Partial<Record<KeyframeProp, Keyframe[]>>;
}

/** Properties shared by everything that renders pixels. */
export interface VisualProps {
  transform: Transform;
  blendMode: BlendMode;
  flipH?: boolean;
  flipV?: boolean;
  crop?: Crop;
  /** 0..1, fraction of half the shorter side. */
  cornerRadius?: number;
  mask?: Mask;
  chromaKey?: ChromaKey;
  adjust?: Partial<Grade>;
  filter?: FilterRef;
  effects: EffectInstance[];
  anim?: ClipAnimations;
  /** User LUT applied after the grade. */
  lut?: LutRef;
  /** Background removal (video / image layers). */
  cutout?: Cutout;
}

/** Properties shared by clips that play sound. */
export interface AudioProps {
  /** 0..2 (1 = unity gain) */
  volume: number;
  muted: boolean;
  /** Seconds */
  fadeIn: number;
  fadeOut: number;
  /** Parametric equaliser bands, applied in order. */
  eq?: EqBand[];
  compressor?: CompressorSettings;
}

/** Properties shared by clips backed by timed media. */
export interface TimedMediaProps {
  assetId: ID;
  /** Source time (seconds) shown at the clip's start. */
  trimIn: number;
  /** Playback rate, 0.1..16 */
  speed: number;
  /**
   * Speed ramp: speed multiplier keyframes over clip-local time (values 0.1..16). When present
   * it replaces the constant `speed` for time mapping.
   */
  speedRamp?: Keyframe[];
  /** Play the source backwards (from trimIn + span down to trimIn). */
  reverse?: boolean;
  /** Hold the frame at `trimIn` for the whole clip (video only; audio is silent). */
  freeze?: boolean;
  /** Keep the original pitch when the speed is not 1. */
  preservePitch?: boolean;
}

/** HDR → SDR tone-mapping of an HDR video clip (see engine/gl/ext/hdr.ts). Absent = defaults. */
export interface ToneMapSettings {
  operator: 'bt2390' | 'aces' | 'hable' | 'reinhard' | 'clip';
  /** Stops, applied in linear light before the operator (-3..3). */
  exposure: number;
  /** Brightest highlight of the source in nits, mapped to SDR white by the operator (400..10000). */
  peak: number;
}

export interface VideoClip extends ClipCore, VisualProps, AudioProps, TimedMediaProps {
  type: 'video';
  /** Tone-mapping of HDR sources (performance & media area); ignored for SDR media. */
  toneMap?: ToneMapSettings;
}

export interface ImageClip extends ClipCore, VisualProps {
  type: 'image';
  assetId: ID;
}

export interface AudioClip extends ClipCore, AudioProps, TimedMediaProps {
  type: 'audio';
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextBackground {
  color: string;
  /** 0..1 */
  opacity: number;
  /** Design px */
  padX: number;
  padY: number;
  /** Design px */
  radius: number;
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  /** Design px */
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  align: TextAlign;
  /** Multiplier of the font size */
  lineHeight: number;
  /** Em fraction, e.g. 0.05 */
  letterSpacing: number;
  fill: Paint;
  stroke?: Stroke;
  shadow?: Shadow;
  /** Soft outer glow */
  glow?: { color: string; blur: number };
  background?: TextBackground;
  /** Wrap width in design px; omitted = single block that only breaks on newlines. */
  boxWidth?: number;
}

export interface TextClip extends ClipCore, VisualProps {
  type: 'text';
  text: TextStyle;
  /** Per-character / per-word animation presets. */
  textAnim?: ClipAnimations;
  /** Count-up number. */
  counter?: CounterSettings;
  /** Present on caption clips (subtitle track). */
  caption?: CaptionData;
}

export interface StickerClip extends ClipCore, VisualProps {
  type: 'sticker';
  stickerId: string;
  /** Height in design px at scale 1. */
  size: number;
  /** Optional colour overrides for canvas stickers. */
  colors?: string[];
}

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'burst'
  | 'heart'
  | 'arrow'
  | 'chevron'
  | 'line'
  | 'cross'
  | 'bubble'
  | 'ring'
  | 'pill'
  | 'frame'
  | 'blob'
  /** Free-form bezier path drawn with the pen tool (see `ShapeStyle.path`). */
  | 'path';

export interface ShapeStyle {
  kind: ShapeKind;
  /** Design px */
  width: number;
  height: number;
  fill: Paint;
  stroke?: Stroke;
  /** Corner radius in design px (rect / frame). */
  radius: number;
  shadow?: Shadow;
  /**
   * When true the shape is a media placeholder created by a template: dropping media on it
   * replaces it with that media, keeping timing, placement and animation.
   */
  slot?: boolean;
  /** Pen-tool path, in the shape's own box (0..1 on both axes). */
  path?: PathData;
}

export interface PathPoint {
  x: number;
  y: number;
  /** Bezier handles relative to the point (0..1 units); omitted = sharp corner. */
  inX?: number;
  inY?: number;
  outX?: number;
  outY?: number;
}

export interface PathData {
  points: PathPoint[];
  closed: boolean;
}

/** Animated number for "count-up" text: replaces the text content while the clip plays. */
export interface CounterSettings {
  from: number;
  to: number;
  decimals: number;
  prefix: string;
  suffix: string;
  /** Thousands separators. */
  separator: boolean;
  ease: EaseId;
  /** Seconds from the clip start over which the count runs (default: whole clip). */
  duration?: number;
}

export interface CaptionWord {
  /** Clip-local seconds. */
  start: number;
  end: number;
  text: string;
}

export type CaptionHighlight = 'none' | 'color' | 'box' | 'karaoke' | 'pop' | 'underline';

export interface CaptionData {
  /** Word timings (from transcription) for word-by-word highlight styles. */
  words?: CaptionWord[];
  highlight: CaptionHighlight;
  /** Colour of the active word (or its box). */
  highlightColor: string;
}

export interface ShapeClip extends ClipCore, VisualProps {
  type: 'shape';
  shape: ShapeStyle;
}

/** A procedural, animated full-frame background rendered by a GLSL generator. */
export interface GeneratorClip extends ClipCore, VisualProps {
  type: 'generator';
  generatorId: string;
  params: Record<string, ParamValue>;
}

/** Applies its grade, filter and effects to everything rendered beneath it. */
export interface AdjustmentClip extends ClipCore, VisualProps {
  type: 'adjustment';
}

/** A nested timeline (several clips edited as one). */
export interface Sequence {
  tracks: Track[];
  clips: Record<ID, Clip>;
  transitions: Record<ID, Transition>;
  /** Markers placed while editing the nested sequence (nested time). */
  markers?: Marker[];
}

export interface CompoundClip extends ClipCore, VisualProps, AudioProps {
  type: 'compound';
  sequence: Sequence;
  /** Time inside the nested sequence shown at the clip's start. */
  trimIn: number;
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip | StickerClip | ShapeClip | GeneratorClip | AdjustmentClip | CompoundClip;
export type VisualClip = Exclude<Clip, AudioClip>;
export type MediaClip = VideoClip | AudioClip;

export function isVisualClip(clip: Clip): clip is VisualClip {
  return clip.type !== 'audio';
}
export function hasAudio(clip: Clip): clip is VideoClip | AudioClip {
  return clip.type === 'video' || clip.type === 'audio';
}
export function isTimedMedia(clip: Clip): clip is VideoClip | AudioClip {
  return clip.type === 'video' || clip.type === 'audio';
}

// ---------------------------------------------------------------------------------------------
// Tracks, transitions, markers, project
// ---------------------------------------------------------------------------------------------

export type TrackKind = 'visual' | 'audio';

export interface Track {
  id: ID;
  kind: TrackKind;
  name: string;
  /** Silences every clip on the track. */
  muted: boolean;
  /** Hides every clip on the track (visual tracks). */
  hidden: boolean;
  locked: boolean;
  /** `captions` marks the subtitle track (holds caption text clips). */
  role?: 'captions';
  /** Row height in the timeline (px); default depends on the kind. */
  height?: number;
}

/** A transition between two adjacent clips on the same track, centred on the cut. */
export interface Transition {
  id: ID;
  type: string;
  /** Seconds */
  duration: number;
  fromId: ID;
  toId: ID;
  params: Record<string, ParamValue>;
}

export interface Marker {
  id: ID;
  time: number;
  label: string;
  color: string;
}

export interface ProjectSettings {
  /** Real output pixels. */
  width: number;
  height: number;
  fps: number;
  background: string;
}

export interface Project {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  assets: Record<ID, MediaAsset>;
  /**
   * Ordered top → bottom as shown in the timeline. Visual tracks come first (index 0 renders on
   * top), audio tracks last.
   */
  tracks: Track[];
  clips: Record<ID, Clip>;
  transitions: Record<ID, Transition>;
  markers: Marker[];
  /** Marked range (seconds) for exporting a section. */
  inPoint?: number;
  outPoint?: number;
  /**
   * Magnetic main track: the bottom-most visual track (see `mainTrackId`) never has gaps —
   * clips dropped or moved onto it are inserted at a cut and later clips make room. Absent in
   * projects saved before it existed (off); new projects turn it on.
   */
  magneticMain?: boolean;
}

export interface ProjectFile {
  app: 'kinora';
  version: number;
  project: Project;
}

export const PROJECT_FILE_VERSION = 1;
