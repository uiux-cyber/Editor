/**
 * The compositor renders one frame of a project into a WebGL2 canvas. The live preview and the
 * exporter both use it, each with its own instance (and GL context) and its own MediaProvider.
 */

import { quantizeScale, type Raster } from './sources/raster';
import { ShapeRenderer } from './sources/shape';
import { StickerRenderer } from './sources/sticker';
import { TextRenderer } from './sources/text';
import { GLContext, type Target } from './gl/context';
import { isNeutralGrade, resolveFilterGrade, setGradeUniforms } from './gl/grade';
import { LAYER_EXTENSIONS } from './gl/layerExt';
import { BLEND_FRAG, BLEND_MODE_INDEX, COPY_FRAG, LAYER_VERT, MASK_SHAPE_INDEX, PRESENT_FRAG, layerFrag } from './gl/shaders';
import { FULLSCREEN_VERT, hexToRgba, setParamUniforms, wrapEffect, wrapGenerator, wrapTransition, type Program } from './gl/shaderlib';
import { propAt } from '@/core/keyframes';
import { designSize, fitContain, sourceTimeAt } from '@/core/project';
import { getSceneItems, resolveLayer, type LayerRef, type ResolvedLayer } from '@/core/scene';
import type { BlendMode, EffectInstance, ID, ParamValue, Project, Transition, VideoClip, VisualClip } from '@/core/types';
import { getEffect, getGenerator, getTransition } from '@/library';
import type { EffectDef } from '@/library/types';

export interface FrameImage {
  source: TexImageSource;
  /** Display size of the picture in real pixels. */
  width: number;
  height: number;
  /** Changes whenever the pixels change; identical versions skip the texture upload. */
  version: number;
  /** True for pictures that change over time (animated images): skips mipmap generation. */
  animated?: boolean;
}

/** Supplies decoded pictures. The preview reads live <video> elements, the exporter decoded frames. */
export interface MediaProvider {
  videoFrame(clip: VideoClip, sourceTime: number): FrameImage | null;
  /**
   * Still or animated image. `time` is seconds since the clip start (for animated assets);
   * `hint` is the size in real pixels the picture is drawn at (vector sources such as Lottie
   * render at that size so they stay sharp).
   */
  image(assetId: ID, time?: number, hint?: { width: number; height: number }): FrameImage | null;
  /**
   * Optional matte for background removal: white = keep. Same orientation as the frame returned
   * by videoFrame / image for that clip. Consumed by the cutout layer extension.
   */
  matte?(clip: VisualClip, time: number): FrameImage | null;
}

/** Where a layer ended up, in design px relative to the composition centre. */
export interface LayerBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  /** Natural content size at scale 1. */
  baseW: number;
  baseH: number;
}

interface TexEntry {
  tex: WebGLTexture;
  version: number;
  width: number;
  height: number;
  lastUsed: number;
}

interface Prepared {
  clip: VisualClip;
  localTime: number;
  tex: WebGLTexture;
  texW: number;
  texH: number;
  /** Quad size at scale 1, design px. */
  baseW: number;
  baseH: number;
  uvRect: [number, number, number, number];
  r: ResolvedLayer;
  effects: EffectInstance[];
  /** Whether quad-level features (rounded corners / edge AA) apply to this source. */
  quadShaping: boolean;
  temp?: Target;
}

interface FrameEnv {
  project: Project;
  provider: MediaProvider;
  W: number;
  H: number;
  cw: number;
  ch: number;
  /** Render pixels per design pixel. */
  px: number;
}

export interface CompositorOptions {
  preserveDrawingBuffer?: boolean;
}

const EVICT_AFTER_FRAMES = 240;

