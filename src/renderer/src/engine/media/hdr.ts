/**
 * HDR sources at runtime.
 *
 * What Chromium hands us (measured with a synthetic PQ / BT.2020 clip, see hdrTestFile.ts):
 *  - WebGL `texImage2D` of a PQ `<video>` element or `VideoFrame` uploads the RAW signal (PQ code
 *    values after the Y'CbCr → R'G'B' matrix) — no tone-mapping, whatever
 *    UNPACK_COLORSPACE_CONVERSION_WEBGL says.
 *  - Drawing the same frame into a 2D canvas (Mediabunny's CanvasSink, used by the exporter)
 *    makes Chromium tone-map it to SDR with its own curve.
 * So the preview and an export would disagree. To keep them identical, HDR assets are decoded
 * for export / the render cache / proxies through `RawSignalSink`, which uploads frames through
 * WebGL exactly like the preview does, and the `hdr` layer extension tone-maps the raw signal
 * with the user's operator in both places. A one-off runtime probe re-checks the upload
 * behaviour on the user's PC; if Chromium ever starts tone-mapping uploads itself, the raw sink
 * and the extension switch off (the pixels are then already SDR).
 */

import { CanvasSink, type CanvasSinkOptions, type InputVideoTrack, type VideoSample, VideoSampleSink, type WrappedCanvas } from 'mediabunny';
import type { ID, MediaAsset } from '@/core/types';

export type HdrTransfer = 'pq' | 'hlg';

export interface HdrInfo {
  transfer: HdrTransfer;
  /** True when the source primaries are BT.2020 (converted to BT.709 by the extension). */
  wideGamut: boolean;
}

/** Colour space as reported by Mediabunny / WebCodecs (the DOM typings lack the HDR values). */
export interface ColorSpaceLike {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
}

const registry = new Map<ID, HdrInfo>();
const listeners = new Set<() => void>();

/** Register an HDR asset (`cs` = its colour space when known; PQ / BT.2020 is assumed until then). */
export function setHdrInfo(assetId: ID, cs: ColorSpaceLike | null): void {
  const prev = registry.get(assetId);
  const info: HdrInfo = { transfer: cs?.transfer === 'hlg' ? 'hlg' : 'pq', wideGamut: !cs?.primaries || cs.primaries === 'bt2020' };
  if (prev && prev.transfer === info.transfer && prev.wideGamut === info.wideGamut) return;
  if (prev && !cs) return;
  registry.set(assetId, info);
  listeners.forEach((cb) => cb());
}

/** HDR facts of a registered HDR asset id (null for SDR / unknown assets). */
export function hdrInfoById(assetId: ID): HdrInfo | null {
  return registry.get(assetId) ?? null;
}

/** HDR facts of an asset, or null for SDR media. Falls back to PQ / BT.2020 until probed. */
export function hdrInfo(asset: Pick<MediaAsset, 'id' | 'hdr'> | undefined): HdrInfo | null {
  if (!asset?.hdr) return null;
  return registry.get(asset.id) ?? { transfer: 'pq', wideGamut: true };
}

export function onHdrInfo(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True for colour spaces with an HDR transfer function. */
export function isHdrColorSpace(cs: ColorSpaceLike | null | undefined): boolean {
  return cs?.transfer === 'pq' || cs?.transfer === 'hlg';
}

// ---------------------------------------------------------------------------------------------
// Pipeline probe: does a WebGL upload of an HDR frame keep the raw signal?
// ---------------------------------------------------------------------------------------------

let passthrough: boolean | null = null;
let probing: Promise<boolean> | null = null;

/** Result of the probe (true until it has run: that is what Chromium 140 does). */
export function hdrPassthrough(): boolean {
  return passthrough ?? true;
}

/** Run the probe once (cheap: a 2-frame 64×32 clip). */
export function probeHdrPipeline(): Promise<boolean> {
  probing ??= (async () => {
    try {
      const { makeSyntheticHdrVideo, hdrTestSignal } = await import('./hdrTestFile');
      const clip = await makeSyntheticHdrVideo({ width: 64, height: 32, frames: 2 });
      const url = URL.createObjectURL(new Blob([clip.bytes as BlobPart], { type: 'video/mp4' }));
      try {
        const v = document.createElement('video');
        v.muted = true;
        v.src = url;
        await new Promise<void>((ok, ko) => {
          v.onloadeddata = () => ok();
          v.onerror = () => ko(new Error('probe clip did not load'));
        });
        // `loadeddata` comes before a frame can be uploaded: seek and wait for it to be presented.
        v.currentTime = 0;
        await new Promise<void>((ok) => {
          v.onseeked = () => ok();
          setTimeout(ok, 1500);
        });
        await new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
        const canvas = new OffscreenCanvas(64, 32);
        const gl = canvas.getContext('webgl2');
        if (!gl) return (passthrough = true);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          // No frame to inspect: keep the measured default.
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          return (passthrough = true);
        }
        const px = new Uint8Array(4);
        // A 1000-nit patch: raw PQ ≈ 0.75 (191); an SDR tone-map would put it near white.
        const x = 40;
        gl.readPixels(x, 24, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const expected = hdrTestSignal((x + 0.5) / 64, 0.75) * 255;
        passthrough = Math.abs(px[0] - expected) < 14;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn('[hdr] pipeline probe failed; assuming raw uploads', err);
      passthrough = true;
    }
    return passthrough!;
  })();
  return probing;
}

// ---------------------------------------------------------------------------------------------
// Raw-signal canvases (the WebGL upload path, for decoders outside the <video> element)
// ---------------------------------------------------------------------------------------------

const BLIT_VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }`;

const BLIT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform int u_rot;
out vec4 outColor;
void main() {
  vec2 d = vec2(gl_FragCoord.x / u_size.x, 1.0 - gl_FragCoord.y / u_size.y); // display uv, top-left origin
  vec2 s = d;
  if (u_rot == 90) s = vec2(d.y, 1.0 - d.x);
  else if (u_rot == 180) s = vec2(1.0 - d.x, 1.0 - d.y);
  else if (u_rot == 270) s = vec2(1.0 - d.y, d.x);
  outColor = vec4(texture(u_tex, s).rgb, 1.0);
}`;

interface Blitter {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
  uSize: WebGLUniformLocation | null;
  uRot: WebGLUniformLocation | null;
}

let blitter: Blitter | null = null;

function getBlitter(): Blitter {
  if (blitter && !blitter.gl.isContextLost()) return blitter;
  const canvas = new OffscreenCanvas(16, 16);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 is not available');
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, BLIT_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, BLIT_FRAG));
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(prog);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
  blitter = { canvas, gl, prog, tex, uSize: gl.getUniformLocation(prog, 'u_size'), uRot: gl.getUniformLocation(prog, 'u_rot') };
  return blitter;
}

