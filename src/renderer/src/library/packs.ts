/**
 * Content packs (`*.kinorapack`): data-only JSON documents that add palettes, font pairs,
 * filters, text presets, transitions / effects / animated backgrounds (GLSL snippets + params)
 * and static templates. Packs never execute code: everything is validated here before it is
 * registered, and GLSL is restricted to straight-line code with small constant-bounded loops so
 * a pack cannot hang the GPU. The format is documented in docs/PACKS.md.
 *
 * Pure (no DOM): shader compilation is injected through `PackValidationOptions.compile`.
 */

import { validateParams } from '@/engine/gl/shaderlib';
import { getSound, hasLibraryId, librarySource, type RuntimeContent, type RuntimeKind } from './index';
import { getBundledFont } from './fonts';
import { ASPECT_IDS, Problems, TEMPLATE_CATEGORIES, grade, isObj, sanitizeClips, scanJson, staticTemplateDef, withLookupOverlay, type StaticTemplateSpec } from './staticTemplates';
import type {
  AspectId,
  EffectCategory,
  EffectDef,
  FilterCategory,
  FilterDef,
  FontPair,
  FontRole,
  GeneratorCategory,
  GeneratorDef,
  Palette,
  ParamDef,
  TemplateCategory,
  TemplateDef,
  TemplateMusic,
  TextPresetCategory,
  TextPresetDef,
  TransitionCategory,
  TransitionDef,
} from './types';

export const PACK_FORMAT = 'kinora-pack';
export const PACK_VERSION = 1;
export const PACK_EXT = 'kinorapack';
/** Largest pack file accepted. */
export const MAX_PACK_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_GLSL = 24000;
/** Upper bound of iterations for a single GLSL loop. */
export const MAX_LOOP_ITERATIONS = 256;

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const TRANSITION_CATEGORIES: TransitionCategory[] = ['basic', 'wipe', 'slide', 'zoom', 'blur', 'glitch', 'light', 'shape', 'distort', '3d', 'stylized'];
const EFFECT_CATEGORIES: EffectCategory[] = ['blur', 'stylize', 'distort', 'glitch', 'retro', 'light', 'color', 'motion'];
const GENERATOR_CATEGORIES: GeneratorCategory[] = ['gradient', 'abstract', 'pattern', 'particles', 'light', 'retro'];
const FILTER_CATEGORIES: FilterCategory[] = ['cinematic', 'film', 'portrait', 'vivid', 'mono', 'retro', 'mood', 'nature'];
const TEXT_PRESET_CATEGORIES: TextPresetCategory[] = ['basic', 'title', 'subtitle', 'caption', 'social', 'neon', 'retro', 'elegant', 'bold', 'handwritten', 'lower-third'];
const PALETTE_KEYS = ['bg', 'bg2', 'surface', 'primary', 'secondary', 'accent', 'text', 'textMuted', 'onPrimary'] as const;
const HEX6 = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------------------------

/** A template stored in a pack: clip JSON laid out for `design` (see docs/PACKS.md). */
export interface PackTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  tags?: string[];
  duration: number;
  aspects?: AspectId[];
  poster?: number;
  music?: TemplateMusic;
  design: { width: number; height: number };
  clips: unknown[];
}

/** The `*.kinorapack` document. */
export interface ContentPack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  id: string;
  name: string;
  packVersion?: string;
  author?: string;
  description?: string;
  palettes?: Palette[];
  fontPairs?: FontPair[];
  filters?: FilterDef[];
  textPresets?: TextPresetDef[];
  transitions?: TransitionDef[];
  effects?: EffectDef[];
  generators?: GeneratorDef[];
  templates?: PackTemplate[];
}

export type PackItemKind = Exclude<keyof ContentPack, 'format' | 'version' | 'id' | 'name' | 'packVersion' | 'author' | 'description'>;
export const PACK_ITEM_KINDS: PackItemKind[] = ['palettes', 'fontPairs', 'filters', 'textPresets', 'transitions', 'effects', 'generators', 'templates'];

export const PACK_KIND_LABELS: Record<PackItemKind, string> = {
  palettes: 'palettes',
  fontPairs: 'font pairs',
  filters: 'filters',
  textPresets: 'text styles',
  transitions: 'transitions',
  effects: 'effects',
  generators: 'animated backgrounds',
  templates: 'templates',
};

