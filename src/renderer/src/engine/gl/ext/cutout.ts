/**
 * Background removal (alpha stage): multiplies the layer's coverage by a person matte supplied
 * through `MediaProvider.matte` (see vision/cutout.ts).
 *
 * The matte is low resolution (≈384 px), so it is upsampled with an edge-aware (joint
 * bilateral) filter guided by the layer's own pixels: matte samples across a colour edge get
 * little weight, which snaps the cut-out boundary to the real edge in the picture. Feather
 * widens the filter and softens the transition; choke shifts the threshold to shrink (negative)
 * or grow (positive) the matte.
 */

import type { FrameImage } from '../../compositor';
import type { GLContext } from '../context';
import type { LayerExtension } from '../layerExt';

interface TexEntry {
  tex: WebGLTexture;
  version: number;
  w: number;
  h: number;
  used: number;
}

const textures = new WeakMap<GLContext, Map<string, TexEntry>>();
let tick = 0;

function matteTexture(glctx: GLContext, clipId: string, m: FrameImage): TexEntry | null {
  let map = textures.get(glctx);
  if (!map) textures.set(glctx, (map = new Map()));
  let e = map.get(clipId);
  tick++;
  if (!e) {
    e = { tex: glctx.createTexture(), version: -1, w: 0, h: 0, used: tick };
    map.set(clipId, e);
    // Bound the number of matte textures per context.
    if (map.size > 24) {
      const oldest = [...map.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      glctx.gl.deleteTexture(oldest[1].tex);
      map.delete(oldest[0]);
    }
  }
  e.used = tick;
  if (e.version !== m.version) {
    if (!glctx.upload(e.tex, m.source, false)) return e.version >= 0 ? e : null;
    e.version = m.version;
    e.w = m.width;
    e.h = m.height;
  } else {
    glctx.gl.bindTexture(glctx.gl.TEXTURE_2D, e.tex);
  }
  return e;
}

const cutout: LayerExtension = {
  id: 'cutout',
  stage: 'alpha',
  order: 10,
  decls: `
uniform sampler2D u_ext_cutout_mask;
uniform vec4 u_ext_cutout_p; // mask texel x, y, feather, choke
`,
  body: `
    vec2 ctx_ = u_ext_cutout_p.xy;
    float cfe_ = clamp(u_ext_cutout_p.z, 0.0, 1.0);
    float cch_ = clamp(u_ext_cutout_p.w, -1.0, 1.0);
    vec4 cs0_ = texture(u_tex, tuv);
    vec3 cg0_ = cs0_.a > 0.0 ? cs0_.rgb / cs0_.a : vec3(0.0);
    float cspread_ = 0.6 + cfe_ * 2.4;
    float crange_ = mix(42.0, 5.0, cfe_);
    float csum_ = 0.0;
    float cw_ = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 o = vec2(float(i), float(j)) * ctx_ * cspread_;
        float m = texture(u_ext_cutout_mask, tuv + o).r;
        vec4 cs = texture(u_tex, tuv + o);
        vec3 cg = cs.a > 0.0 ? cs.rgb / cs.a : vec3(0.0);
        vec3 dc = cg - cg0_;
        float w = exp(-dot(dc, dc) * crange_) * exp(-float(i * i + j * j) * 0.22);
        csum_ += m * w;
        cw_ += w;
      }
    }
    float cm_ = csum_ / max(cw_, 1e-5);
    float cmid_ = clamp(0.5 - cch_ * 0.36, 0.06, 0.94);
    float csoft_ = 0.05 + cfe_ * 0.32;
    alpha *= smoothstep(cmid_ - csoft_, cmid_ + csoft_, cm_);
`,
  apply: (ctx) => {
    const clip = ctx.clip;
    const gl = ctx.gl;
    // Sampler uniforms keep their value between draws: when inactive, point the mask sampler back
    // at unit 0 (a 2D texture) so it never shares a unit with another extension's sampler3D.
    const maskLoc = ctx.prog.loc('u_ext_cutout_mask');
    const off = (): boolean => {
      if (maskLoc) gl.uniform1i(maskLoc, 0);
      return false;
    };
    if (ctx.identity || (clip.type !== 'video' && clip.type !== 'image') || !clip.cutout?.enabled) return off();
    const matte = ctx.provider.matte?.(clip, clip.type === 'video' ? (ctx.sourceTime ?? ctx.localTime) : ctx.localTime);
    if (!matte) return off();
    const unit = ctx.unit();
    // Activate our unit before touching textures so the layer's own bindings stay intact.
    gl.activeTexture(gl.TEXTURE0 + unit);
    const tex = matteTexture(ctx.glctx, clip.id, matte);
    if (!tex) return off();
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(maskLoc, unit);
    gl.uniform4f(ctx.prog.loc('u_ext_cutout_p'), 1 / Math.max(1, tex.w), 1 / Math.max(1, tex.h), clip.cutout.feather, clip.cutout.choke);
    return true;
  },
};

export default cutout;