/**
 * Draw a decoded sample into `target` (2D canvas) through a WebGL upload, so HDR samples keep
 * their raw signal (the 2D canvas path would tone-map them). Applies the sample rotation and
 * scales to the target size.
 */
export function drawRawSignal(sample: VideoSample, target: OffscreenCanvas | HTMLCanvasElement, opts: { ignoreRotation?: boolean } = {}): void {
  const b = getBlitter();
  const { gl } = b;
  const w = target.width;
  const h = target.height;
  if (b.canvas.width !== w || b.canvas.height !== h) {
    b.canvas.width = w;
    b.canvas.height = h;
  }
  const frame = sample.toVideoFrame();
  try {
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  } finally {
    frame.close();
  }
  gl.viewport(0, 0, w, h);
  gl.useProgram(b.prog);
  gl.uniform2f(b.uSize, w, h);
  gl.uniform1i(b.uRot, opts.ignoreRotation ? 0 : ((sample.rotation % 360) + 360) % 360);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const ctx = target.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(b.canvas, 0, 0);
}

/**
 * CanvasSink look-alike for HDR sources: same API and output shape, but frames keep their raw
 * HDR signal (see the module comment). Canvases are recycled from a small pool.
 */
export class RawSignalSink {
  private sink: VideoSampleSink;
  private pool: OffscreenCanvas[] = [];
  private nextSlot = 0;

  constructor(
    track: InputVideoTrack,
    private options: CanvasSinkOptions = {},
  ) {
    this.sink = new VideoSampleSink(track);
  }

  private wrap(sample: VideoSample): WrappedCanvas {
    try {
      let w = this.options.width ?? sample.displayWidth;
      let h = this.options.height ?? Math.round((w / sample.displayWidth) * sample.displayHeight);
      if (this.options.height && !this.options.width) w = Math.round((h / sample.displayHeight) * sample.displayWidth);
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      const size = Math.max(1, this.options.poolSize ?? 0);
      let canvas: OffscreenCanvas;
      if (this.options.poolSize) {
        const slot = this.nextSlot++ % size;
        canvas = this.pool[slot] ??= new OffscreenCanvas(w, h);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      } else {
        canvas = new OffscreenCanvas(w, h);
      }
      drawRawSignal(sample, canvas);
      return { canvas, timestamp: sample.timestamp, duration: sample.duration };
    } finally {
      sample.close();
    }
  }

  async getCanvas(timestamp: number): Promise<WrappedCanvas | null> {
    const s = await this.sink.getSample(timestamp);
    return s ? this.wrap(s) : null;
  }

  async *canvases(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<WrappedCanvas, void, unknown> {
    for await (const s of this.sink.samples(startTimestamp, endTimestamp)) yield this.wrap(s);
  }

  async *canvasesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedCanvas | null, void, unknown> {
    for await (const s of this.sink.samplesAtTimestamps(timestamps)) yield s ? this.wrap(s) : null;
  }
}

/**
 * The frame decoder to use for an asset outside the preview's <video> elements (export, render
 * cache): Mediabunny's CanvasSink for SDR, the raw-signal sink for HDR sources.
 */
export function canvasSinkFor(asset: Pick<MediaAsset, 'id' | 'hdr'> | undefined, track: InputVideoTrack, options?: CanvasSinkOptions): CanvasSink {
  if (asset?.hdr && hdrPassthrough()) return new RawSignalSink(track, options) as unknown as CanvasSink;
  return new CanvasSink(track, options);
}
