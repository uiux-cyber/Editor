import { createProgram, type Program } from './shaderlib';

export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export interface GLOptions {
  /** Keep the drawing buffer after presenting (needed when frames are captured from the canvas). */
  preserveDrawingBuffer?: boolean;
  /**
   * Give the canvas an alpha channel (transparent exports). The live preview keeps the default
   * opaque canvas; only throwaway export compositors turn this on.
   */
  alpha?: boolean;
}

/**
 * Thin WebGL2 wrapper: owns the context, a unit quad, a program cache and a pool of render
 * targets. Every texture in the engine follows the same convention: premultiplied alpha, and
 * texture row 0 is the TOP of the picture.
 */
export class GLContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private programs = new Map<string, Program | null>();
  private pool: Target[] = [];
  private vao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  lost = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: GLOptions = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: !!opts.alpha,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available. Kinora needs a GPU with up-to-date drivers.');
    this.gl = gl;
    this.canvas = canvas;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Compile (once) and return a program, or null when the shader is broken. */
  program(key: string, vert: string, frag: string | (() => string)): Program | null {
    let prog = this.programs.get(key);
    if (prog !== undefined) return prog;
    try {
      prog = createProgram(this.gl, vert, typeof frag === 'function' ? frag() : frag);
    } catch (err) {
      console.error(`[gl] shader "${key}" failed to compile:\n${(err as Error).message}`);
      prog = null;
    }
    this.programs.set(key, prog);
    return prog;
  }

  createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Upload any image-like source into a texture. Returns false if the upload was rejected. */
  upload(tex: WebGLTexture, source: TexImageSource, mipmaps = false): boolean {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (err) {
      console.warn('[gl] texture upload failed', err);
      return false;
    }
    if (mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return true;
  }

  /** Borrow a render target of the given size (cleared to transparent). */
  acquire(width: number, height: number, clear = true): Target {
    const gl = this.gl;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    let target: Target | undefined;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].width === w && this.pool[i].height === h) {
        target = this.pool.splice(i, 1)[0];
        break;
      }
    }
    if (!target) {
      const tex = this.createTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      target = { fbo, tex, width: w, height: h };
    }
    if (clear) {
      this.bind(target);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return target;
  }

  release(target: Target | null | undefined): void {
    if (!target) return;
    this.pool.push(target);
    // Keep the pool bounded; drop the oldest targets (usually stale sizes).
    while (this.pool.length > 12) this.destroyTarget(this.pool.shift()!);
  }

  private destroyTarget(t: Target): void {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  /** Bind a target (or the canvas when null) and set the viewport. */
  bind(target: Target | null): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (target) gl.viewport(0, 0, target.width, target.height);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  useTexture(prog: Program, name: string, unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.loc(name), unit);
  }

  drawQuad(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  trimPool(): void {
    for (const t of this.pool) this.destroyTarget(t);
    this.pool = [];
  }

  dispose(): void {
    const gl = this.gl;
    this.trimPool();
    for (const p of this.programs.values()) if (p) gl.deleteProgram(p.program);
    this.programs.clear();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
