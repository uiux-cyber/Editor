/**
 * Small float-texture helpers for the colour layer extensions (curves, LUTs). Uploads disable the
 * context's premultiply flag for the duration (WebGL rejects / alters ArrayBufferView uploads
 * otherwise) and restore it afterwards.
 */

function withRawUnpack(gl: WebGL2RenderingContext, fn: () => void): void {
  const premul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const align = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  try {
    fn();
  } finally {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, align);
  }
}

function params(gl: WebGL2RenderingContext, target: number): void {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

/** A width × 1 RGBA half-float texture from float data (4 values per entry). */
export function createRowTexture(gl: WebGL2RenderingContext, data: Float32Array, width: number, unit: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  params(gl, gl.TEXTURE_2D);
  withRawUnpack(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, 1, 0, gl.RGBA, gl.FLOAT, data));
  return tex;
}

/** A size³ RGB half-float 3D texture (red fastest, as in .cube files). */
export function create3DTexture(gl: WebGL2RenderingContext, rgb: Float32Array, size: number, unit: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  params(gl, gl.TEXTURE_3D);
  withRawUnpack(gl, () => gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, rgb));
  return tex;
}

/** Bind a texture to a unit and point a sampler uniform at it. */
export function bindSampler(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null, unit: number, target: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, tex);
  if (loc) gl.uniform1i(loc, unit);
}

/**
 * Per-GL-context LRU cache of textures built from keyed data. `build` is only called on a miss;
 * evicted textures are deleted.
 */
export class TextureCache {
  private perGl = new WeakMap<WebGL2RenderingContext, Map<string, WebGLTexture>>();
  constructor(private limit = 24) {}

  get(gl: WebGL2RenderingContext, key: string, build: () => WebGLTexture | null): WebGLTexture | null {
    let map = this.perGl.get(gl);
    if (!map) {
      map = new Map();
      this.perGl.set(gl, map);
    }
    const hit = map.get(key);
    if (hit) {
      // Refresh recency.
      map.delete(key);
      map.set(key, hit);
      return hit;
    }
    const tex = build();
    if (!tex) return null;
    map.set(key, tex);
    while (map.size > this.limit) {
      const oldest = map.keys().next().value as string;
      const t = map.get(oldest);
      map.delete(oldest);
      if (t) gl.deleteTexture(t);
    }
    return tex;
  }

  /** Drop entries whose key starts with `prefix` (e.g. a deleted LUT) in every context seen. */
  invalidate(gl: WebGL2RenderingContext, prefix: string): void {
    const map = this.perGl.get(gl);
    if (!map) return;
    for (const [k, t] of [...map]) {
      if (k.startsWith(prefix)) {
        map.delete(k);
        gl.deleteTexture(t);
      }
    }
  }
}
