/**
 * Static templates: designs stored as clip JSON (saved user templates, templates shipped in
 * content packs) instead of code. This module
 *  - sanitises clip JSON coming from disk into well-formed clips (every field type-checked,
 *    unknown fields dropped, library references verified) — data from files is never trusted,
 *  - resolves palette / font tokens (`$primary`, `$heading`…) so pack designs follow the gallery
 *    palette, the font pairing and the brand kit,
 *  - adapts a design made for one frame to any other aspect ratio,
 *  - wraps it all into a regular `TemplateDef`.
 */

import { EASE_IDS } from '@/core/easing';
import { NEUTRAL_GRADE, uid } from '@/core/factory';
import { createProject } from '@/core/project';
import { reframeProject } from '@/core/reframe';
import { BLEND_MODES, type Clip, type ID, type MediaAsset, type Paint, type ParamValue, type ShapeClip, type VisualClip } from '@/core/types';
import { getAnimation, getEffect as libEffect, getFilter as libFilter, getGenerator as libGenerator, getSticker, getTextAnimation } from './index';
import { getBundledFont, nearestWeight } from './fonts';
import { alpha } from './templates/_lib/kit';
import type { AspectId, EffectDef, FilterDef, FontPair, GeneratorDef, ParamDef, Palette, TemplateCategory, TemplateDef, TemplateMusic, TemplateOrigin } from './types';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['intro', 'outro', 'title', 'lower-third', 'social', 'promo', 'quote', 'slideshow', 'countdown', 'youtube', 'business', 'event', 'vlog', 'gaming', 'news'];
export const ASPECT_IDS: AspectId[] = ['16:9', '9:16', '1:1', '4:5'];

const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'burst', 'heart', 'arrow', 'chevron', 'line', 'cross', 'bubble', 'ring', 'pill', 'frame', 'blob', 'path'];
const MASK_SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'heart', 'hexagon'];
const KEYFRAME_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume'];
const GRADE_RANGES: Record<string, [number, number]> = {
  exposure: [-2, 2],
  brightness: [-1, 1],
  contrast: [-1, 1],
  saturation: [-1, 1],
  vibrance: [-1, 1],
  temperature: [-1, 1],
  tint: [-1, 1],
  hue: [-180, 180],
  highlights: [-1, 1],
  shadows: [-1, 1],
  fade: [0, 1],
  gamma: [-1, 1],
  shadowTintAmount: [0, 1],
  highlightTintAmount: [0, 1],
  mono: [0, 1],
  vignette: [0, 1],
  grain: [0, 1],
  sharpen: [0, 1],
};

/** Palette roles usable as colour tokens in pack templates: `$primary`, `$text/60` (60 % alpha)… */
export const PALETTE_TOKENS = ['bg', 'bg2', 'surface', 'primary', 'secondary', 'accent', 'text', 'textMuted', 'onPrimary'] as const;
const TOKEN_RE = /^\$(bg|bg2|surface|primary|secondary|accent|text|textMuted|onPrimary)(?:\/(\d{1,3}))?$/;
const FONT_TOKEN_RE = /^\$(heading|body)$/;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Keys that must never appear in JSON read from disk (prototype pollution). */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_TEMPLATE_CLIPS = 300;

// ---------------------------------------------------------------------------------------------
// Library look-ups (with an overlay for items of a pack that is being validated)
// ---------------------------------------------------------------------------------------------

let overlay: { effects: Map<string, EffectDef>; generators: Map<string, GeneratorDef>; filters: Map<string, FilterDef> } | null = null;

/** Run fn while the given pack items resolve as if they were registered (no UI notification). */
export function withLookupOverlay<T>(content: { effects?: EffectDef[]; generators?: GeneratorDef[]; filters?: FilterDef[] }, fn: () => T): T {
  const prev = overlay;
  overlay = {
    effects: new Map((content.effects ?? []).map((d) => [d.id, d])),
    generators: new Map((content.generators ?? []).map((d) => [d.id, d])),
    filters: new Map((content.filters ?? []).map((d) => [d.id, d])),
  };
  try {
    return fn();
  } finally {
    overlay = prev;
  }
}

const getEffect = (id: string): EffectDef | undefined => overlay?.effects.get(id) ?? libEffect(id);
const getGenerator = (id: string): GeneratorDef | undefined => overlay?.generators.get(id) ?? libGenerator(id);
const getFilter = (id: string): FilterDef | undefined => overlay?.filters.get(id) ?? libFilter(id);

