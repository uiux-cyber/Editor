/**
 * Library checker — runs inside a hidden Electron window (real Chromium + WebGL2 + Web Audio)
 * and validates every content pack against the contracts in `src/renderer/src/library/types.ts`.
 * Results are reported through console lines prefixed with `__CHECK__` / `__DONE__`.
 */

import * as L from '@/library';
import { getBundledFont } from '@/library/fonts';
import { FULLSCREEN_VERT, createProgram, setParamUniforms, validateParams, wrapEffect, wrapGenerator, wrapTransition, type Program } from '@/engine/gl/shaderlib';
import '@/styles/fonts';
import { preloadBundledFonts } from '@/engine/sources/text';
import { NEUTRAL_GRADE } from '@/core/factory';
import { Ease, seededRandom } from '@/core/easing';
import { MAX_COUNTER_DECIMALS, formatCounter } from '@/core/counter';
import type { Clip, ClipAnimations, MediaAsset } from '@/core/types';
import type { AnimMod, AspectId, FontPair, GlyphMod, Palette, TemplateEnv, TextPresetDef } from '@/library/types';
import { packContent, validatePack } from '@/library/packs';
import { registerContent } from '@/library';
import { templateMotion } from '@/library/templateEngine';
import { ARCHETYPES, generatedId, generatedTemplate } from '@/library/templates/_gen';

type Level = 'error' | 'warn';
interface Issue {
  pack: string;
  id: string;
  level: Level;
  msg: string;
}

const issues: Issue[] = [];
const counts: Record<string, number> = {};
const report = (pack: string, id: string, level: Level, msg: string): void => {
  issues.push({ pack, id, level, msg });
};

const params = new URLSearchParams(location.search);
const requested = (params.get('packs') || '').split(',').filter(Boolean);
const wants = (pack: string): boolean => requested.length === 0 || requested.includes(pack);

const W = 96;
const H = 54;

// ---------------------------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------------------------

const canvas = document.createElement('canvas');
canvas.width = W;
canvas.height = H;
const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })!;

function makeTexture(pixels: Uint8Array | null): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function makeTarget(): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = makeTexture(null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

function pattern(kind: 'a' | 'b'): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (kind === 'a') {
        const c = (Math.floor(x / 12) + Math.floor(y / 12)) % 2;
        px[i] = c ? 230 : 40;
        px[i + 1] = Math.round((x / W) * 200) + 30;
        px[i + 2] = c ? 60 : 200;
      } else {
        px[i] = Math.round((y / H) * 255);
        px[i + 1] = 90;
        px[i + 2] = Math.round((1 - x / W) * 255);
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

let quadReady = false;
function drawQuad(): void {
  if (!quadReady) {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    quadReady = true;
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function readTarget(fbo: WebGLFramebuffer): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

const meanDiff = (a: Uint8Array, b: Uint8Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
};
const meanAlpha = (a: Uint8Array): number => {
  let s = 0;
  for (let i = 3; i < a.length; i += 4) s += a[i];
  return s / (a.length / 4) / 255;
};
const variance = (a: Uint8Array): number => {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const v = (a[i] + a[i + 1] + a[i + 2]) / 3;
    s += v;
    s2 += v * v;
    n++;
  }
  const m = s / n;
  return s2 / n - m * m;
};

function bindTex(prog: Program, name: string, unit: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.loc(name), unit);
}

// ---------------------------------------------------------------------------------------------
// Shader packs
// ---------------------------------------------------------------------------------------------

function checkTransitions(): void {
  const texA = makeTexture(pattern('a'));
  const texB = makeTexture(pattern('b'));
  const target = makeTarget();
  const render = (prog: Program, def: (typeof L.TRANSITIONS)[number], p: number): Uint8Array => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog.program);
    bindTex(prog, 'u_from', 0, texA);
    bindTex(prog, 'u_to', 1, texB);
    gl.uniform1f(prog.loc('progress'), p);
    gl.uniform1f(prog.loc('ratio'), W / H);
    setParamUniforms(gl, prog, def.params, undefined);
    drawQuad();
    return readTarget(target.fbo);
  };
  const ref = (which: 'From' | 'To'): Uint8Array => {
    const def = { id: '_ref', name: '', category: 'basic' as const, glsl: `vec4 transition(vec2 uv){ return get${which}Color(uv); }` };
    return render(createProgram(gl, FULLSCREEN_VERT, wrapTransition(def)), def, 0);
  };
  const from = ref('From');
  const to = ref('To');
  for (const def of L.TRANSITIONS) {
    const bad = validateParams(def.params);
    if (bad) report('transitions', def.id, 'error', bad);
    try {
      const prog = createProgram(gl, FULLSCREEN_VERT, wrapTransition(def));
      const d0 = meanDiff(render(prog, def, 0), from);
      const d1 = meanDiff(render(prog, def, 1), to);
      const mid = render(prog, def, 0.5);
      if (d0 > 0.03) report('transitions', def.id, 'error', `progress=0 differs from the outgoing picture (mean diff ${d0.toFixed(3)})`);
      if (d1 > 0.03) report('transitions', def.id, 'error', `progress=1 differs from the incoming picture (mean diff ${d1.toFixed(3)})`);
      if (meanAlpha(mid) < 0.2) report('transitions', def.id, 'warn', 'frame is mostly transparent at progress=0.5');
      if (meanDiff(mid, from) < 0.004 && meanDiff(mid, to) < 0.004) report('transitions', def.id, 'warn', 'progress=0.5 looks identical to an endpoint');
      gl.deleteProgram(prog.program);
    } catch (err) {
      report('transitions', def.id, 'error', `GLSL: ${(err as Error).message}`);
    }
  }
  counts.transitions = L.TRANSITIONS.length;
}