export type ShaderKind = 'transition' | 'effect' | 'generator';

export interface PackValidationOptions {
  /**
   * Compile (and test-render) a shader; returns an error message or null. Injected by the
   * renderer (a throw-away WebGL2 context); omitted in unit tests.
   */
  compile?: (kind: ShaderKind, def: TransitionDef | EffectDef | GeneratorDef) => string | null;
  /** Pack id being replaced (re-installing / updating): its own item ids are not collisions. */
  replacing?: string;
}

export interface PackValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The sanitised pack (only when ok). */
  pack?: ContentPack;
  counts: Partial<Record<PackItemKind, number>>;
}

// ---------------------------------------------------------------------------------------------
// GLSL safety
// ---------------------------------------------------------------------------------------------

const LOOP_RE = /\bfor\s*\(\s*(?:int|float)\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*([A-Za-z_]\w*)\s*(<=|<|>=|>)\s*(-?\d+(?:\.\d+)?)\s*;\s*([A-Za-z_]\w*)\s*(\+\+|--|\+=\s*(\d+(?:\.\d+)?)|-=\s*(\d+(?:\.\d+)?))\s*\)/g;

/**
 * Static safety rules for pack GLSL. Returns problems (empty = fine):
 * - no preprocessor directives (`#define` could hide anything else), no `while` / `do` loops,
 * - every `for` loop must count a fresh variable between numeric literals with a literal step,
 *   at most MAX_LOOP_ITERATIONS times (GPU hangs are the one way a shader can hurt the user),
 * - no names reserved by the wrapper (`main`, `u_*`, `gl_*` declarations) and a size limit.
 */