// ---------------------------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------------------------

export interface SanitizeOptions {
  /** Accept `$role` colour tokens and `$heading` / `$body` font tokens (content packs). */
  tokens?: boolean;
  /** Media assets clips may reference (user templates with embedded media). */
  assets?: Record<ID, MediaAsset>;
  /** Accept font families that are not bundled (fonts installed on this PC; user templates). */
  anyFont?: boolean;
}

/** Collects problems while sanitising, with a JSON-path-like location. */
export class Problems {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  constructor(private readonly limit = 60) {}
  error(path: string, msg: string): void {
    if (this.errors.length < this.limit) this.errors.push(`${path}: ${msg}`);
  }
  warn(path: string, msg: string): void {
    if (this.warnings.length < this.limit) this.warnings.push(`${path}: ${msg}`);
  }
  get ok(): boolean {
    return this.errors.length === 0;
  }
}

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Deep scan for forbidden keys and runaway nesting. Returns an error message or null. */
export function scanJson(value: unknown, depth = 0): string | null {
  if (depth > 40) return 'nesting is too deep';
  if (Array.isArray(value)) {
    for (const v of value) {
      const e = scanJson(v, depth + 1);
      if (e) return e;
    }
  } else if (isObj(value)) {
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) return `forbidden key "${k}"`;
      const e = scanJson(value[k], depth + 1);
      if (e) return e;
    }
  }
  return null;
}

function num(p: Problems, path: string, v: unknown, lo: number, hi: number, fallback?: number): number | undefined {
  if (v === undefined && fallback !== undefined) return fallback;
  if (!isNum(v)) {
    p.error(path, 'must be a number');
    return fallback;
  }
  if (v < lo || v > hi) {
    p.error(path, `${v} is outside ${lo}..${hi}`);
    return Math.min(hi, Math.max(lo, v));
  }
  return v;
}

function bool(v: unknown): boolean {
  return v === true;
}

function text(p: Problems, path: string, v: unknown, max: number, fallback?: string): string | undefined {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'string') {
    p.error(path, 'must be a string');
    return fallback;
  }
  if (v.length > max) {
    p.error(path, `is longer than ${max} characters`);
    return v.slice(0, max);
  }
  return v;
}

function color(p: Problems, path: string, v: unknown, o: SanitizeOptions, fallback = '#ffffff'): string {
  if (typeof v === 'string' && (HEX_RE.test(v) || (o.tokens && TOKEN_RE.test(v) && Number(TOKEN_RE.exec(v)![2] ?? 100) <= 100))) return v;
  p.error(path, `"${String(v).slice(0, 40)}" is not a colour${o.tokens ? ' (#rrggbb or a $role token)' : ' (#rrggbb)'}`);
  return fallback;
}

function paint(p: Problems, path: string, v: unknown, o: SanitizeOptions): Paint {
  if (typeof v === 'string') return { type: 'solid', color: color(p, path, v, o) };
  if (!isObj(v)) {
    p.error(path, 'must be a paint');
    return { type: 'solid', color: '#ffffff' };
  }
  if (v.type === 'solid') return { type: 'solid', color: color(p, `${path}.color`, v.color, o) };
  if (v.type === 'linear' || v.type === 'radial') {
    const stops: { offset: number; color: string }[] = [];
    if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 16) p.error(`${path}.stops`, 'needs 2..16 gradient stops');
    else
      v.stops.forEach((s, i) => {
        if (!isObj(s)) return p.error(`${path}.stops[${i}]`, 'must be an object');
        stops.push({ offset: num(p, `${path}.stops[${i}].offset`, s.offset, 0, 1, 0)!, color: color(p, `${path}.stops[${i}].color`, s.color, o) });
      });
    if (stops.length < 2) stops.splice(0, stops.length, { offset: 0, color: '#ffffff' }, { offset: 1, color: '#ffffff' });
    return v.type === 'linear' ? { type: 'linear', angle: num(p, `${path}.angle`, v.angle, -3600, 3600, 0)!, stops } : { type: 'radial', stops };
  }
  p.error(`${path}.type`, 'must be solid, linear or radial');
  return { type: 'solid', color: '#ffffff' };
}

function shadow(p: Problems, path: string, v: unknown, o: SanitizeOptions): { color: string; blur: number; x: number; y: number } | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return void p.error(path, 'must be an object');
  return { color: color(p, `${path}.color`, v.color, o), blur: num(p, `${path}.blur`, v.blur, 0, 500, 0)!, x: num(p, `${path}.x`, v.x, -2000, 2000, 0)!, y: num(p, `${path}.y`, v.y, -2000, 2000, 0)! };
}