function checkEffects(): void {
  const src = makeTexture(pattern('a'));
  const a = makeTarget();
  const b = makeTarget();
  const input = pattern('a');
  for (const def of L.EFFECTS) {
    const bad = validateParams(def.params);
    if (bad) report('effects', def.id, 'error', bad);
    try {
      const prog = createProgram(gl, FULLSCREEN_VERT, wrapEffect(def));
      const passes = Math.max(1, def.passes ?? 1);
      let read = src;
      let out = a;
      for (let pass = 0; pass < passes; pass++) {
        out = pass % 2 === 0 ? a : b;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, W, H);
        gl.useProgram(prog.program);
        bindTex(prog, 'u_tex', 0, read);
        bindTex(prog, 'u_orig', 1, src);
        gl.uniform2f(prog.loc('u_res'), W, H);
        gl.uniform1f(prog.loc('u_px'), H / 1080);
        gl.uniform1f(prog.loc('u_time'), 0.73);
        gl.uniform1f(prog.loc('u_progress'), 0.4);
        gl.uniform1f(prog.loc('u_aspect'), W / H);
        gl.uniform1i(prog.loc('u_pass'), pass);
        setParamUniforms(gl, prog, def.params, undefined);
        drawQuad();
        read = out.tex;
      }
      const result = readTarget(out.fbo);
      if (meanAlpha(result) < 0.05) report('effects', def.id, 'error', 'output is fully transparent with default params');
      if (meanDiff(result, input) < 0.002) report('effects', def.id, 'warn', 'default params produce no visible change');
      gl.deleteProgram(prog.program);
    } catch (err) {
      report('effects', def.id, 'error', `GLSL: ${(err as Error).message}`);
    }
  }
  counts.effects = L.EFFECTS.length;
}

function checkGenerators(): void {
  const target = makeTarget();
  for (const def of L.GENERATORS) {
    const bad = validateParams(def.params);
    if (bad) report('generators', def.id, 'error', bad);
    try {
      const prog = createProgram(gl, FULLSCREEN_VERT, wrapGenerator(def));
      const frames: Uint8Array[] = [];
      for (const time of [0, 2.5]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, W, H);
        gl.useProgram(prog.program);
        gl.uniform2f(prog.loc('u_res'), W, H);
        gl.uniform1f(prog.loc('u_px'), H / 1080);
        gl.uniform1f(prog.loc('u_time'), time);
        gl.uniform1f(prog.loc('u_aspect'), W / H);
        setParamUniforms(gl, prog, def.params, undefined);
        drawQuad();
        frames.push(readTarget(target.fbo));
      }
      if (meanAlpha(frames[0]) < 0.02) report('generators', def.id, 'error', 'output is fully transparent');
      if (variance(frames[0]) < 0.5 && variance(frames[1]) < 0.5) report('generators', def.id, 'warn', 'output is a flat colour');
      gl.deleteProgram(prog.program);
    } catch (err) {
      report('generators', def.id, 'error', `GLSL: ${(err as Error).message}`);
    }
  }
  counts.generators = L.GENERATORS.length;
}

