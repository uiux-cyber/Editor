/**
 * GLSL scaffolding shared by the compositor, the thumbnail renderer and the library checker.
 * Content packs only provide snippet bodies; the wrappers here turn them into full programs.
 */

import type { ParamValue } from '@/core/types';
import type { EffectDef, GeneratorDef, ParamDef, TransitionDef } from '@/library/types';

export const GLSL_HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

/** Full-screen pass. `a_pos` is a 0..1 quad; `v_uv` follows the framebuffer rows 1:1. */
export const FULLSCREEN_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GLSL_COMMON = `
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.02 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum / 0.9375;
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}
`;

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

export function validateParams(params: ParamDef[] | undefined): string | null {
  const seen = new Set<string>();
  for (const p of params ?? []) {
    if (!IDENT.test(p.key)) return `param key "${p.key}" is not a valid identifier`;
    if (p.key.startsWith('u_') || p.key.startsWith('gl_')) return `param key "${p.key}" uses a reserved prefix`;
    if (seen.has(p.key)) return `duplicate param key "${p.key}"`;
    seen.add(p.key);
    if (p.type === 'color' && typeof p.default !== 'string') return `color param "${p.key}" needs a string default`;
    if (p.type === 'bool' && typeof p.default !== 'boolean') return `bool param "${p.key}" needs a boolean default`;
    if ((p.type === 'float' || p.type === 'int' || p.type === 'select') && typeof p.default !== 'number') {
      return `numeric param "${p.key}" needs a number default`;
    }
    if (p.type === 'select' && !(p.options && p.options.length)) return `select param "${p.key}" needs options`;
  }
  return null;
}

export function paramUniformDecls(params: ParamDef[] | undefined): string {
  return (params ?? []).map((p) => (p.type === 'color' ? `uniform vec3 ${p.key};` : `uniform float ${p.key};`)).join('\n');
}

export function wrapTransition(def: TransitionDef): string {
  return `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float progress;
uniform float ratio;
${GLSL_COMMON}
vec4 getFromColor(vec2 uv) { return texture(u_from, vec2(uv.x, 1.0 - uv.y)); }
vec4 getToColor(vec2 uv) { return texture(u_to, vec2(uv.x, 1.0 - uv.y)); }
${paramUniformDecls(def.params)}
#line 1
${def.glsl}
void main() {
  outColor = transition(vec2(v_uv.x, 1.0 - v_uv.y));
}
`;
}

export function wrapEffect(def: EffectDef): string {
  return `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler2D u_orig;
uniform vec2 u_res;
uniform float u_px;
uniform float u_time;
uniform float u_progress;
uniform float u_aspect;
uniform int u_pass;
${GLSL_COMMON}
vec4 tex(vec2 uv) { return texture(u_tex, uv); }
vec4 texZ(vec2 uv) {
  vec2 s = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(u_tex, uv) * s.x * s.y;
}
vec4 texM(vec2 uv) {
  vec2 m = abs(mod(uv - 1.0, 2.0) - 1.0);
  return texture(u_tex, m);
}
vec4 orig(vec2 uv) { return texture(u_orig, uv); }
${paramUniformDecls(def.params)}
#line 1
${def.glsl}
void main() {
  outColor = effect(v_uv);
}
`;
}

export function wrapGenerator(def: GeneratorDef): string {
  return `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_px;
uniform float u_time;
uniform float u_aspect;
${GLSL_COMMON}
${paramUniformDecls(def.params)}
#line 1
${def.glsl}
void main() {
  outColor = generate(v_uv);
}
`;
}

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into 0..1 components. */
export function hexToRgba(hex: string): [number, number, number, number] {
  let h = (hex || '#000').trim().replace('#', '');
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0, 1];
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, Number.isNaN(a) ? 1 : a];
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown error';
    gl.deleteShader(shader);
    throw new Error(log.trim());
  }
  return shader;
}

export interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
  loc(name: string): WebGLUniformLocation | null;
}

export function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  let fs: WebGLShader;
  try {
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(log.trim());
  }
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniforms,
    loc(name: string) {
      let l = uniforms.get(name);
      if (l === undefined) {
        l = gl.getUniformLocation(program, name);
        uniforms.set(name, l);
      }
      return l;
    },
  };
}

/** Upload the values of a pack item's params (falling back to the defaults). */
export function setParamUniforms(
  gl: WebGL2RenderingContext,
  prog: Program,
  defs: ParamDef[] | undefined,
  values: Record<string, ParamValue> | undefined,
): void {
  for (const p of defs ?? []) {
    const loc = prog.loc(p.key);
    if (!loc) continue;
    const raw = values && values[p.key] !== undefined ? values[p.key] : p.default;
    if (p.type === 'color') {
      const [r, g, b] = hexToRgba(typeof raw === 'string' ? raw : String(p.default));
      gl.uniform3f(loc, r, g, b);
    } else if (p.type === 'bool') {
      gl.uniform1f(loc, raw === true || raw === 1 ? 1 : 0);
    } else {
      let v = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(v)) v = typeof p.default === 'number' ? p.default : 0;
      if (p.type === 'int' || p.type === 'select') v = Math.round(v);
      gl.uniform1f(loc, v);
    }
  }
}