function animRefs(p: Problems, path: string, v: unknown, textual: boolean): VisualClip['anim'] {
  if (v === undefined) return undefined;
  if (!isObj(v)) return void p.error(path, 'must be an object');
  const out: NonNullable<VisualClip['anim']> = {};
  for (const kind of ['in', 'out', 'loop'] as const) {
    const ref = v[kind];
    if (ref === undefined) continue;
    if (!isObj(ref) || typeof ref.id !== 'string') {
      p.error(`${path}.${kind}`, 'must be { id, duration }');
      continue;
    }
    const def = textual ? getTextAnimation(ref.id) : getAnimation(ref.id);
    if (!def) p.error(`${path}.${kind}`, `unknown ${textual ? 'text ' : ''}animation "${ref.id}"`);
    else if (def.kind !== kind) p.error(`${path}.${kind}`, `animation "${ref.id}" is a "${def.kind}" animation`);
    else out[kind] = { id: ref.id, duration: num(p, `${path}.${kind}.duration`, ref.duration, 0.05, 60, def.duration)! };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Validate param values against their definitions (unknown keys dropped). */
export function paramValues(p: Problems, path: string, v: unknown, defs: ParamDef[] | undefined, o: SanitizeOptions): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (v === undefined) return out;
  if (!isObj(v)) {
    p.error(path, 'must be an object');
    return out;
  }
  for (const [key, value] of Object.entries(v)) {
    const def = defs?.find((d) => d.key === key);
    if (!def) {
      p.warn(`${path}.${key}`, 'unknown parameter ignored');
      continue;
    }
    if (def.type === 'color') out[key] = color(p, `${path}.${key}`, value, o);
    else if (def.type === 'bool') out[key] = value === true;
    else out[key] = num(p, `${path}.${key}`, value, def.min ?? -1e6, def.max ?? 1e6, def.default as number)!;
  }
  return out;
}

/** Partial colour grade with every value range-checked. */
export function grade(p: Problems, path: string, v: unknown): Record<string, number | string> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return void p.error(path, 'must be an object');
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!(key in NEUTRAL_GRADE)) {
      p.error(`${path}.${key}`, 'unknown grade field');
      continue;
    }
    const range = GRADE_RANGES[key];
    if (range) out[key] = num(p, `${path}.${key}`, value, range[0], range[1], 0)!;
    else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) out[key] = value;
    else p.error(`${path}.${key}`, 'must be a #rrggbb colour');
  }
  return out;
}

function keyframes(p: Problems, path: string, v: unknown, duration: number): Clip['keyframes'] {
  if (v === undefined) return undefined;
  if (!isObj(v)) return void p.error(path, 'must be an object');
  const out: NonNullable<Clip['keyframes']> = {};
  for (const [prop, frames] of Object.entries(v)) {
    if (!KEYFRAME_PROPS.includes(prop)) {
      p.error(`${path}.${prop}`, 'unknown keyframe property');
      continue;
    }
    if (!Array.isArray(frames) || frames.length > 500) {
      p.error(`${path}.${prop}`, 'must be an array of at most 500 keyframes');
      continue;
    }
    out[prop as keyof typeof out] = frames.map((f, i) => {
      const fp = `${path}.${prop}[${i}]`;
      if (!isObj(f)) {
        p.error(fp, 'must be { t, v, ease }');
        return { t: 0, v: 0, ease: 'linear' as const };
      }
      const ease = typeof f.ease === 'string' && (EASE_IDS as string[]).includes(f.ease) ? (f.ease as (typeof EASE_IDS)[number]) : 'easeInOut';
      if (f.ease !== undefined && ease !== f.ease) p.error(`${fp}.ease`, `unknown easing "${String(f.ease)}"`);
      return { t: num(p, `${fp}.t`, f.t, 0, duration + 0.001, 0)!, v: num(p, `${fp}.v`, f.v, -1e5, 1e5, 0)!, ease };
    });
  }
  return out;
}