// ---------------------------------------------------------------------------------------------
// Data packs
// ---------------------------------------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function checkFilters(): void {
  const ranges: Record<string, [number, number]> = {
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
  for (const def of L.FILTERS) {
    const keys = Object.keys(def.grade);
    if (keys.length === 0) report('filters', def.id, 'error', 'empty grade');
    for (const key of keys) {
      const value = (def.grade as Record<string, unknown>)[key];
      if (!(key in NEUTRAL_GRADE)) {
        report('filters', def.id, 'error', `unknown grade field "${key}"`);
      } else if (key in ranges) {
        const [lo, hi] = ranges[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
          report('filters', def.id, 'error', `${key}=${String(value)} is outside ${lo}..${hi}`);
        }
      } else if (typeof value !== 'string' || !HEX.test(value)) {
        report('filters', def.id, 'error', `${key} must be a hex colour`);
      }
    }
  }
  counts.filters = L.FILTERS.length;
}

const finite = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function neutralMod(m: AnimMod | GlyphMod, em: boolean): string | null {
  const tol = em ? 0.01 : 0.6;
  const mm = m as AnimMod;
  if (Math.abs(m.x ?? 0) > tol || Math.abs(m.y ?? 0) > tol) return 'offset';
  if (Math.abs((m.scale ?? 1) - 1) > 0.005) return 'scale';
  if (Math.abs((mm.scaleX ?? 1) - 1) > 0.005 || Math.abs((mm.scaleY ?? 1) - 1) > 0.005) return 'scaleX/scaleY';
  if (Math.abs(m.rotation ?? 0) > 0.2) return 'rotation';
  if (Math.abs((m.opacity ?? 1) - 1) > 0.01) return 'opacity';
  if (Math.abs(m.blur ?? 0) > (em ? 0.005 : 0.2)) return 'blur';
  if ((mm.clipL ?? 0) > 0.005 || (mm.clipR ?? 0) > 0.005 || (mm.clipT ?? 0) > 0.005 || (mm.clipB ?? 0) > 0.005) return 'clip';
  return null;
}

function sameMod(a: AnimMod | GlyphMod, b: AnimMod | GlyphMod, em: boolean): boolean {
  const keys = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur', 'clipL', 'clipR', 'clipT', 'clipB'] as const;
  const defaults: Record<string, number> = { scale: 1, scaleX: 1, scaleY: 1, opacity: 1 };
  for (const k of keys) {
    const av = ((a as Record<string, number | undefined>)[k] ?? defaults[k] ?? 0) as number;
    const bv = ((b as Record<string, number | undefined>)[k] ?? defaults[k] ?? 0) as number;
    const tol = k === 'x' || k === 'y' ? (em ? 0.01 : 0.6) : k === 'rotation' ? 0.3 : 0.01;
    if (Math.abs(av - bv) > tol) return false;
  }
  return true;
}

function checkModValues(pack: string, id: string, m: AnimMod | GlyphMod, p: number): void {
  for (const [k, v] of Object.entries(m)) {
    if (!finite(v)) report(pack, id, 'error', `apply(${p.toFixed(2)}) returned non-finite ${k}`);
  }
  if (m.opacity !== undefined && (m.opacity < -0.001 || m.opacity > 1.001)) report(pack, id, 'error', `opacity ${m.opacity} outside 0..1 at p=${p.toFixed(2)}`);
  if (m.blur !== undefined && m.blur < 0) report(pack, id, 'error', `negative blur at p=${p.toFixed(2)}`);
  const mm = m as AnimMod;
  for (const k of ['clipL', 'clipR', 'clipT', 'clipB'] as const) {
    const v = mm[k];
    if (v !== undefined && (v < -0.001 || v > 1.001)) report(pack, id, 'error', `${k} ${v} outside 0..1 at p=${p.toFixed(2)}`);
  }
}

function checkAnimations(): void {
  const env = { w: 800, h: 450, cw: 1920, ch: 1080 };
  for (const def of L.ANIMATIONS) {
    try {
      if (!(def.duration > 0)) report('animations', def.id, 'error', 'duration must be > 0');
      for (let i = 0; i <= 20; i++) checkModValues('animations', def.id, def.apply(i / 20, env), i / 20);
      if (def.kind === 'in') {
        const n = neutralMod(def.apply(1, env), false);
        if (n) report('animations', def.id, 'error', `apply(1) is not neutral (${n})`);
      } else if (def.kind === 'out') {
        const n = neutralMod(def.apply(0, env), false);
        if (n) report('animations', def.id, 'error', `apply(0) is not neutral (${n})`);
      } else if (!sameMod(def.apply(0, env), def.apply(1, env), false)) {
        report('animations', def.id, 'error', 'loop is not seamless: apply(0) differs from apply(1)');
      }
    } catch (err) {
      report('animations', def.id, 'error', `apply threw: ${(err as Error).message}`);
    }
  }
  counts.animations = L.ANIMATIONS.length;
}

