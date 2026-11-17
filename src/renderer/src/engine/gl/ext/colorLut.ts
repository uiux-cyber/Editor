/**
 * User / built-in LUTs (VisualProps.lut) as a layer extension. 3D tables are sampled from a
 * `sampler3D` with hardware trilinear filtering; 1D tables from a one-row texture. The table's
 * DOMAIN_MIN / DOMAIN_MAX is honoured and `intensity` mixes the result with the input.
 *
 * Missing LUTs (deleted, or a project from another PC) degrade gracefully: the layer renders
 * without the LUT and the inspector shows a warning.
 */

import type { CubeLut } from '@shared/cube';
import type { VisualClip } from '@/core/types';
import { bindSampler, create3DTexture, createRowTexture, TextureCache } from '../../color/glTextures';
import { ensureLuts, getLutData, lutIdsInProject, lutVersion } from '../../color/lutStore';
import type { LayerExtension } from '../layerExt';

const cache = new TextureCache(12);
const dummies = new WeakMap<WebGL2RenderingContext, WebGLTexture>();

function dummy3d(gl: WebGL2RenderingContext, unit: number): WebGLTexture {
  let t = dummies.get(gl);
  if (!t) {
    t = create3DTexture(gl, new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1]), 2, unit);
    dummies.set(gl, t);
  }
  return t;
}

function rowData(lut: CubeLut): Float32Array {
  const out = new Float32Array(lut.size * 4);
  for (let i = 0; i < lut.size; i++) {
    out[i * 4] = lut.data[i * 3];
    out[i * 4 + 1] = lut.data[i * 3 + 1];
    out[i * 4 + 2] = lut.data[i * 3 + 2];
    out[i * 4 + 3] = 1;
  }
  return out;
}

export function activeLut(clip: VisualClip): { id: string; intensity: number } | null {
  const ref = clip.lut;
  if (!ref || typeof ref.id !== 'string' || !ref.id) return null;
  const intensity = Math.min(1, Math.max(0, Number.isFinite(ref.intensity) ? ref.intensity : 1));
  return intensity > 0.0005 ? { id: ref.id, intensity } : null;
}

const ext: LayerExtension = {
  id: 'color_lut',
  stage: 'grade',
  order: 30,
  decls: `uniform highp sampler3D ext_color_lut_tex3;
uniform sampler2D ext_color_lut_tex1;
uniform vec3 ext_color_lut_params;   // mode (1 = 3D, 2 = 1D), intensity, size
uniform vec3 ext_color_lut_dmin;
uniform vec3 ext_color_lut_dmax;`,
  body: `
    vec3 lc = clamp((rgb - ext_color_lut_dmin) / (ext_color_lut_dmax - ext_color_lut_dmin), 0.0, 1.0);
    float ln = ext_color_lut_params.z;
    vec3 ltc = lc * ((ln - 1.0) / ln) + 0.5 / ln;
    vec3 lg;
    if (ext_color_lut_params.x > 1.5) {
      lg = vec3(texture(ext_color_lut_tex1, vec2(ltc.r, 0.5)).r, texture(ext_color_lut_tex1, vec2(ltc.g, 0.5)).g, texture(ext_color_lut_tex1, vec2(ltc.b, 0.5)).b);
    } else {
      lg = texture(ext_color_lut_tex3, ltc).rgb;
    }
    rgb = clamp(mix(rgb, lg, ext_color_lut_params.y), 0.0, 1.0);`,
  apply: ({ gl, prog, clip, unit }) => {
    // The 3D sampler must never share a texture unit with the 2D samplers (WebGL forbids it),
    // so it always gets its own unit, bound to a placeholder when no 3D LUT is active.
    const u3 = unit();
    const loc3 = prog.loc('ext_color_lut_tex3');
    const ref = activeLut(clip);
    const lut = ref ? getLutData(ref.id) : null;
    if (!ref || !lut) {
      bindSampler(gl, loc3, u3, gl.TEXTURE_3D, dummy3d(gl, u3));
      return false;
    }
    const key = `${ref.id}#${lutVersion(ref.id)}`;
    if (lut.kind === '3d') {
      const tex = cache.get(gl, key, () => create3DTexture(gl, lut.data, lut.size, u3));
      if (!tex) return false;
      bindSampler(gl, loc3, u3, gl.TEXTURE_3D, tex);
    } else {
      bindSampler(gl, loc3, u3, gl.TEXTURE_3D, dummy3d(gl, u3));
      const u1 = unit();
      const tex = cache.get(gl, key, () => createRowTexture(gl, rowData(lut), lut.size, u1));
      if (!tex) return false;
      bindSampler(gl, prog.loc('ext_color_lut_tex1'), u1, gl.TEXTURE_2D, tex);
    }
    gl.uniform3f(prog.loc('ext_color_lut_params'), lut.kind === '3d' ? 1 : 2, ref.intensity, lut.size);
    gl.uniform3f(prog.loc('ext_color_lut_dmin'), lut.domainMin[0], lut.domainMin[1], lut.domainMin[2]);
    gl.uniform3f(prog.loc('ext_color_lut_dmax'), lut.domainMax[0], lut.domainMax[1], lut.domainMax[2]);
    return true;
  },
  prepare: (project) => ensureLuts(lutIdsInProject(project)),
};

export default ext;