function visualProps(p: Problems, path: string, r: Obj, o: SanitizeOptions): Obj {
  const t = isObj(r.transform) ? r.transform : {};
  if (r.transform !== undefined && !isObj(r.transform)) p.error(`${path}.transform`, 'must be an object');
  const out: Obj = {
    transform: {
      x: num(p, `${path}.transform.x`, t.x, -20000, 20000, 0)!,
      y: num(p, `${path}.transform.y`, t.y, -20000, 20000, 0)!,
      scaleX: num(p, `${path}.transform.scaleX`, t.scaleX, -100, 100, 1)!,
      scaleY: num(p, `${path}.transform.scaleY`, t.scaleY, -100, 100, 1)!,
      rotation: num(p, `${path}.transform.rotation`, t.rotation, -36000, 36000, 0)!,
      opacity: num(p, `${path}.transform.opacity`, t.opacity, 0, 1, 1)!,
    },
    blendMode: 'normal',
    effects: [],
  };
  if (r.blendMode !== undefined) {
    if (typeof r.blendMode === 'string' && (BLEND_MODES as string[]).includes(r.blendMode)) out.blendMode = r.blendMode;
    else p.error(`${path}.blendMode`, `unknown blend mode "${String(r.blendMode)}"`);
  }
  if (r.flipH === true) out.flipH = true;
  if (r.flipV === true) out.flipV = true;
  if (r.crop !== undefined) {
    const c = isObj(r.crop) ? r.crop : {};
    out.crop = { l: num(p, `${path}.crop.l`, c.l, 0, 0.99, 0), t: num(p, `${path}.crop.t`, c.t, 0, 0.99, 0), r: num(p, `${path}.crop.r`, c.r, 0, 0.99, 0), b: num(p, `${path}.crop.b`, c.b, 0, 0.99, 0) };
  }
  if (r.cornerRadius !== undefined) out.cornerRadius = num(p, `${path}.cornerRadius`, r.cornerRadius, 0, 1, 0);
  if (r.mask !== undefined) {
    const m = isObj(r.mask) ? r.mask : {};
    const shape = typeof m.shape === 'string' && MASK_SHAPES.includes(m.shape) ? m.shape : 'rect';
    if (m.shape !== undefined && shape !== m.shape) p.error(`${path}.mask.shape`, 'unknown mask shape');
    out.mask = {
      shape,
      cx: num(p, `${path}.mask.cx`, m.cx, -2, 2, 0),
      cy: num(p, `${path}.mask.cy`, m.cy, -2, 2, 0),
      w: num(p, `${path}.mask.w`, m.w, 0, 4, 0.8),
      h: num(p, `${path}.mask.h`, m.h, 0, 4, 0.8),
      rotation: num(p, `${path}.mask.rotation`, m.rotation, -3600, 3600, 0),
      feather: num(p, `${path}.mask.feather`, m.feather, 0, 1, 0),
      radius: num(p, `${path}.mask.radius`, m.radius, 0, 1, 0),
      invert: bool(m.invert),
    };
  }
  if (r.chromaKey !== undefined) {
    const k = isObj(r.chromaKey) ? r.chromaKey : {};
    out.chromaKey = {
      enabled: bool(k.enabled),
      color: color(p, `${path}.chromaKey.color`, k.color ?? '#00ff00', o),
      similarity: num(p, `${path}.chromaKey.similarity`, k.similarity, 0, 1, 0.4),
      smoothness: num(p, `${path}.chromaKey.smoothness`, k.smoothness, 0, 1, 0.1),
      spill: num(p, `${path}.chromaKey.spill`, k.spill, 0, 1, 0.5),
    };
  }
  const adj = grade(p, `${path}.adjust`, r.adjust);
  if (adj && Object.keys(adj).length) out.adjust = adj;
  if (r.filter !== undefined) {
    const f = isObj(r.filter) ? r.filter : {};
    if (typeof f.id !== 'string' || !getFilter(f.id)) p.error(`${path}.filter`, `unknown filter "${String(f.id)}"`);
    else out.filter = { id: f.id, intensity: num(p, `${path}.filter.intensity`, f.intensity, 0, 1, 1) };
  }
  if (r.effects !== undefined) {
    if (!Array.isArray(r.effects) || r.effects.length > 16) p.error(`${path}.effects`, 'must be an array of at most 16 effects');
    else
      r.effects.forEach((fx, i) => {
        const fp = `${path}.effects[${i}]`;
        if (!isObj(fx) || typeof fx.effectId !== 'string') return p.error(fp, 'must be { effectId, params }');
        const def = getEffect(fx.effectId);
        if (!def) return p.error(fp, `unknown effect "${fx.effectId}"`);
        (out.effects as unknown[]).push({ uid: uid('fx_'), effectId: def.id, enabled: fx.enabled !== false, params: paramValues(p, `${fp}.params`, fx.params, def.params, o) });
      });
  }
  const anim = animRefs(p, `${path}.anim`, r.anim, false);
  if (anim) out.anim = anim;
  return out;
}