function checkTextAnimations(): void {
  for (const def of L.TEXT_ANIMATIONS) {
    try {
      if (!(def.duration > 0)) report('textAnimations', def.id, 'error', 'duration must be > 0');
      if (!(def.stagger >= 0 && def.stagger <= 1)) report('textAnimations', def.id, 'error', 'stagger must be within 0..1');
      for (const index of [0, 3, 7]) {
        const env = { index, count: 8, time: 0.4 };
        for (let i = 0; i <= 20; i++) checkModValues('textAnimations', def.id, def.apply(i / 20, env), i / 20);
        if (def.kind === 'in') {
          const n = neutralMod(def.apply(1, env), true);
          if (n) report('textAnimations', def.id, 'error', `apply(1) is not neutral (${n})`);
        } else if (def.kind === 'out') {
          const n = neutralMod(def.apply(0, env), true);
          if (n) report('textAnimations', def.id, 'error', `apply(0) is not neutral (${n})`);
        } else if (!sameMod(def.apply(0, env), def.apply(1, env), true)) {
          report('textAnimations', def.id, 'error', 'loop is not seamless: apply(0) differs from apply(1)');
        }
      }
    } catch (err) {
      report('textAnimations', def.id, 'error', `apply threw: ${(err as Error).message}`);
    }
  }
  counts.textAnimations = L.TEXT_ANIMATIONS.length;
}

function checkAnimRefs(pack: string, id: string, refs: ClipAnimations | undefined, text: boolean): void {
  if (!refs) return;
  const registry = text ? L.TEXT_ANIMATIONS : L.ANIMATIONS;
  if (registry.length === 0) return;
  for (const kind of ['in', 'out', 'loop'] as const) {
    const ref = refs[kind];
    if (!ref) continue;
    const def = text ? L.getTextAnimation(ref.id) : L.getAnimation(ref.id);
    if (!def) report(pack, id, 'error', `unknown ${text ? 'text ' : ''}animation "${ref.id}"`);
    else if (def.kind !== kind) report(pack, id, 'error', `animation "${ref.id}" is kind "${def.kind}" but used as "${kind}"`);
    if (!(ref.duration > 0)) report(pack, id, 'error', `animation "${ref.id}" needs a positive duration`);
  }
}

function checkFont(pack: string, id: string, family: string | undefined, weight: number | undefined): void {
  if (family === undefined) return;
  const font = getBundledFont(family);
  if (!font) {
    report(pack, id, 'error', `font "${family}" is not bundled`);
    return;
  }
  if (weight !== undefined && !font.weights.includes(weight)) {
    report(pack, id, 'error', `font "${family}" has no weight ${weight} (available: ${font.weights.join(', ')})`);
  }
}

/** Count-up presets: valid numbers and easing, and the sample is the final value as formatted. */
function checkCounter(def: TextPresetDef): void {
  const c = def.counter!;
  if (![c.from, c.to].every(Number.isFinite)) report('textPresets', def.id, 'error', 'counter from / to must be finite numbers');
  if (!(Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= MAX_COUNTER_DECIMALS)) report('textPresets', def.id, 'error', `counter decimals must be 0..${MAX_COUNTER_DECIMALS}`);
  if (!(c.ease in Ease)) report('textPresets', def.id, 'error', `unknown counter easing "${c.ease}"`);
  if (c.duration !== undefined && !(c.duration > 0)) report('textPresets', def.id, 'error', 'counter duration must be > 0');
  if (formatCounter(c, c.to) !== def.sample) report('textPresets', def.id, 'error', `sample "${def.sample}" differs from the final counter value "${formatCounter(c, c.to)}"`);
}

function checkTextPresets(): void {
  for (const def of L.TEXT_PRESETS) {
    if (!def.sample || !def.sample.trim()) report('textPresets', def.id, 'error', 'empty sample');
    const family = def.style.fontFamily ?? 'Inter';
    checkFont('textPresets', def.id, family, def.style.fontWeight ?? 700);
    if (def.style.fontSize !== undefined && !(def.style.fontSize >= 12 && def.style.fontSize <= 600)) report('textPresets', def.id, 'error', 'fontSize out of range (12..600)');
    checkAnimRefs('textPresets', def.id, def.anim, false);
    checkAnimRefs('textPresets', def.id, def.textAnim, true);
    if (def.counter) checkCounter(def);
  }
  counts.textPresets = L.TEXT_PRESETS.length;
}