export class Compositor {
  readonly ctx: GLContext;
  readonly layout = new Map<ID, LayerBox>();
  private text = new TextRenderer();
  private shapes = new ShapeRenderer();
  private stickers = new StickerRenderer();
  private textures = new Map<string, TexEntry>();
  private frame = 0;
  private last: Target | null = null;
  private lastPrune: Project | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: CompositorOptions = {}) {
    this.ctx = new GLContext(canvas, opts);
  }

  get canvas(): HTMLCanvasElement | OffscreenCanvas {
    return this.ctx.canvas;
  }

  /** Set the render resolution (canvas backing size) in real pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.release(this.last);
      this.last = null;
      this.ctx.trimPool();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  render(project: Project, time: number, provider: MediaProvider): void {
    const { ctx } = this;
    const gl = ctx.gl;
    if (gl.isContextLost()) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const { cw, ch } = designSize(project.settings);
    const env: FrameEnv = { project, provider, W, H, cw, ch, px: W / cw };
    this.frame++;
    this.layout.clear();

    let comp = ctx.acquire(W, H, false);
    ctx.bind(comp);
    const [br, bg, bb] = hexToRgba(project.settings.background);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const item of getSceneItems(project, time)) {
      if (item.kind === 'layer') {
        if (item.layer.clip.type === 'adjustment') {
          comp = this.applyAdjustment(comp, item.layer, env);
          continue;
        }
        const p = this.prepare(item.layer, env);
        if (!p) continue;
        if (p.r.opacity > 0.001) {
          const needsFull = p.effects.length > 0 || p.r.blur > 0.05 || p.clip.blendMode !== 'normal';
          if (!needsFull) {
            this.drawLayer(p, comp, env);
          } else {
            const full = this.renderFull(p, env);
            comp = this.composite(comp, full, p.clip.blendMode, 1, env);
            ctx.release(full);
          }
        }
        ctx.release(p.temp);
      } else {
        const a = this.renderRef(item.from, env);
        const b = this.renderRef(item.to, env);
        const out = this.runTransition(item.transition, a, b, item.progress, env);
        ctx.release(a);
        ctx.release(b);
        comp = this.composite(comp, out, 'normal', 1, env);
        ctx.release(out);
      }
    }

    // Present
    ctx.bind(null);
    gl.disable(gl.BLEND);
    const present = ctx.program('present', FULLSCREEN_VERT, PRESENT_FRAG);
    if (present) {
      gl.useProgram(present.program);
      ctx.useTexture(present, 'u_tex', 0, comp.tex);
      ctx.drawQuad();
    }
    ctx.release(this.last);
    this.last = comp;

    this.evict();
    if (this.lastPrune !== project) {
      this.lastPrune = project;
      const alive = new Set(Object.keys(project.clips));
      this.text.prune(alive);
      this.shapes.prune(alive);
      this.stickers.prune(alive);
    }
  }

  /** RGBA pixels of the last rendered frame, top row first. */
  readPixels(): { data: Uint8Array; width: number; height: number } | null {
    if (!this.last) return null;
    const gl = this.ctx.gl;
    const { width, height } = this.last;
    const data = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.last.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, width, height };
  }

  // -------------------------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------------------------

  private texture(key: string, version: number, upload: () => { source: TexImageSource; width: number; height: number; mipmaps: boolean } | null): TexEntry | null {
    let entry = this.textures.get(key);
    if (entry && entry.version === version) {
      entry.lastUsed = this.frame;
      return entry;
    }
    const data = upload();
    if (!data) {
      if (entry) entry.lastUsed = this.frame;
      return entry ?? null;
    }
    if (!entry) {
      entry = { tex: this.ctx.createTexture(), version: -1, width: 0, height: 0, lastUsed: this.frame };
      this.textures.set(key, entry);
    }
    if (!this.ctx.upload(entry.tex, data.source, data.mipmaps)) return entry.version === -1 ? null : entry;
    entry.version = version;
    entry.width = data.width;
    entry.height = data.height;
    entry.lastUsed = this.frame;
    return entry;
  }

  private rasterTexture(clipId: ID, raster: Raster): TexEntry | null {
    return this.texture(`r:${clipId}`, raster.version, () => ({
      source: raster.canvas as TexImageSource,
      width: raster.canvas.width,
      height: raster.canvas.height,
      mipmaps: raster.static,
    }));
  }

  private evict(): void {
    if (this.frame % 60 !== 0) return;
    const gl = this.ctx.gl;
    for (const [key, entry] of this.textures) {
      if (this.frame - entry.lastUsed > EVICT_AFTER_FRAMES) {
        gl.deleteTexture(entry.tex);
        this.textures.delete(key);
      }
    }
  }

  private prepare(ref: LayerRef, env: FrameEnv): Prepared | null {
    const { clip, localTime } = ref;
    const { cw, ch, px } = env;
    const t = Math.min(Math.max(localTime, 0), clip.duration);
    let tex: WebGLTexture;
    let texW: number;
    let texH: number;
    let baseW: number;
    let baseH: number;
    let contentW: number;
    let contentH: number;
    let uv: [number, number, number, number] = [0, 0, 1, 1];
    let temp: Target | undefined;
    let quadShaping = false;

    // Pixel density for rasterised sources follows the layer's own (keyframed) scale.
    const ownScale = Math.max(Math.abs(propAt(clip, 'scaleX', t)), Math.abs(propAt(clip, 'scaleY', t)), 0.05);
    const rasterScale = px * quantizeScale(ownScale);

    switch (clip.type) {
      case 'video':
      case 'image': {
        const asset = env.project.assets[clip.assetId];
        if (!asset) return null;
        let entry: TexEntry | null;
        if (clip.type === 'video') {
          const maxT = asset.duration > 0 ? Math.max(0, asset.duration - 0.001) : Infinity;
          const sourceTime = Math.min(Math.max(sourceTimeAt(clip, localTime), 0), maxT);
          const frame = env.provider.videoFrame(clip, sourceTime);
          const key = `v:${clip.id}`;
          if (frame) entry = this.texture(key, frame.version, () => ({ source: frame.source, width: frame.width, height: frame.height, mipmaps: false }));
          else {
            entry = this.textures.get(key) ?? null;
            if (entry) entry.lastUsed = this.frame;
          }
        } else {
          // Animated assets: ask for the frame at the size the layer covers on screen.
          let hint: { width: number; height: number } | undefined;
          if (asset.kind === 'animation') {
            const c = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
            const kw = Math.max(0.01, 1 - c.l - c.r);
            const kh = Math.max(0.01, 1 - c.t - c.b);
            const fit = fitContain(asset.width * kw, asset.height * kh, cw, ch);
            const k = px * quantizeScale(ownScale);
            hint = { width: Math.ceil((fit.w / kw) * k), height: Math.ceil((fit.h / kh) * k) };
          }
          const img = env.provider.image(clip.assetId, t, hint);
          const key = img?.animated ? `i:${clip.id}` : `i:${clip.assetId}`;
          if (img) entry = this.texture(key, img.version, () => ({ source: img.source, width: img.width, height: img.height, mipmaps: !img.animated }));
          else {
            entry = this.textures.get(key) ?? null;
            if (entry) entry.lastUsed = this.frame;
          }
        }
        if (!entry) return null;
        tex = entry.tex;
        texW = entry.width;
        texH = entry.height;
        const crop = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const keepW = Math.max(0.01, 1 - crop.l - crop.r);
        const keepH = Math.max(0.01, 1 - crop.t - crop.b);
        uv = [crop.l, crop.t, crop.l + keepW, crop.t + keepH];
        const srcW = (asset.width || entry.width) * keepW;
        const srcH = (asset.height || entry.height) * keepH;
        const fit = fitContain(srcW, srcH, cw, ch);
        baseW = contentW = fit.w;
        baseH = contentH = fit.h;
        quadShaping = true;
        break;
      }
      case 'text':
      case 'shape':
      case 'sticker': {
        const raster = clip.type === 'text' ? this.text.render(clip, localTime, rasterScale) : clip.type === 'shape' ? this.shapes.render(clip, rasterScale) : this.stickers.render(clip, t, rasterScale);
        if (!raster) return null;
        const entry = this.rasterTexture(clip.id, raster);
        if (!entry) return null;
        tex = entry.tex;
        texW = entry.width;
        texH = entry.height;
        baseW = raster.width;
        baseH = raster.height;
        contentW = raster.contentW;
        contentH = raster.contentH;
        break;
      }
      case 'generator': {
        const def = getGenerator(clip.generatorId);
        if (!def) return null;
        const prog = this.ctx.program(`gen:${def.id}`, FULLSCREEN_VERT, () => wrapGenerator(def));
        if (!prog) return null;
        const gl = this.ctx.gl;
        temp = this.ctx.acquire(env.W, env.H, false);
        this.ctx.bind(temp);
        gl.disable(gl.BLEND);
        gl.useProgram(prog.program);
        gl.uniform2f(prog.loc('u_res'), env.W, env.H);
        gl.uniform1f(prog.loc('u_px'), px);
        gl.uniform1f(prog.loc('u_time'), t);
        gl.uniform1f(prog.loc('u_aspect'), cw / ch);
        setParamUniforms(gl, prog, def.params, clip.params);
        this.ctx.drawQuad();
        tex = temp.tex;
        texW = env.W;
        texH = env.H;
        baseW = contentW = cw;
        baseH = contentH = ch;
        quadShaping = true;
        break;
      }
      default:
        return null;
    }

    if (clip.flipH) uv = [uv[2], uv[1], uv[0], uv[3]];
    if (clip.flipV) uv = [uv[0], uv[3], uv[2], uv[1]];

    const r = resolveLayer(clip, localTime, baseW, baseH, cw, ch);
    this.layout.set(clip.id, {
      cx: r.x,
      cy: r.y,
      w: contentW * Math.abs(r.scaleX),
      h: contentH * Math.abs(r.scaleY),
      rotation: r.rotation,
      baseW: contentW,
      baseH: contentH,
    });
    const effects = clip.effects.filter((fx) => fx.enabled && !!getEffect(fx.effectId));
    return { clip, localTime: t, tex, texW, texH, baseW, baseH, uvRect: uv, r, effects, quadShaping, temp };
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  private layerProgram(): Program | null {
    return this.ctx.program('layer', LAYER_VERT, layerFrag);
  }

  /** Draw a prepared layer into `target` with normal alpha blending. */
  private drawLayer(p: Prepared, target: Target, env: FrameEnv, override?: { opacity?: number; identity?: boolean }): void {
    const prog = this.layerProgram();
    if (!prog) return;
    const { ctx } = this;
    const gl = ctx.gl;
    const { clip, r } = p;
    const { cw, ch, px } = env;
    ctx.bind(target);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog.program);

    // Unit quad → design px (centred, scaled, rotated, moved) → clip space. Row 0 is the top.
    const identity = !!override?.identity;
    const a = identity ? cw : p.baseW * r.scaleX;
    const b = identity ? ch : p.baseH * r.scaleY;
    const rad = identity ? 0 : (r.rotation * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const x = identity ? 0 : r.x;
    const y = identity ? 0 : r.y;
    const kx = 2 / cw;
    const ky = 2 / ch;
    // Column-major 3×3.
    gl.uniformMatrix3fv(prog.loc('u_matrix'), false, [
      a * c * kx,
      a * s * ky,
      0,
      -b * s * kx,
      b * c * ky,
      0,
      (x - 0.5 * a * c + 0.5 * b * s) * kx,
      (y - 0.5 * a * s - 0.5 * b * c) * ky,
      1,
    ]);

    ctx.useTexture(prog, 'u_tex', 0, p.tex);
    gl.uniform4f(prog.loc('u_uvRect'), p.uvRect[0], p.uvRect[1], p.uvRect[2], p.uvRect[3]);
    gl.uniform2f(prog.loc('u_texel'), 1 / Math.max(1, p.texW), 1 / Math.max(1, p.texH));
    gl.uniform1f(prog.loc('u_opacity'), override?.opacity ?? r.opacity);
    const sizeX = Math.abs(a) * px;
    const sizeY = Math.abs(b) * px;
    gl.uniform2f(prog.loc('u_size'), sizeX, sizeY);
    gl.uniform1f(prog.loc('u_px'), px);
    gl.uniform1f(prog.loc('u_time'), p.localTime);

    const shaping = p.quadShaping && !identity;
    const radius = shaping && clip.cornerRadius ? Math.min(1, Math.max(0, clip.cornerRadius)) * (Math.min(sizeX, sizeY) / 2) : 0;
    const rotated = Math.abs(((r.rotation % 90) + 90) % 90) > 0.01;
    gl.uniform1f(prog.loc('u_radius'), radius);
    gl.uniform1f(prog.loc('u_edgeAA'), shaping && rotated ? 1 : 0);
    if (identity) gl.uniform4f(prog.loc('u_clip'), 0, 0, 0, 0);
    else gl.uniform4f(prog.loc('u_clip'), r.clipL, r.clipT, r.clipR, r.clipB);

    const mask = clip.mask;
    if (mask) {
      gl.uniform1i(prog.loc('u_maskShape'), MASK_SHAPE_INDEX[mask.shape] ?? 0);
      gl.uniform4f(prog.loc('u_maskRect'), mask.cx, mask.cy, Math.max(0.001, mask.w), Math.max(0.001, mask.h));
      // rot2(θ) rotates by -θ, which takes a pixel into the frame of a mask rotated by +θ.
      gl.uniform4f(prog.loc('u_maskOpts'), (mask.rotation * Math.PI) / 180, mask.feather, mask.radius, mask.invert ? 1 : 0);
    } else {
      gl.uniform1i(prog.loc('u_maskShape'), 0);
    }

    const ck = clip.chromaKey;
    if (ck && ck.enabled) {
      const [kr, kg, kb] = hexToRgba(ck.color);
      gl.uniform4f(prog.loc('u_chroma'), 1, ck.similarity, ck.smoothness, ck.spill);
      gl.uniform3f(prog.loc('u_chromaKey'), kr, kg, kb);
    } else {
      gl.uniform4f(prog.loc('u_chroma'), 0, 0, 0, 0);
    }

    const adjust = clip.adjust && !isNeutralGrade(clip.adjust) ? clip.adjust : null;
    const filter = resolveFilterGrade(clip.filter);
    gl.uniform1f(prog.loc('u_adjustOn'), adjust ? 1 : 0);
    gl.uniform1f(prog.loc('u_filterOn'), filter ? 1 : 0);
    if (adjust) setGradeUniforms(gl, prog, 'u_adjust', adjust);
    if (filter) setGradeUniforms(gl, prog, 'u_filter', filter);
    gl.uniform3f(
      prog.loc('u_spatial'),
      Math.min(1, (adjust?.sharpen ?? 0) + (filter?.sharpen ?? 0)),
      Math.min(1, (adjust?.vignette ?? 0) + (filter?.vignette ?? 0)),
      Math.min(1, (adjust?.grain ?? 0) + (filter?.grain ?? 0)),
    );

    // Layer extensions (engine/gl/ext): each sets its uniforms and decides whether it runs.
    if (LAYER_EXTENSIONS.length) {
      let nextUnit = 4;
      const sourceTime = clip.type === 'video' ? sourceTimeAt(clip, p.localTime) : undefined;
      for (const ext of LAYER_EXTENSIONS) {
        let on = false;
        try {
          on = ext.apply({ gl, glctx: ctx, prog, clip, localTime: p.localTime, sourceTime, provider: env.provider, W: env.W, H: env.H, px, identity, unit: () => nextUnit++ });
        } catch (err) {
          console.warn(`[gl] layer extension "${ext.id}" failed`, err);
        }
        gl.uniform1f(prog.loc(`u_ext_${ext.id}`), on ? 1 : 0);
      }
    }

    ctx.drawQuad();
  }

  /** Render a layer alone into a transparent full-frame target and run its effects. */
  private renderFull(p: Prepared, env: FrameEnv): Target {
    let target = this.ctx.acquire(env.W, env.H, true);
    this.drawLayer(p, target, env);
    const progress = p.clip.duration > 0 ? p.localTime / p.clip.duration : 0;
    for (const fx of p.effects) {
      const def = getEffect(fx.effectId);
      if (def) target = this.runEffect(def, fx.params, target, p.localTime, progress, env);
    }
    if (p.r.blur > 0.05) {
      const blur = getEffect('gaussian-blur');
      if (blur) target = this.runEffect(blur, { radius: p.r.blur }, target, p.localTime, progress, env);
    }
    return target;
  }

  /** Render a transition participant; returns a transparent frame when it cannot be drawn. */
  private renderRef(ref: LayerRef, env: FrameEnv): Target {
    if (ref.clip.type === 'adjustment') return this.ctx.acquire(env.W, env.H, true);
    const p = this.prepare(ref, env);
    if (!p) return this.ctx.acquire(env.W, env.H, true);
    const full = p.r.opacity > 0.001 ? this.renderFull(p, env) : this.ctx.acquire(env.W, env.H, true);
    this.ctx.release(p.temp);
    return full;
  }

  /** Runs every pass of an effect; consumes `input` and returns the result. */
  private runEffect(def: EffectDef, params: Record<string, ParamValue>, input: Target, time: number, progress: number, env: FrameEnv): Target {
    const { ctx } = this;
    const gl = ctx.gl;
    const prog = ctx.program(`fx:${def.id}`, FULLSCREEN_VERT, () => wrapEffect(def));
    if (!prog) return input;
    const passes = Math.min(4, Math.max(1, def.passes ?? 1));
    let current = input;
    gl.disable(gl.BLEND);
    for (let pass = 0; pass < passes; pass++) {
      const out = ctx.acquire(env.W, env.H, false);
      ctx.bind(out);
      gl.useProgram(prog.program);
      ctx.useTexture(prog, 'u_tex', 0, current.tex);
      ctx.useTexture(prog, 'u_orig', 1, input.tex);
      gl.uniform2f(prog.loc('u_res'), env.W, env.H);
      gl.uniform1f(prog.loc('u_px'), env.px);
      gl.uniform1f(prog.loc('u_time'), time);
      gl.uniform1f(prog.loc('u_progress'), Math.min(1, Math.max(0, progress)));
      gl.uniform1f(prog.loc('u_aspect'), env.W / env.H);
      gl.uniform1i(prog.loc('u_pass'), pass);
      setParamUniforms(gl, prog, def.params, params);
      ctx.drawQuad();
      if (current !== input) ctx.release(current);
      current = out;
    }
    ctx.release(input);
    return current;
  }

  /** Composite a full-frame layer over `comp`. Consumes `comp`, returns the new backdrop. */
  private composite(comp: Target, layer: Target, mode: BlendMode, opacity: number, env: FrameEnv): Target {
    const { ctx } = this;
    const gl = ctx.gl;
    if (mode === 'normal') {
      const prog = ctx.program('copy', FULLSCREEN_VERT, COPY_FRAG);
      if (!prog) return comp;
      ctx.bind(comp);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog.program);
      ctx.useTexture(prog, 'u_tex', 0, layer.tex);
      gl.uniform1f(prog.loc('u_opacity'), opacity);
      ctx.drawQuad();
      return comp;
    }
    const prog = ctx.program('blend', FULLSCREEN_VERT, BLEND_FRAG);
    if (!prog) return comp;
    const out = ctx.acquire(env.W, env.H, false);
    ctx.bind(out);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    ctx.useTexture(prog, 'u_base', 0, comp.tex);
    ctx.useTexture(prog, 'u_layer', 1, layer.tex);
    gl.uniform1i(prog.loc('u_mode'), BLEND_MODE_INDEX[mode] ?? 0);
    gl.uniform1f(prog.loc('u_opacity'), opacity);
    ctx.drawQuad();
    ctx.release(comp);
    return out;
  }

  private runTransition(tr: Transition, from: Target, to: Target, progress: number, env: FrameEnv): Target {
    const { ctx } = this;
    const gl = ctx.gl;
    const def = getTransition(tr.type) ?? getTransition('fade');
    const out = ctx.acquire(env.W, env.H, true);
    const prog = def ? ctx.program(`tr:${def.id}`, FULLSCREEN_VERT, () => wrapTransition(def)) : null;
    if (!def || !prog) {
      // Unknown or broken transition: fall back to a hard cut at the midpoint.
      return this.composite(out, progress < 0.5 ? from : to, 'normal', 1, env);
    }
    ctx.bind(out);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    ctx.useTexture(prog, 'u_from', 0, from.tex);
    ctx.useTexture(prog, 'u_to', 1, to.tex);
    gl.uniform1f(prog.loc('progress'), Math.min(1, Math.max(0, progress)));
    gl.uniform1f(prog.loc('ratio'), env.W / env.H);
    setParamUniforms(gl, prog, def.params, tr.params);
    ctx.drawQuad();
    return out;
  }

  /** Grade + effects applied to everything rendered so far. Consumes and returns the backdrop. */
  private applyAdjustment(comp: Target, ref: LayerRef, env: FrameEnv): Target {
    const { clip, localTime } = ref;
    const { cw, ch } = env;
    const t = Math.min(Math.max(localTime, 0), clip.duration);
    const r = resolveLayer(clip, localTime, cw, ch, cw, ch);
    this.layout.set(clip.id, { cx: 0, cy: 0, w: cw, h: ch, rotation: 0, baseW: cw, baseH: ch });
    if (r.opacity <= 0.001) return comp;
    const effects = clip.effects.filter((fx) => fx.enabled && !!getEffect(fx.effectId));
    const p: Prepared = { clip, localTime: t, tex: comp.tex, texW: env.W, texH: env.H, baseW: cw, baseH: ch, uvRect: [0, 0, 1, 1], r, effects, quadShaping: false };
    let processed = this.ctx.acquire(env.W, env.H, true);
    this.drawLayer(p, processed, env, { opacity: 1, identity: true });
    const progress = clip.duration > 0 ? t / clip.duration : 0;
    for (const fx of effects) {
      const def = getEffect(fx.effectId);
      if (def) processed = this.runEffect(def, fx.params, processed, t, progress, env);
    }
    const out = this.composite(comp, processed, 'normal', r.opacity, env);
    this.ctx.release(processed);
    return out;
  }

  dispose(): void {
    const gl = this.ctx.gl;
    for (const entry of this.textures.values()) gl.deleteTexture(entry.tex);
    this.textures.clear();
    this.ctx.release(this.last);
    this.last = null;
    this.text.clear();
    this.shapes.clear();
    this.stickers.clear();
    this.ctx.dispose();
  }
}