function strokeOf(p: Problems, path: string, v: unknown, o: SanitizeOptions): { color: string; width: number } | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return void p.error(path, 'must be { color, width }');
  return { color: color(p, `${path}.color`, v.color, o), width: num(p, `${path}.width`, v.width, 0, 500, 0)! };
}

function fontFamily(p: Problems, path: string, v: unknown, weight: number, o: SanitizeOptions): string {
  if (typeof v !== 'string' || !v.trim()) {
    p.error(path, 'must be a font family');
    return 'Inter';
  }
  if (o.tokens && FONT_TOKEN_RE.test(v)) return v;
  const bundled = getBundledFont(v);
  if (bundled) {
    if (!bundled.weights.includes(weight)) p.warn(path, `"${v}" has no weight ${weight}; the nearest weight is used`);
    return v;
  }
  if (o.anyFont && v.length <= 120) return v;
  p.error(path, `font "${v}" is not bundled with Kinora`);
  return 'Inter';
}

function textStyle(p: Problems, path: string, v: unknown, o: SanitizeOptions): Obj {
  const s = isObj(v) ? v : {};
  if (!isObj(v)) p.error(path, 'must be an object');
  const fontWeight = Math.round(num(p, `${path}.fontWeight`, s.fontWeight, 100, 900, 700)!);
  const content = text(p, `${path}.content`, s.content, 4000, '') ?? '';
  if (!content.trim()) p.error(`${path}.content`, 'must not be empty');
  const align = s.align === 'left' || s.align === 'right' || s.align === 'center' ? s.align : 'center';
  if (s.align !== undefined && align !== s.align) p.error(`${path}.align`, 'must be left, center or right');
  const out: Obj = {
    content,
    fontFamily: fontFamily(p, `${path}.fontFamily`, s.fontFamily ?? 'Inter', fontWeight, o),
    fontSize: num(p, `${path}.fontSize`, s.fontSize, 4, 2000, 96),
    fontWeight,
    italic: bool(s.italic),
    underline: bool(s.underline),
    uppercase: bool(s.uppercase),
    align,
    lineHeight: num(p, `${path}.lineHeight`, s.lineHeight, 0.4, 5, 1.15),
    letterSpacing: num(p, `${path}.letterSpacing`, s.letterSpacing, -1, 3, 0),
    fill: paint(p, `${path}.fill`, s.fill ?? '#ffffff', o),
  };
  const stroke = strokeOf(p, `${path}.stroke`, s.stroke, o);
  if (stroke) out.stroke = stroke;
  const sh = shadow(p, `${path}.shadow`, s.shadow, o);
  if (sh) out.shadow = sh;
  if (s.glow !== undefined) {
    const g = isObj(s.glow) ? s.glow : {};
    out.glow = { color: color(p, `${path}.glow.color`, g.color, o), blur: num(p, `${path}.glow.blur`, g.blur, 0, 500, 0) };
  }
  if (s.background !== undefined) {
    const b = isObj(s.background) ? s.background : {};
    out.background = {
      color: color(p, `${path}.background.color`, b.color, o),
      opacity: num(p, `${path}.background.opacity`, b.opacity, 0, 1, 1),
      padX: num(p, `${path}.background.padX`, b.padX, 0, 1000, 0),
      padY: num(p, `${path}.background.padY`, b.padY, 0, 1000, 0),
      radius: num(p, `${path}.background.radius`, b.radius, 0, 2000, 0),
    };
  }
  if (s.boxWidth !== undefined) out.boxWidth = num(p, `${path}.boxWidth`, s.boxWidth, 10, 20000, 1000);
  return out;
}

function pathData(p: Problems, path: string, v: unknown): Obj | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || !Array.isArray(v.points) || v.points.length > 1000) return void p.error(path, 'must be { points, closed } with at most 1000 points');
  const points = v.points.map((pt, i) => {
    const q = isObj(pt) ? pt : {};
    const o: Obj = { x: num(p, `${path}.points[${i}].x`, q.x, -10, 10, 0), y: num(p, `${path}.points[${i}].y`, q.y, -10, 10, 0) };
    for (const k of ['inX', 'inY', 'outX', 'outY']) if (q[k] !== undefined) o[k] = num(p, `${path}.points[${i}].${k}`, q[k], -10, 10, 0);
    return o;
  });
  return { points, closed: bool(v.closed) };
}