function checkStickers(): void {
  for (const def of L.STICKERS) {
    if (!def.name) report('stickers', def.id, 'error', 'missing name');
    if (!Array.isArray(def.keywords)) report('stickers', def.id, 'error', 'missing keywords');
    if (def.kind === 'emoji') {
      if (!def.char) report('stickers', def.id, 'error', 'missing emoji char');
      continue;
    }
    if (!(def.aspect > 0.1 && def.aspect < 10)) {
      report('stickers', def.id, 'error', 'aspect out of range');
      continue;
    }
    if (def.animated && !(def.period && def.period > 0)) report('stickers', def.id, 'error', 'animated sticker needs a period');
    try {
      const w = Math.round(256 * def.aspect);
      const h = 256;
      const draw = (t: number): Uint8ClampedArray => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.save();
        def.draw(ctx, t, { w: 256 * def.aspect, h: 256, colors: def.colors ?? [] });
        ctx.restore();
        return ctx.getImageData(0, 0, w, h).data;
      };
      const coverage = (d: Uint8ClampedArray): number => {
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
        return n / (d.length / 4);
      };
      const d0 = draw(0);
      const period = def.period ?? 1;
      const samples = def.animated ? [0.13, 0.37, 0.61, 0.89].map((f) => draw(period * f)) : [];
      const best = Math.max(coverage(d0), ...samples.map(coverage));
      if (best < 0.01) report('stickers', def.id, 'error', 'draws nothing visible');
      if (coverage(d0) > 0.995) report('stickers', def.id, 'warn', 'fills the whole box (no transparent margin)');
      if (def.animated) {
        const dEnd = draw(period);
        let diff = 0;
        for (let i = 0; i < d0.length; i++) diff += Math.abs(d0[i] - dEnd[i]);
        diff /= d0.length * 255;
        if (diff > 0.004) report('stickers', def.id, 'error', `loop is not seamless (frame at t=period differs from t=0 by ${diff.toFixed(4)})`);
        let motion = 0;
        for (const s of samples) {
          let d = 0;
          for (let i = 0; i < d0.length; i++) d += Math.abs(d0[i] - s[i]);
          motion = Math.max(motion, d / (d0.length * 255));
        }
        if (motion < 0.0005) report('stickers', def.id, 'warn', 'marked animated but does not change over time');
      }
    } catch (err) {
      report('stickers', def.id, 'error', `draw threw: ${(err as Error).message}`);
    }
  }
  counts.stickers = L.STICKERS.length;
}

async function checkSounds(): Promise<void> {
  const RATE = 48000;
  const renderOnce = async (def: (typeof L.SOUNDS)[number]): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(2, Math.ceil(def.duration * RATE), RATE);
    def.render(ctx, ctx.destination);
    return ctx.startRendering();
  };
  for (const def of L.SOUNDS) {
    try {
      if (!(def.duration > 0.02 && def.duration <= 120)) {
        report('sounds', def.id, 'error', 'duration out of range (0.02..120 s)');
        continue;
      }
      const buf = await renderOnce(def);
      let peak = 0;
      let tail = 0;
      let head = 0;
      let sum = 0;
      const tailStart = buf.length - Math.round(RATE * 0.004);
      const headEnd = Math.round(RATE * 0.0005);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const v = Math.abs(d[i]);
          if (!Number.isFinite(v)) {
            peak = Infinity;
            break;
          }
          if (v > peak) peak = v;
          if (i >= tailStart && v > tail) tail = v;
          if (i < headEnd && v > head) head = v;
          sum += d[i] * (1 + (i % 7));
        }
      }
      if (!Number.isFinite(peak)) report('sounds', def.id, 'error', 'produced non-finite samples');
      else if (peak < 0.02) report('sounds', def.id, 'error', `is silent (peak ${peak.toFixed(4)})`);
      else if (peak > 0.98) report('sounds', def.id, 'error', `clips (peak ${peak.toFixed(3)}); keep below 0.89`);
      else if (peak > 0.9) report('sounds', def.id, 'warn', `peak ${peak.toFixed(3)} is above -1 dBFS`);
      else if (peak < 0.2) report('sounds', def.id, 'warn', `is very quiet (peak ${peak.toFixed(3)})`);
      if (!def.loop && tail > 0.02) report('sounds', def.id, 'error', `does not fade out (last 4 ms peak ${tail.toFixed(3)}) — will click`);
      if (head > 0.25) report('sounds', def.id, 'warn', `starts abruptly (first sample peak ${head.toFixed(3)}) — add a 1-2 ms attack`);
      const again = await renderOnce(def);
      let sum2 = 0;
      for (let ch = 0; ch < again.numberOfChannels; ch++) {
        const d = again.getChannelData(ch);
        for (let i = 0; i < d.length; i++) sum2 += d[i] * (1 + (i % 7));
      }
      if (Math.abs(sum - sum2) > 1e-3) report('sounds', def.id, 'error', 'is not deterministic (two renders differ)');
    } catch (err) {
      report('sounds', def.id, 'error', `render threw: ${(err as Error).message}`);
    }
  }
  counts.sounds = L.SOUNDS.length;
}