export function glslSafetyProblems(glsl: string, entry: string): string[] {
  const out: string[] = [];
  if (glsl.length > MAX_GLSL) out.push(`is longer than ${MAX_GLSL} characters`);
  // Strip comments before scanning.
  const code = glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  if (/#/.test(code)) out.push('must not contain preprocessor directives (#…)');
  if (/\bwhile\b/.test(code)) out.push('must not use while loops');
  if (/\bdo\s*\{/.test(code) || /\bdo\b/.test(code)) out.push('must not use do / while loops');
  if (/\bvoid\s+main\s*\(/.test(code)) out.push('must not define main()');
  if (/\buniform\b/.test(code)) out.push('must not declare uniforms (params are declared automatically)');
  if (/\b(in|out)\s+(vec[234]|float|int)\s+\w+\s*;/.test(code)) out.push('must not declare in / out variables');
  if (!new RegExp(`\\b${entry}\\s*\\(`).test(code)) out.push(`must define ${entry}()`);
  const forCount = (code.match(/\bfor\s*\(/g) ?? []).length;
  let matched = 0;
  for (const m of code.matchAll(LOOP_RE)) {
    matched++;
    const [, v1, a, v2, op, b, v3, stepOp, inc, dec] = m;
    if (v1 !== v2 || v1 !== v3) {
      out.push(`loop "${m[0].slice(0, 60)}" must test and step its own counter`);
      continue;
    }
    const from = Number(a);
    const to = Number(b);
    const step = stepOp === '++' || stepOp === '--' ? 1 : Number(inc ?? dec);
    const up = stepOp === '++' || stepOp.startsWith('+=');
    if (!(step > 0) || (up && !op.startsWith('<')) || (!up && !op.startsWith('>'))) {
      out.push(`loop "${m[0].slice(0, 60)}" never ends`);
      continue;
    }
    const span = Math.abs(to - from) / step;
    const iterations = op.endsWith('=') ? Math.floor(span) + 1 : Math.ceil(span);
    if (iterations > MAX_LOOP_ITERATIONS) out.push(`loop "${m[0].slice(0, 60)}" runs ${Math.round(iterations)} times (max ${MAX_LOOP_ITERATIONS})`);
  }
  if (matched !== forCount) out.push('every for loop must have the form for (int i = 0; i < 16; i++) with literal bounds');
  // A loop counter must not be modified inside the loop body: forbid assignments to any counter
  // name outside its header.
  for (const m of code.matchAll(LOOP_RE)) {
    const name = m[1];
    const body = code.replace(m[0], '');
    if (new RegExp(`\\b${name}\\s*(\\+\\+|--|[-+*/]?=(?!=))`).test(body.replace(new RegExp(`\\b(int|float)\\s+${name}\\s*=`, 'g'), ''))) {
      out.push(`loop counter "${name}" must not be changed inside the loop`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const str = (p: Problems, path: string, v: unknown, max: number, required = true): string | undefined => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || (required && !v.trim())) {
    p.error(path, required ? 'is required (text)' : 'must be text');
    return undefined;
  }
  if (v.length > max) p.error(path, `is longer than ${max} characters`);
  return v.slice(0, max);
};

const oneOf = <T extends string>(p: Problems, path: string, v: unknown, list: readonly T[]): T | undefined => {
  if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T;
  p.error(path, `must be one of: ${list.join(', ')}`);
  return undefined;
};

const numIn = (p: Problems, path: string, v: unknown, lo: number, hi: number, fallback?: number): number | undefined => {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    p.error(path, `must be a number within ${lo}..${hi}`);
    return undefined;
  }
  return v;
};

function checkFont(p: Problems, path: string, family: unknown, weight: unknown): void {
  const font = typeof family === 'string' ? getBundledFont(family) : undefined;
  if (!font) return p.error(`${path}.family`, `font "${String(family)}" is not bundled with Kinora`);
  if (typeof weight !== 'number' || !font.weights.includes(weight)) p.error(`${path}.weight`, `"${font.family}" has no weight ${String(weight)} (available: ${font.weights.join(', ')})`);
}

function fontRole(p: Problems, path: string, v: unknown): FontRole | undefined {
  if (!isObj(v)) return void p.error(path, 'must be { family, weight }');
  checkFont(p, path, v.family, v.weight);
  const role: FontRole = { family: v.family as FontRole['family'], weight: v.weight as number };
  if (v.uppercase === true) role.uppercase = true;
  if (v.letterSpacing !== undefined) {
    const ls = numIn(p, `${path}.letterSpacing`, v.letterSpacing, -0.2, 1);
    if (ls !== undefined) role.letterSpacing = ls;
  }
  return role;
}

function params(p: Problems, path: string, v: unknown): ParamDef[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 24) {
    p.error(path, 'must be an array of at most 24 params');
    return [];
  }
  const out: ParamDef[] = [];
  v.forEach((raw, i) => {
    const pp = `${path}[${i}]`;
    if (!isObj(raw)) return p.error(pp, 'must be an object');
    const type = oneOf(p, `${pp}.type`, raw.type, ['float', 'int', 'bool', 'color', 'select'] as const);
    const key = str(p, `${pp}.key`, raw.key, 40);
    const label = str(p, `${pp}.label`, raw.label, 60);
    if (!type || !key || !label) return;
    const def: ParamDef = { key, label, type, default: raw.default as ParamDef['default'] };
    if (type === 'color' && !(typeof raw.default === 'string' && HEX6.test(raw.default))) p.error(`${pp}.default`, 'must be a #rrggbb colour');
    if (type === 'bool' && typeof raw.default !== 'boolean') p.error(`${pp}.default`, 'must be true or false');
    if (type === 'float' || type === 'int' || type === 'select') {
      if (typeof raw.default !== 'number' || !Number.isFinite(raw.default)) p.error(`${pp}.default`, 'must be a number');
      for (const k of ['min', 'max', 'step'] as const) {
        if (raw[k] === undefined) continue;
        const n = numIn(p, `${pp}.${k}`, raw[k], -1e6, 1e6);
        if (n !== undefined) def[k] = n;
      }
      if (def.min !== undefined && def.max !== undefined && def.min > def.max) p.error(pp, 'min is greater than max');
    }
    if (raw.unit !== undefined) def.unit = str(p, `${pp}.unit`, raw.unit, 12);
    if (type === 'select') {
      if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.length > 32) p.error(`${pp}.options`, 'select params need 1..32 options');
      else
        def.options = raw.options.map((o, j) => {
          const op = isObj(o) ? o : {};
          return { label: str(p, `${pp}.options[${j}].label`, op.label, 60) ?? '', value: numIn(p, `${pp}.options[${j}].value`, op.value, -1e6, 1e6) ?? 0 };
        });
    }
    out.push(def);
  });
  const bad = validateParams(out);
  if (bad) p.error(path, bad);
  return out;
}

interface Ctx {
  p: Problems;
  opts: PackValidationOptions;
  packId: string;
  seen: Map<string, Set<string>>;
}

function itemBase(ctx: Ctx, kind: RuntimeKind, path: string, raw: Record<string, unknown>): { id: string; name: string } | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!ITEM_ID_RE.test(id)) {
    ctx.p.error(`${path}.id`, `"${String(raw.id).slice(0, 70)}" must be 2..64 lower-case letters, digits or dashes`);
    return null;
  }
  const seen = ctx.seen.get(kind) ?? new Set<string>();
  ctx.seen.set(kind, seen);
  if (seen.has(id)) ctx.p.error(`${path}.id`, `"${id}" is used twice in this pack`);
  seen.add(id);
  if (hasLibraryId(kind, id)) {
    const owner = librarySource(kind, id);
    const own = ctx.opts.replacing && owner === `pack:${ctx.opts.replacing}`;
    if (!own) ctx.p.error(`${path}.id`, `"${id}" is already used by ${owner ? (owner.startsWith('pack:') ? `the pack "${owner.slice(5)}"` : 'one of your templates') : 'a built-in item'}; prefix ids with the pack id`);
  }
  const name = str(ctx.p, `${path}.name`, raw.name, 80) ?? id;
  return { id, name };
}

function list(ctx: Ctx, pack: Record<string, unknown>, kind: PackItemKind): Record<string, unknown>[] {
  const v = pack[kind];
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.p.error(kind, 'must be an array');
    return [];
  }
  if (v.length > MAX_ITEMS) {
    ctx.p.error(kind, `has more than ${MAX_ITEMS} items`);
    return [];
  }
  return v.map((item, i) => {
    if (!isObj(item)) ctx.p.error(`${kind}[${i}]`, 'must be an object');
    return isObj(item) ? item : {};
  });
}