/**
 * Turn one clip read from JSON into a well-formed clip, or null when it cannot be used.
 * Times are kept as given (relative to the template start); track and group ids are cleared.
 */
export function sanitizeClip(p: Problems, path: string, raw: unknown, o: SanitizeOptions = {}): Clip | null {
  if (!isObj(raw)) {
    p.error(path, 'must be an object');
    return null;
  }
  const errorsBefore = p.errors.length;
  const start = num(p, `${path}.start`, raw.start, 0, 3600, 0)!;
  const duration = num(p, `${path}.duration`, raw.duration, 0.01, 3600, undefined) ?? 1;
  const core: Obj = {
    id: uid('tc_'),
    trackId: '',
    name: text(p, `${path}.name`, raw.name ?? '', 200, '') || String(raw.type ?? 'Layer'),
    start,
    duration,
  };
  const kfs = keyframes(p, `${path}.keyframes`, raw.keyframes, duration);
  if (kfs && Object.keys(kfs).length) core.keyframes = kfs;
  const type = raw.type;
  let clip: Obj | null = null;
  switch (type) {
    case 'text': {
      clip = { ...core, ...visualProps(p, path, raw, o), type, text: textStyle(p, `${path}.text`, raw.text, o) };
      const ta = animRefs(p, `${path}.textAnim`, raw.textAnim, true);
      if (ta) clip.textAnim = ta;
      if (raw.counter !== undefined) {
        const c = isObj(raw.counter) ? raw.counter : {};
        clip.counter = {
          from: num(p, `${path}.counter.from`, c.from, -1e12, 1e12, 0),
          to: num(p, `${path}.counter.to`, c.to, -1e12, 1e12, 100),
          decimals: Math.round(num(p, `${path}.counter.decimals`, c.decimals, 0, 6, 0)!),
          prefix: text(p, `${path}.counter.prefix`, c.prefix ?? '', 40, ''),
          suffix: text(p, `${path}.counter.suffix`, c.suffix ?? '', 40, ''),
          separator: bool(c.separator),
          ease: typeof c.ease === 'string' && (EASE_IDS as string[]).includes(c.ease) ? c.ease : 'easeOut',
          ...(c.duration !== undefined ? { duration: num(p, `${path}.counter.duration`, c.duration, 0.05, 3600, 1) } : {}),
        };
      }
      break;
    }
    case 'shape': {
      const s = isObj(raw.shape) ? raw.shape : {};
      if (!isObj(raw.shape)) p.error(`${path}.shape`, 'must be an object');
      const kind = typeof s.kind === 'string' && SHAPE_KINDS.includes(s.kind) ? s.kind : 'rect';
      if (kind !== s.kind) p.error(`${path}.shape.kind`, `unknown shape "${String(s.kind)}"`);
      const shape: Obj = {
        kind,
        width: num(p, `${path}.shape.width`, s.width, 0.5, 40000, 100),
        height: num(p, `${path}.shape.height`, s.height, 0.5, 40000, 100),
        fill: paint(p, `${path}.shape.fill`, s.fill ?? '#ffffff', o),
        radius: num(p, `${path}.shape.radius`, s.radius, 0, 20000, 0),
      };
      const stroke = strokeOf(p, `${path}.shape.stroke`, s.stroke, o);
      if (stroke) shape.stroke = stroke;
      const sh = shadow(p, `${path}.shape.shadow`, s.shadow, o);
      if (sh) shape.shadow = sh;
      if (s.slot === true) shape.slot = true;
      const pd = pathData(p, `${path}.shape.path`, s.path);
      if (pd) shape.path = pd;
      clip = { ...core, ...visualProps(p, path, raw, o), type, shape };
      break;
    }
    case 'sticker': {
      if (typeof raw.stickerId !== 'string' || !getSticker(raw.stickerId)) {
        p.error(`${path}.stickerId`, `unknown sticker "${String(raw.stickerId)}"`);
        break;
      }
      clip = { ...core, ...visualProps(p, path, raw, o), type, stickerId: raw.stickerId, size: num(p, `${path}.size`, raw.size, 4, 8000, 320) };
      if (raw.colors !== undefined) {
        if (!Array.isArray(raw.colors) || raw.colors.length > 12) p.error(`${path}.colors`, 'must be an array of at most 12 colours');
        else clip.colors = raw.colors.map((c, i) => color(p, `${path}.colors[${i}]`, c, o));
      }
      break;
    }
    case 'generator': {
      const def = typeof raw.generatorId === 'string' ? getGenerator(raw.generatorId) : undefined;
      if (!def) {
        p.error(`${path}.generatorId`, `unknown animated background "${String(raw.generatorId)}"`);
        break;
      }
      clip = { ...core, ...visualProps(p, path, raw, o), type, generatorId: def.id, params: paramValues(p, `${path}.params`, raw.params, def.params, o) };
      break;
    }
    case 'adjustment':
      clip = { ...core, ...visualProps(p, path, raw, o), type };
      break;
    case 'video':
    case 'image':
    case 'audio': {
      const asset = typeof raw.assetId === 'string' && o.assets ? o.assets[raw.assetId] : undefined;
      if (!asset) {
        p.error(`${path}.assetId`, o.assets ? 'references media that is not embedded in the template' : `${type} clips need embedded media; use a placeholder (shape with "slot": true) instead`);
        break;
      }
      if ((type === 'audio') !== (asset.kind === 'audio') || (type === 'image' && asset.kind === 'video') || (type === 'video' && asset.kind !== 'video')) {
        p.error(`${path}.assetId`, `a ${type} clip cannot use ${asset.kind} media`);
        break;
      }
      const media: Obj = { assetId: asset.id };
      if (type !== 'image') {
        Object.assign(media, {
          trimIn: num(p, `${path}.trimIn`, raw.trimIn, 0, 1e6, 0),
          speed: num(p, `${path}.speed`, raw.speed, 0.1, 16, 1),
          volume: num(p, `${path}.volume`, raw.volume, 0, 2, 1),
          muted: bool(raw.muted),
          fadeIn: num(p, `${path}.fadeIn`, raw.fadeIn, 0, 600, 0),
          fadeOut: num(p, `${path}.fadeOut`, raw.fadeOut, 0, 600, 0),
        });
        if (raw.reverse === true) media.reverse = true;
        if (raw.freeze === true) media.freeze = true;
      }
      clip = type === 'audio' ? { ...core, ...media, type } : { ...core, ...visualProps(p, path, raw, o), ...media, type };
      break;
    }
    default:
      p.error(`${path}.type`, `unsupported clip type "${String(type).slice(0, 30)}"`);
  }
  if (!clip || p.errors.length > errorsBefore) return null;
  return clip as unknown as Clip;
}

