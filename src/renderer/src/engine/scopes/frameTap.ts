/**
 * Reads the preview's composited frame back to the CPU at reduced resolution for the scopes and
 * the curves histogram. The frame is box-filtered down on the GPU, copied into a pixel-pack
 * buffer and fetched asynchronously once a fence signals, so the render loop never stalls.
 * Readbacks are throttled while playing and only run while someone is subscribed.
 */

import type { Compositor } from '../compositor';
import { engine } from '../engine';
import type { Target } from '../gl/context';
import { FULLSCREEN_VERT, GLSL_HEADER } from '../gl/shaderlib';

export interface FramePixels {
  data: Uint8Array;
  width: number;
  height: number;
  /** Increments with every delivered frame. */
  seq: number;
  /** Preview time of the frame. */
  time: number;
}

type Listener = (f: FramePixels) => void;

/** Longest side of the read-back frame. */
const MAX_SIDE = 384;
const PLAYING_INTERVAL_MS = 100;

const DOWNSAMPLE_FRAG = `${GLSL_HEADER}
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_step;   // half a destination texel, in source uv
void main() {
  vec4 c = texture(u_tex, v_uv + vec2(-u_step.x, -u_step.y)) + texture(u_tex, v_uv + vec2(u_step.x, -u_step.y))
         + texture(u_tex, v_uv + vec2(-u_step.x, u_step.y)) + texture(u_tex, v_uv + vec2(u_step.x, u_step.y));
  outColor = vec4(c.rgb * 0.25, 1.0);
}
`;

interface Pending {
  gl: WebGL2RenderingContext;
  buf: WebGLBuffer;
  sync: WebGLSync;
  width: number;
  height: number;
  time: number;
}

class FrameTap {
  private listeners = new Set<Listener>();
  private unhook: (() => void) | null = null;
  private pending: Pending | null = null;
  private buffers = new WeakMap<WebGL2RenderingContext, { buf: WebGLBuffer; size: number }>();
  private lastIssued = 0;
  private wantAnother = false;
  private seq = 0;
  private polling = 0;
  private latest: FramePixels | null = null;

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.latest) cb(this.latest);
    if (!this.unhook) {
      this.unhook = engine.onRendered((c) => this.onRendered(c));
      engine.invalidate();
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.unhook) {
        this.unhook();
        this.unhook = null;
      }
    };
  }

  /** The most recent frame (for tests). */
  get last(): FramePixels | null {
    return this.latest;
  }

  private onRendered(c: Compositor): void {
    if (this.listeners.size === 0) return;
    if (this.pending) {
      this.wantAnother = true;
      return;
    }
    const now = performance.now();
    if (engine.playing && now - this.lastIssued < PLAYING_INTERVAL_MS) return;
    this.issue(c);
  }

  private issue(c: Compositor): void {
    const frame = c.lastFrame;
    if (!frame) return;
    const glctx = c.ctx;
    const gl = glctx.gl;
    if (gl.isContextLost()) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height));
    const w = Math.max(1, Math.round(frame.width * scale));
    const h = Math.max(1, Math.round(frame.height * scale));
    const prog = glctx.program('scopes:downsample', FULLSCREEN_VERT, DOWNSAMPLE_FRAG);
    if (!prog) return;
    let target: Target | null = null;
    try {
      target = glctx.acquire(w, h, false);
      glctx.bind(target);
      gl.disable(gl.BLEND);
      gl.useProgram(prog.program);
      glctx.useTexture(prog, 'u_tex', 0, frame.tex);
      // Four bilinear taps spread over the footprint of one destination texel.
      gl.uniform2f(prog.loc('u_step'), 0.25 / w, 0.25 / h);
      glctx.drawQuad();

      const size = w * h * 4;
      let entry = this.buffers.get(gl);
      if (!entry) {
        entry = { buf: gl.createBuffer()!, size };
        this.buffers.set(gl, entry);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, entry.buf);
      // Fresh storage for every readback: rewriting the old storage would make Chromium discard
      // the shadow copy it keeps for fast asynchronous reads (and log a performance warning).
      gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
      entry.size = size;
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!sync) return;
      this.pending = { gl, buf: entry.buf, sync, width: w, height: h, time: engine.time };
      this.lastIssued = performance.now();
      this.poll();
    } catch (err) {
      console.warn('[scopes] readback failed', err);
    } finally {
      if (target) glctx.release(target);
    }
  }

  private poll = (): void => {
    if (this.polling) return;
    this.polling = requestAnimationFrame(() => {
      this.polling = 0;
      const p = this.pending;
      if (!p) return;
      const gl = p.gl;
      if (gl.isContextLost()) {
        this.pending = null;
        return;
      }
      if (gl.getSyncParameter(p.sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
        this.poll();
        return;
      }
      const data = new Uint8Array(p.width * p.height * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(p.sync);
      this.pending = null;
      const frame: FramePixels = { data, width: p.width, height: p.height, seq: ++this.seq, time: p.time };
      this.latest = frame;
      for (const cb of this.listeners) cb(frame);
      // A frame was rendered while this one was in flight: show it too (paused edits).
      if (this.wantAnother) {
        this.wantAnother = false;
        if (!engine.playing) engine.invalidate();
      }
    });
  };
}

export const frameTap = new FrameTap();