const FALLBACK_PALETTE: Palette = {
  id: '_fallback',
  name: 'Fallback',
  dark: true,
  bg: '#0d0f14',
  bg2: '#1a1e29',
  surface: '#222838',
  primary: '#7c5cff',
  secondary: '#22d3ee',
  accent: '#ffb020',
  text: '#ffffff',
  textMuted: '#a7b0c2',
  onPrimary: '#ffffff',
};
const FALLBACK_FONTS: FontPair = {
  id: '_fallback',
  name: 'Fallback',
  heading: { family: 'Montserrat', weight: 800 },
  body: { family: 'Inter', weight: 500 },
};
const ASPECTS: Record<AspectId, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

function checkPaint(pack: string, id: string, paint: unknown, what: string): void {
  const p = paint as { type?: string; color?: string; stops?: { offset: number; color: string }[] };
  if (!p || typeof p !== 'object') return report(pack, id, 'error', `${what}: missing paint`);
  if (p.type === 'solid') {
    if (typeof p.color !== 'string') report(pack, id, 'error', `${what}: solid paint needs a colour`);
  } else if (p.type === 'linear' || p.type === 'radial') {
    if (!Array.isArray(p.stops) || p.stops.length < 2) report(pack, id, 'error', `${what}: gradient needs at least 2 stops`);
  } else {
    report(pack, id, 'error', `${what}: unknown paint type`);
  }
}

function checkClip(pack: string, id: string, clip: Clip, env: TemplateEnv, total: number, motionIds: ReadonlySet<string> = new Set()): void {
  const where = `[${env.aspect}] clip "${clip.name}"`;
  if (clip.trackId !== '') report(pack, id, 'error', `${where}: trackId must be empty`);
  if (!(clip.start >= 0) || !(clip.duration > 0) || !Number.isFinite(clip.start + clip.duration)) report(pack, id, 'error', `${where}: invalid timing`);
  else if (clip.start + clip.duration > total + 0.001) report(pack, id, 'error', `${where}: ends at ${(clip.start + clip.duration).toFixed(2)}s, after the template duration ${total}s`);
  if (clip.type === 'audio') return;
  const t = clip.transform;
  for (const k of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const) {
    if (!Number.isFinite(t[k])) report(pack, id, 'error', `${where}: transform.${k} is not finite`);
  }
  if (Math.abs(t.x) > env.cw * 1.2 || Math.abs(t.y) > env.ch * 1.2) report(pack, id, 'warn', `${where}: placed far outside the frame (${Math.round(t.x)}, ${Math.round(t.y)})`);
  checkAnimRefs(pack, id, clip.anim, false);
  for (const fx of clip.effects) if (L.EFFECTS.length && !L.getEffect(fx.effectId)) report(pack, id, 'error', `${where}: unknown effect "${fx.effectId}"`);
  if (clip.filter && L.FILTERS.length && !L.getFilter(clip.filter.id)) report(pack, id, 'error', `${where}: unknown filter "${clip.filter.id}"`);
  for (const [prop, frames] of Object.entries(clip.keyframes ?? {})) {
    for (const f of frames ?? []) {
      if (!Number.isFinite(f.t) || !Number.isFinite(f.v) || f.t < 0 || f.t > clip.duration + 0.001) report(pack, id, 'error', `${where}: bad keyframe on ${prop}`);
    }
  }
  if (clip.type === 'text') {
    if (!clip.text.content) report(pack, id, 'error', `${where}: empty text`);
    checkFont(pack, id, clip.text.fontFamily, clip.text.fontWeight);
    checkPaint(pack, id, clip.text.fill, `${where} fill`);
    if (!(clip.text.fontSize >= 10 && clip.text.fontSize <= 900)) report(pack, id, 'error', `${where}: fontSize ${clip.text.fontSize} out of range`);
    checkAnimRefs(pack, id, clip.textAnim, true);
  } else if (clip.type === 'shape') {
    checkPaint(pack, id, clip.shape.fill, `${where} fill`);
    if (!(clip.shape.width > 0 && clip.shape.height > 0)) report(pack, id, 'error', `${where}: shape needs a positive size`);
  } else if (clip.type === 'sticker') {
    if (L.STICKERS.length && !L.getSticker(clip.stickerId)) report(pack, id, 'error', `${where}: unknown sticker "${clip.stickerId}"`);
  } else if (clip.type === 'generator') {
    const gen = L.getGenerator(clip.generatorId);
    if (L.GENERATORS.length && !gen) report(pack, id, 'error', `${where}: unknown generator "${clip.generatorId}"`);
    if (gen) {
      for (const key of Object.keys(clip.params)) {
        if (!gen.params.some((p) => p.key === key)) report(pack, id, 'error', `${where}: generator "${gen.id}" has no param "${key}"`);
      }
    }
  } else if (clip.type === 'image' && motionIds.has(clip.assetId)) {
    // A Motion layer made with env.motion (an in-memory clip, saved as a file when applied).
  } else if (clip.type === 'video' || clip.type === 'image') {
    report(pack, id, 'error', `${where}: templates must not reference media assets (use makeSlot)`);
  }
}