/** Sanitise a list of clips (at most MAX_TEMPLATE_CLIPS). Invalid clips are reported and dropped. */
export function sanitizeClips(p: Problems, path: string, raw: unknown, o: SanitizeOptions = {}): Clip[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    p.error(path, 'must be a non-empty array of clips');
    return [];
  }
  if (raw.length > MAX_TEMPLATE_CLIPS) {
    p.error(path, `has more than ${MAX_TEMPLATE_CLIPS} clips`);
    return [];
  }
  const out: Clip[] = [];
  raw.forEach((c, i) => {
    const clip = sanitizeClip(p, `${path}[${i}]`, c, o);
    if (clip) out.push(clip);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** True when any string in the clips is a palette or font token. */
export function usesTokens(clips: Clip[]): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === 'string') return TOKEN_RE.test(v) || FONT_TOKEN_RE.test(v);
    if (Array.isArray(v)) return v.some(walk);
    if (isObj(v)) return Object.values(v).some(walk);
    return false;
  };
  return walk(clips);
}

/** Replace palette / font tokens in place with the colours and fonts of an environment. */
export function resolveTokens(clips: Clip[], palette: Palette, fonts: FontPair): void {
  const colorOf = (s: string): string => {
    const m = TOKEN_RE.exec(s);
    if (!m) return s;
    const base = palette[m[1] as keyof Palette] as string;
    return m[2] !== undefined ? alpha(base, Math.min(100, Number(m[2])) / 100) : base;
  };
  const walk = (o: Obj): void => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') o[k] = colorOf(v);
      else if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'string' ? (v[i] = colorOf(item)) : isObj(item) && walk(item)));
      else if (isObj(v)) walk(v);
    }
  };
  for (const clip of clips) {
    if (clip.type === 'text') {
      const m = FONT_TOKEN_RE.exec(clip.text.fontFamily);
      if (m) {
        const role = fonts[m[1] as 'heading' | 'body'];
        clip.text.fontFamily = role.family;
        clip.text.fontWeight = nearestWeight(role.family, clip.text.fontWeight);
        if (role.uppercase) clip.text.uppercase = true;
        if (role.letterSpacing) clip.text.letterSpacing = role.letterSpacing;
      }
    }
    walk(clip as unknown as Obj);
  }
}

