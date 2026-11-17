/**
 * Tone curves (Grade.curves) as a layer extension: the four curves are baked into one
 * 256-entry RGBA lookup row (core/color/curves.ts) and sampled per channel with linear
 * filtering. Runs in the grade stage after the colour wheels, for clips and adjustment layers.
 */

import { curvesLut, CURVE_LUT_SIZE, isIdentityCurves, sanitizeCurves } from '@/core/color/curves';
import type { Curves } from '@/core/types';
import { bindSampler, createRowTexture, TextureCache } from '../../color/glTextures';
import type { LayerExtension } from '../layerExt';

// Project data is immutable (immer), so derived values can be memoised per curves object.
const memo = new WeakMap<object, { key: string; identity: boolean; curves: Curves }>();
const cache = new TextureCache(32);

function info(curves: Curves): { key: string; identity: boolean; curves: Curves } {
  let m = memo.get(curves);
  if (!m) {
    const clean = sanitizeCurves(curves);
    m = { key: JSON.stringify(clean), identity: isIdentityCurves(clean), curves: clean };
    memo.set(curves, m);
  }
  return m;
}

const ext: LayerExtension = {
  id: 'color_curves',
  stage: 'grade',
  order: 20,
  decls: `uniform sampler2D ext_color_curves_lut;`,
  body: `
    vec3 ccu = clamp(rgb, 0.0, 1.0) * ${((CURVE_LUT_SIZE - 1) / CURVE_LUT_SIZE).toFixed(8)} + ${(0.5 / CURVE_LUT_SIZE).toFixed(8)};
    rgb = vec3(
      texture(ext_color_curves_lut, vec2(ccu.r, 0.5)).r,
      texture(ext_color_curves_lut, vec2(ccu.g, 0.5)).g,
      texture(ext_color_curves_lut, vec2(ccu.b, 0.5)).b);`,
  apply: ({ gl, prog, clip, unit }) => {
    // Sampler uniforms keep their value between draws: when inactive, point this 2D sampler back
    // at unit 0 (a 2D texture) so it can never share a unit with another extension's sampler3D.
    const loc = prog.loc('ext_color_curves_lut');
    const off = (): boolean => {
      if (loc) gl.uniform1i(loc, 0);
      return false;
    };
    const curves = clip.adjust?.curves;
    if (!curves || typeof curves !== 'object') return off();
    const m = info(curves);
    if (m.identity) return off();
    const u = unit();
    const tex = cache.get(gl, m.key, () => createRowTexture(gl, curvesLut(m.curves), CURVE_LUT_SIZE, u));
    if (!tex) return off();
    bindSampler(gl, loc, u, gl.TEXTURE_2D, tex);
    return true;
  },
};

export default ext;
