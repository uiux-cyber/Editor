/**
 * Lift / gamma / gain / offset colour wheels (Grade.wheels) as a layer extension. The maths
 * lives in core/color/wheels.ts (shared with the tests); this file uploads its parameters.
 * Runs first in the grade stage, before curves and LUTs.
 */

import { isNeutralWheels, sanitizeWheels, wheelUniforms, WHEELS_GLSL, type WheelUniforms } from '@/core/color/wheels';
import type { ColorWheels } from '@/core/types';
import type { LayerExtension } from '../layerExt';

const memo = new WeakMap<object, WheelUniforms | null>();

function uniformsFor(w: ColorWheels): WheelUniforms | null {
  let u = memo.get(w);
  if (u === undefined) {
    const clean = sanitizeWheels(w);
    u = isNeutralWheels(clean) ? null : wheelUniforms(clean);
    memo.set(w, u);
  }
  return u;
}

const ext: LayerExtension = {
  id: 'color_wheels',
  stage: 'grade',
  order: 10,
  decls: `uniform vec3 ext_color_wheels_lift;
uniform vec3 ext_color_wheels_gain;
uniform vec3 ext_color_wheels_gamma;
uniform vec3 ext_color_wheels_offset;
${WHEELS_GLSL}`,
  body: `    rgb = ext_wheels_apply(rgb, ext_color_wheels_lift, ext_color_wheels_gain, ext_color_wheels_gamma, ext_color_wheels_offset);`,
  apply: ({ gl, prog, clip }) => {
    const w = clip.adjust?.wheels;
    if (!w || typeof w !== 'object') return false;
    const u = uniformsFor(w);
    if (!u) return false;
    gl.uniform3f(prog.loc('ext_color_wheels_lift'), u.lift[0], u.lift[1], u.lift[2]);
    gl.uniform3f(prog.loc('ext_color_wheels_gain'), u.gain[0], u.gain[1], u.gain[2]);
    gl.uniform3f(prog.loc('ext_color_wheels_gamma'), u.gamma[0], u.gamma[1], u.gamma[2]);
    gl.uniform3f(prog.loc('ext_color_wheels_offset'), u.offset[0], u.offset[1], u.offset[2]);
    return true;
  },
};

export default ext;