// ---------------------------------------------------------------------------------------------
// Aspect adaptation
// ---------------------------------------------------------------------------------------------

/** Design-px composition size of a frame (shorter side 1080). */
export function designOf(width: number, height: number): { cw: number; ch: number } {
  const k = 1080 / Math.min(width, height);
  return { cw: width * k, ch: height * k };
}

/** True when a shape covers (almost) the whole frame. */
const isFullFrame = (c: ShapeClip, cw: number, ch: number): boolean =>
  c.shape.width * Math.abs(c.transform.scaleX) >= cw * 0.95 && c.shape.height * Math.abs(c.transform.scaleY) >= ch * 0.95 && Math.abs(c.transform.x) < cw * 0.05 && Math.abs(c.transform.y) < ch * 0.05;

/**
 * Lay clips designed for a `from` frame out for a `to` frame (both in design px). Full-frame
 * shapes and placeholders stretch to the new frame, full-frame media keeps covering it, overlays
 * move proportionally and shrink only when they would no longer fit (see `reframeProject`).
 */
export function adaptClips(clips: Clip[], from: { cw: number; ch: number }, to: { cw: number; ch: number }, assets: Record<ID, MediaAsset> = {}): Clip[] {
  if (Math.abs(from.cw / from.ch - to.cw / to.ch) < 0.005) return clips;
  const kx = to.cw / from.cw;
  const ky = to.ch / from.ch;
  const stretched = new Set<ID>();
  for (const c of clips) {
    if (c.type === 'shape' && isFullFrame(c, from.cw, from.ch)) {
      c.shape.width *= kx;
      c.shape.height *= ky;
      stretched.add(c.id);
    }
  }
  const project = createProject({ width: Math.round(from.cw), height: Math.round(from.ch), fps: 30 });
  project.assets = { ...assets };
  for (const c of clips) project.clips[c.id] = c;
  const out = reframeProject(project, Math.round(to.cw), Math.round(to.ch), { focus: false });
  return clips.map((c) => {
    if (stretched.has(c.id)) return c;
    return out.clips[c.id] ?? c;
  });
}

// ---------------------------------------------------------------------------------------------
// TemplateDef from a static design
// ---------------------------------------------------------------------------------------------

export interface StaticTemplateSpec {
  id: string;
  name: string;
  category: TemplateCategory;
  tags: string[];
  duration: number;
  aspects?: AspectId[];
  poster?: number;
  music?: TemplateMusic;
  /** Frame the clips were designed for, in pixels (any resolution; only the aspect matters). */
  design: { width: number; height: number };
  /** Sanitised clips, ordered bottom → top, times relative to the template start. */
  clips: Clip[];
  assets?: MediaAsset[];
  origin: TemplateOrigin;
}

/** Wrap a static design into a TemplateDef the template engine can build for any frame. */
export function staticTemplateDef(spec: StaticTemplateSpec): TemplateDef {
  const themed = usesTokens(spec.clips);
  const from = designOf(spec.design.width, spec.design.height);
  const assetMap: Record<ID, MediaAsset> = {};
  for (const a of spec.assets ?? []) assetMap[a.id] = a;
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    tags: spec.tags,
    duration: spec.duration,
    ...(spec.aspects ? { aspects: spec.aspects } : {}),
    ...(spec.poster !== undefined ? { poster: spec.poster } : {}),
    ...(spec.music ? { music: spec.music } : {}),
    origin: spec.origin,
    fixed: !themed,
    ...(spec.assets?.length ? { assets: spec.assets } : {}),
    build: (env) => {
      const clips = (JSON.parse(JSON.stringify(spec.clips)) as Clip[]).map((c) => ({ ...c, id: uid('tc_'), trackId: '' }) as Clip);
      for (const c of clips) if (c.type !== 'audio') for (const fx of c.effects) fx.uid = uid('fx_');
      if (themed) resolveTokens(clips, env.palette, env.fonts);
      const adapted = adaptClips(clips, from, { cw: env.cw, ch: env.ch }, assetMap);
      // A shorter requested duration trims the design.
      return adapted
        .filter((c) => c.start < env.duration - 0.01)
        .map((c) => (c.start + c.duration > env.duration ? { ...c, duration: Math.max(0.05, env.duration - c.start) } : c));
    },
  };
}