function shader<T extends TransitionDef | EffectDef | GeneratorDef>(ctx: Ctx, kind: ShaderKind, path: string, def: T): void {
  const entry = kind === 'transition' ? 'transition' : kind === 'effect' ? 'effect' : 'generate';
  for (const problem of glslSafetyProblems(def.glsl, entry)) ctx.p.error(`${path}.glsl`, problem);
  if (ctx.p.errors.length === 0 && ctx.opts.compile) {
    const err = ctx.opts.compile(kind, def);
    if (err) ctx.p.error(`${path}.glsl`, `does not compile: ${err.split('\n').slice(0, 3).join(' / ')}`);
  }
}

/**
 * Validate a pack document (already parsed or as text). Never throws. On success `pack` holds a
 * sanitised copy containing only known fields.
 */
export function validatePack(input: unknown, opts: PackValidationOptions = {}): PackValidation {
  const p = new Problems(80);
  const counts: PackValidation['counts'] = {};
  const fail = (): PackValidation => ({ ok: false, errors: p.errors, warnings: p.warnings, counts });
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_PACK_BYTES) {
      p.error('pack', `is larger than ${MAX_PACK_BYTES / 1024 / 1024} MB`);
      return fail();
    }
    try {
      raw = JSON.parse(input);
    } catch (err) {
      p.error('pack', `is not valid JSON (${(err as Error).message})`);
      return fail();
    }
  }
  if (!isObj(raw)) {
    p.error('pack', 'must be a JSON object');
    return fail();
  }
  const scan = scanJson(raw);
  if (scan) {
    p.error('pack', scan);
    return fail();
  }
  if (raw.format !== PACK_FORMAT) p.error('format', `must be "${PACK_FORMAT}"`);
  if (raw.version !== PACK_VERSION) p.error('version', `must be ${PACK_VERSION} (this pack needs a ${typeof raw.version === 'number' && raw.version > PACK_VERSION ? 'newer' : 'different'} version of Kinora)`);
  const packId = typeof raw.id === 'string' && PACK_ID_RE.test(raw.id) ? raw.id : '';
  if (!packId) p.error('id', 'must be 2..48 lower-case letters, digits or dashes');
  const name = str(p, 'name', raw.name, 80);
  const known = new Set(['format', 'version', 'id', 'name', 'packVersion', 'author', 'description', '$schema', ...PACK_ITEM_KINDS]);
  for (const k of Object.keys(raw)) if (!known.has(k)) p.warn(k, 'unknown field ignored');
  if (!p.ok) return fail();

  const ctx: Ctx = { p, opts, packId, seen: new Map() };
  const pack: ContentPack = { format: PACK_FORMAT, version: PACK_VERSION, id: packId, name: name! };
  const packVersion = str(p, 'packVersion', raw.packVersion, 24, false);
  const author = str(p, 'author', raw.author, 80, false);
  const description = str(p, 'description', raw.description, 600, false);
  if (packVersion) pack.packVersion = packVersion;
  if (author) pack.author = author;
  if (description) pack.description = description;

  // Palettes ------------------------------------------------------------------------------------
  const palettes: Palette[] = [];
  list(ctx, raw, 'palettes').forEach((r, i) => {
    const path = `palettes[${i}]`;
    const base = itemBase(ctx, 'palettes', path, r);
    if (!base) return;
    const pal: Record<string, unknown> = { ...base };
    for (const key of PALETTE_KEYS) {
      if (typeof r[key] === 'string' && HEX6.test(r[key] as string)) pal[key] = (r[key] as string).toLowerCase();
      else p.error(`${path}.${key}`, 'must be a #rrggbb colour');
    }
    pal.dark = r.dark === true;
    if (typeof r.dark !== 'boolean') p.error(`${path}.dark`, 'must be true or false');
    palettes.push(pal as unknown as Palette);
  });

  // Font pairs ----------------------------------------------------------------------------------
  const fontPairs: FontPair[] = [];
  list(ctx, raw, 'fontPairs').forEach((r, i) => {
    const path = `fontPairs[${i}]`;
    const base = itemBase(ctx, 'fontPairs', path, r);
    const heading = fontRole(p, `${path}.heading`, r.heading);
    const body = fontRole(p, `${path}.body`, r.body);
    if (base && heading && body) fontPairs.push({ ...base, heading, body });
  });

  // Filters ---------------------------------------------------------------------------------------
  const filters: FilterDef[] = [];
  list(ctx, raw, 'filters').forEach((r, i) => {
    const path = `filters[${i}]`;
    const base = itemBase(ctx, 'filters', path, r);
    const category = oneOf(p, `${path}.category`, r.category, FILTER_CATEGORIES);
    const g = grade(p, `${path}.grade`, r.grade);
    if (g && Object.keys(g).length === 0) p.error(`${path}.grade`, 'must change at least one value');
    if (r.grade === undefined) p.error(`${path}.grade`, 'is required');
    if (base && category && g) filters.push({ ...base, category, grade: g });
  });

  // Text presets ----------------------------------------------------------------------------------
  const textPresets: TextPresetDef[] = [];
  list(ctx, raw, 'textPresets').forEach((r, i) => {
    const path = `textPresets[${i}]`;
    const base = itemBase(ctx, 'textPresets', path, r);
    const category = oneOf(p, `${path}.category`, r.category, TEXT_PRESET_CATEGORIES);
    const sample = str(p, `${path}.sample`, r.sample, 200);
    // Reuse the clip sanitiser for the style: a text clip with this style must be valid.
    const style = isObj(r.style) ? r.style : {};
    if (!isObj(r.style)) p.error(`${path}.style`, 'must be an object');
    if (style.content !== undefined || style.boxWidth !== undefined) p.error(`${path}.style`, 'must not set content or boxWidth');
    const clip = sanitizeClips(p, `${path}`, [{ type: 'text', start: 0, duration: 1, text: { ...style, content: sample ?? 'Text' }, anim: r.anim, textAnim: r.textAnim }])[0];
    if (!base || !category || !sample || !clip || clip.type !== 'text') return;
    const { content: _c, ...cleanStyle } = clip.text;
    // Only keep the fields the pack actually set (presets are partial styles).
    const partial: Record<string, unknown> = {};
    for (const k of Object.keys(style)) if (k in cleanStyle) partial[k] = (cleanStyle as unknown as Record<string, unknown>)[k];
    const preset: TextPresetDef = { ...base, category, sample, style: partial as TextPresetDef['style'] };
    if (clip.anim) preset.anim = clip.anim;
    if (clip.textAnim) preset.textAnim = clip.textAnim;
    textPresets.push(preset);
  });

  // Shaders ------------------------------------------------------------------------------------
  const transitions: TransitionDef[] = [];
  list(ctx, raw, 'transitions').forEach((r, i) => {
    const path = `transitions[${i}]`;
    const base = itemBase(ctx, 'transitions', path, r);
    const category = oneOf(p, `${path}.category`, r.category, TRANSITION_CATEGORIES);
    const glsl = str(p, `${path}.glsl`, r.glsl, MAX_GLSL);
    const ps = params(p, `${path}.params`, r.params);
    const duration = numIn(p, `${path}.duration`, r.duration, 0.1, 5, 0.6);
    if (!base || !category || !glsl) return;
    const def: TransitionDef = { ...base, category, glsl, params: ps, duration };
    shader(ctx, 'transition', path, def);
    transitions.push(def);
  });
  const effects: EffectDef[] = [];
  list(ctx, raw, 'effects').forEach((r, i) => {
    const path = `effects[${i}]`;
    const base = itemBase(ctx, 'effects', path, r);
    const category = oneOf(p, `${path}.category`, r.category, EFFECT_CATEGORIES);
    const glsl = str(p, `${path}.glsl`, r.glsl, MAX_GLSL);
    const ps = params(p, `${path}.params`, r.params);
    const passes = numIn(p, `${path}.passes`, r.passes, 1, 4, 1);
    if (!base || !category || !glsl) return;
    const def: EffectDef = { ...base, category, glsl, params: ps, passes: Math.round(passes ?? 1), ...(r.animated === true ? { animated: true } : {}) };
    shader(ctx, 'effect', path, def);
    effects.push(def);
  });
  const generators: GeneratorDef[] = [];
  list(ctx, raw, 'generators').forEach((r, i) => {
    const path = `generators[${i}]`;
    const base = itemBase(ctx, 'generators', path, r);
    const category = oneOf(p, `${path}.category`, r.category, GENERATOR_CATEGORIES);
    const glsl = str(p, `${path}.glsl`, r.glsl, MAX_GLSL);
    const ps = params(p, `${path}.params`, r.params);
    if (!base || !category || !glsl) return;
    const def: GeneratorDef = { ...base, category, glsl, params: ps };
    shader(ctx, 'generator', path, def);
    generators.push(def);
  });

  // Templates ----------------------------------------------------------------------------------
  // Pack templates may use the pack's own effects / generators / filters: register them in a
  // look-up overlay while validating clips.
  const templates: PackTemplate[] = [];
  const tplItems = list(ctx, raw, 'templates');
  if (tplItems.length) {
    withLookupOverlay({ effects, generators, filters }, () => {
      tplItems.forEach((r, i) => {
        const path = `templates[${i}]`;
        const base = itemBase(ctx, 'templates', path, r);
        const category = oneOf(p, `${path}.category`, r.category, TEMPLATE_CATEGORIES);
        const duration = numIn(p, `${path}.duration`, r.duration, 1, 120);
        const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 40)).slice(0, 24) : [];
        if (r.tags !== undefined && !Array.isArray(r.tags)) p.error(`${path}.tags`, 'must be an array of strings');
        let aspects: AspectId[] | undefined;
        if (r.aspects !== undefined) {
          if (!Array.isArray(r.aspects) || r.aspects.length === 0 || r.aspects.some((a) => !ASPECT_IDS.includes(a as AspectId))) p.error(`${path}.aspects`, `must list some of ${ASPECT_IDS.join(', ')}`);
          else aspects = [...new Set(r.aspects as AspectId[])];
        }
        const design = isObj(r.design) ? r.design : {};
        const width = numIn(p, `${path}.design.width`, design.width, 16, 8192);
        const height = numIn(p, `${path}.design.height`, design.height, 16, 8192);
        const poster = r.poster === undefined ? undefined : numIn(p, `${path}.poster`, r.poster, 0, 1);
        let music: TemplateMusic | undefined;
        if (r.music !== undefined) {
          const m = isObj(r.music) ? r.music : {};
          const sound = typeof m.soundId === 'string' ? getSound(m.soundId) : undefined;
          if (!sound || sound.category !== 'music') p.error(`${path}.music.soundId`, `"${String(m.soundId)}" is not a music bed`);
          else {
            music = { soundId: sound.id };
            if (m.volume !== undefined) music.volume = numIn(p, `${path}.music.volume`, m.volume, 0, 2);
            if (m.fadeIn !== undefined) music.fadeIn = numIn(p, `${path}.music.fadeIn`, m.fadeIn, 0, 10);
            if (m.fadeOut !== undefined) music.fadeOut = numIn(p, `${path}.music.fadeOut`, m.fadeOut, 0, 10);
          }
        }
        const clips = sanitizeClips(p, `${path}.clips`, r.clips, { tokens: true });
        if (duration !== undefined) {
          clips.forEach((c, j) => {
            if (c.start + c.duration > duration + 0.001) p.error(`${path}.clips[${j}]`, `ends at ${(c.start + c.duration).toFixed(2)}s, after the template duration ${duration}s`);
          });
        }
        if (!base || !category || duration === undefined || width === undefined || height === undefined) return;
        const tpl: PackTemplate = { ...base, category, tags, duration, design: { width, height }, clips };
        if (aspects) tpl.aspects = aspects;
        if (poster !== undefined) tpl.poster = poster;
        if (music) tpl.music = music;
        templates.push(tpl);
      });
    });
  }

  if (!p.ok) return fail();
  const total = palettes.length + fontPairs.length + filters.length + textPresets.length + transitions.length + effects.length + generators.length + templates.length;
  if (total === 0) {
    p.error('pack', 'contains no items');
    return fail();
  }
  const add = <K extends PackItemKind>(kind: K, items: NonNullable<ContentPack[K]>): void => {
    if (items.length) {
      pack[kind] = items;
      counts[kind] = items.length;
    }
  };
  add('palettes', palettes);
  add('fontPairs', fontPairs);
  add('filters', filters);
  add('textPresets', textPresets);
  add('transitions', transitions);
  add('effects', effects);
  add('generators', generators);
  add('templates', templates);
  return { ok: true, errors: [], warnings: p.warnings, pack, counts };
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

