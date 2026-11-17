/**
 * Compiles content-pack shaders in a throw-away WebGL2 context (never the compositor's) and runs
 * one tiny draw, so a pack whose GLSL does not compile — or crashes the driver — is rejected
 * before anything is registered.
 */

import { FULLSCREEN_VERT, createProgram, setParamUniforms, wrapEffect, wrapGenerator, wrapTransition } from '@/engine/gl/shaderlib';
import type { ShaderKind } from '@/library/packs';
import type { EffectDef, GeneratorDef, TransitionDef } from '@/library/types';

let gl: WebGL2RenderingContext | null = null;
let quad: WebGLVertexArrayObject | null = null;
let tex: WebGLTexture | null = null;

function context(): WebGL2RenderingContext {
  if (gl && !gl.isContextLost()) return gl;
  const canvas = new OffscreenCanvas(16, 16);
  const ctx = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!ctx) throw new Error('WebGL2 is not available');
  gl = ctx;
  quad = ctx.createVertexArray();
  ctx.bindVertexArray(quad);
  const buf = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), ctx.STATIC_DRAW);
  ctx.enableVertexAttribArray(0);
  ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0);
  tex = ctx.createTexture();
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, 1, 1, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  return ctx;
}

/** Compile and test-draw a pack shader. Returns an error message, or null when it is fine. */
export function compilePackShader(kind: ShaderKind, def: TransitionDef | EffectDef | GeneratorDef): string | null {
  let ctx: WebGL2RenderingContext;
  try {
    ctx = context();
  } catch (err) {
    return (err as Error).message;
  }
  try {
    const src = kind === 'transition' ? wrapTransition(def as TransitionDef) : kind === 'effect' ? wrapEffect(def as EffectDef) : wrapGenerator(def as GeneratorDef);
    const prog = createProgram(ctx, FULLSCREEN_VERT, src);
    ctx.viewport(0, 0, 16, 16);
    ctx.useProgram(prog.program);
    ctx.bindVertexArray(quad);
    for (const [i, name] of ['u_from', 'u_to', 'u_tex', 'u_orig'].entries()) {
      const loc = prog.loc(name);
      if (!loc) continue;
      ctx.activeTexture(ctx.TEXTURE0 + i);
      ctx.bindTexture(ctx.TEXTURE_2D, tex);
      ctx.uniform1i(loc, i);
    }
    const set1 = (n: string, v: number): void => {
      const l = prog.loc(n);
      if (l) ctx.uniform1f(l, v);
    };
    set1('progress', 0.5);
    set1('ratio', 1);
    set1('u_px', 16 / 1080);
    set1('u_time', 0.5);
    set1('u_progress', 0.5);
    set1('u_aspect', 1);
    const res = prog.loc('u_res');
    if (res) ctx.uniform2f(res, 16, 16);
    setParamUniforms(ctx, prog, def.params, undefined);
    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8Array(4);
    ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    ctx.deleteProgram(prog.program);
    const err = ctx.getError();
    if (ctx.isContextLost()) return 'the graphics driver rejected this shader';
    if (err !== ctx.NO_ERROR && err !== ctx.INVALID_OPERATION) return `WebGL error ${err}`;
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