function checkTemplates(): void {
  const palettes = L.PALETTES.length ? [L.PALETTES[0], L.PALETTES[L.PALETTES.length - 1]] : [FALLBACK_PALETTE];
  const fonts = L.FONT_PAIRS.length ? [L.FONT_PAIRS[0], L.FONT_PAIRS[L.FONT_PAIRS.length - 1]] : [FALLBACK_FONTS];
  for (const pal of L.PALETTES) {
    for (const key of ['bg', 'bg2', 'surface', 'primary', 'secondary', 'accent', 'text', 'textMuted', 'onPrimary'] as const) {
      if (!HEX.test(pal[key])) report('palettes', pal.id, 'error', `${key} must be a hex colour`);
    }
  }
  for (const fp of L.FONT_PAIRS) {
    checkFont('fontPairs', fp.id, fp.heading.family, fp.heading.weight);
    checkFont('fontPairs', fp.id, fp.body.family, fp.body.weight);
  }
  // Generated designs: every archetype in every category it serves, with a few content sets / seeds.
  const generated = ARCHETYPES.flatMap((a) => a.categories.flatMap((c) => [0, 1, 2].map((n) => generatedTemplate(generatedId(a, c, n * 37 + 5)))));
  for (const def of [...L.TEMPLATES, ...generated.filter((d): d is NonNullable<typeof d> => !!d)]) {
    if (!(def.duration >= 1 && def.duration <= 120)) report('templates', def.id, 'error', 'duration out of range (1..120 s)');
    // Music bed: a looping `music` sound, sensible level and fades that fit the template.
    if (def.music) {
      const m = def.music;
      const sound = L.getSound(m.soundId);
      if (!sound) report('templates', def.id, 'error', `music: unknown sound "${m.soundId}"`);
      else if (sound.category !== 'music') report('templates', def.id, 'error', `music: "${m.soundId}" is a ${sound.category} sound, not a music bed`);
      if (m.volume !== undefined && !(m.volume > 0 && m.volume <= 2)) report('templates', def.id, 'error', `music: volume ${m.volume} outside 0..2`);
      for (const k of ['fadeIn', 'fadeOut'] as const) {
        const v = m[k];
        if (v !== undefined && !(v >= 0 && v <= def.duration / 2)) report('templates', def.id, 'error', `music: ${k} ${v}s must be within 0..${def.duration / 2}s`);
      }
    }
    const aspects = def.aspects ?? (Object.keys(ASPECTS) as AspectId[]);
    for (const aspect of aspects) {
      const [cw, ch] = ASPECTS[aspect];
      for (let v = 0; v < Math.max(palettes.length, fonts.length); v++) {
        const motionAssets: MediaAsset[] = [];
        const env: TemplateEnv = {
          cw,
          ch,
          aspect,
          portrait: ch > cw,
          square: cw === ch,
          palette: palettes[v % palettes.length],
          fonts: fonts[v % fonts.length],
          rng: seededRandom(1234 + v * 77),
          duration: def.duration,
          motion: templateMotion({ cw, ch, palette: palettes[v % palettes.length], fonts: fonts[v % fonts.length], duration: def.duration, seed: 1234 + v, assets: motionAssets }),
        };
        try {
          const clips = def.build(env);
          if (!Array.isArray(clips) || clips.length === 0) {
            report('templates', def.id, 'error', `[${aspect}] build returned no clips`);
            continue;
          }
          const ids = new Set<string>();
          for (const clip of clips) {
            if (ids.has(clip.id)) report('templates', def.id, 'error', `[${aspect}] duplicate clip id`);
            ids.add(clip.id);
            checkClip('templates', def.id, clip, env, def.duration, new Set(motionAssets.map((a) => a.id)));
            // Brand logo placeholders: a slot named "Logo", not too elongated, inside the frame.
            if (clip.name.trim().toLowerCase() === 'logo' && clip.type === 'shape') {
              const s = clip.shape;
              if (!s.slot) report('templates', def.id, 'error', `[${aspect}] a layer named "Logo" must be a placeholder (makeSlot)`);
              else {
                const ratio = Math.max(s.width, s.height) / Math.max(1, Math.min(s.width, s.height));
                if (ratio > 4) report('templates', def.id, 'warn', `[${aspect}] Logo placeholder is very elongated (${ratio.toFixed(1)}:1)`);
                const hw = (s.width * Math.abs(clip.transform.scaleX)) / 2;
                const hh = (s.height * Math.abs(clip.transform.scaleY)) / 2;
                if (Math.abs(clip.transform.x) + hw > cw / 2 + 1 || Math.abs(clip.transform.y) + hh > ch / 2 + 1) report('templates', def.id, 'error', `[${aspect}] Logo placeholder leaves the frame`);
              }
            }
          }
          const end = Math.max(...clips.map((c) => c.start + c.duration));
          if (end < def.duration * 0.7) report('templates', def.id, 'warn', `[${aspect}] content ends at ${end.toFixed(1)}s, well before the ${def.duration}s duration`);
        } catch (err) {
          report('templates', def.id, 'error', `[${aspect}] build threw: ${(err as Error).message}`);
        }
      }
    }
  }
  counts.templates = L.TEMPLATES.length;
  counts.palettes = L.PALETTES.length;
  counts.fontPairs = L.FONT_PAIRS.length;
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Content packs shipped in resources/packs: validated exactly like an install (every shader
// compiled), then registered so every other check below also covers their items.
// ---------------------------------------------------------------------------------------------

const PACK_FILES = import.meta.glob('../../resources/packs/*.kinorapack', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function checkPacks(): void {
  let n = 0;
  for (const [file, text] of Object.entries(PACK_FILES)) {
    const name = file.split('/').pop() ?? file;
    const res = validatePack(text, {
      compile: (kind, def) => {
        try {
          const src = kind === 'transition' ? wrapTransition(def as never) : kind === 'effect' ? wrapEffect(def as never) : wrapGenerator(def as never);
          gl.deleteProgram(createProgram(gl, FULLSCREEN_VERT, src).program);
          return null;
        } catch (err) {
          return (err as Error).message;
        }
      },
    });
    for (const e of res.errors) report('packs', name, 'error', e);
    for (const w of res.warnings) report('packs', name, 'warn', w);
    if (res.ok && res.pack) {
      registerContent(`pack:${res.pack.id}`, packContent(res.pack));
      n++;
    }
  }
  counts.packs = n;
}

async function main(): Promise<void> {
  // Packs first: their items join the registries the other steps walk.
  if (wants('packs') || requested.length === 0 || ['transitions', 'effects', 'generators', 'filters', 'textPresets', 'templates'].some((p) => requested.includes(p))) {
    try {
      checkPacks();
    } catch (err) {
      report('packs', '*', 'error', `checker crashed: ${(err as Error).stack ?? String(err)}`);
    }
  }
  const steps: [string, () => void | Promise<void>][] = [
    ['transitions', checkTransitions],
    ['effects', checkEffects],
    ['generators', checkGenerators],
    ['filters', checkFilters],
    ['animations', checkAnimations],
    ['textAnimations', checkTextAnimations],
    ['textPresets', checkTextPresets],
    ['stickers', checkStickers],
    ['sounds', checkSounds],
    ['templates', checkTemplates],
  ];
  for (const [pack, fn] of steps) {
    if (!wants(pack)) continue;
    try {
      await fn();
    } catch (err) {
      report(pack, '*', 'error', `checker crashed: ${(err as Error).stack ?? String(err)}`);
    }
  }
  for (const issue of issues) console.log('__CHECK__' + JSON.stringify(issue));
  console.log('__DONE__' + JSON.stringify({ counts, errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warn').length }));
}

void preloadBundledFonts().then(main);