/** Library content of a validated pack. */
export function packContent(pack: ContentPack): RuntimeContent {
  const templates: TemplateDef[] = (pack.templates ?? []).map((t) => {
    const spec: StaticTemplateSpec = {
      id: t.id,
      name: t.name,
      category: t.category,
      tags: t.tags ?? [],
      duration: t.duration,
      design: t.design,
      // Validated clips are sanitised already; sanitise once more defensively is unnecessary.
      clips: t.clips as StaticTemplateSpec['clips'],
      origin: { kind: 'pack', id: pack.id },
      ...(t.aspects ? { aspects: t.aspects } : {}),
      ...(t.poster !== undefined ? { poster: t.poster } : {}),
      ...(t.music ? { music: t.music } : {}),
    };
    return staticTemplateDef(spec);
  });
  return {
    palettes: pack.palettes,
    fontPairs: pack.fontPairs,
    filters: pack.filters,
    textPresets: pack.textPresets,
    transitions: pack.transitions,
    effects: pack.effects,
    generators: pack.generators,
    templates,
  };
}

/** Total number of items in a pack. */
export const packItemCount = (pack: ContentPack): number => PACK_ITEM_KINDS.reduce((n, k) => n + ((pack[k] as unknown[] | undefined)?.length ?? 0), 0);

/** "3 palettes, 1 filter…" summary. */
export function packSummary(pack: ContentPack): string {
  const parts: string[] = [];
  for (const k of PACK_ITEM_KINDS) {
    const n = (pack[k] as unknown[] | undefined)?.length ?? 0;
    if (n) parts.push(`${n} ${n === 1 ? PACK_KIND_LABELS[k].replace(/s$/, '') : PACK_KIND_LABELS[k]}`);
  }
  return parts.join(', ');
}

