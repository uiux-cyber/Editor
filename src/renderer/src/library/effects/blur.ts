import type { EffectDef } from '../types';

/** One line of a separable Gaussian: 25 bilinear taps spread over ±r real pixels. */
const GAUSS_LINE = `
vec4 gaussLine(vec2 uv, vec2 dir, float r) {
  if (r < 0.25) return tex(uv);
  float sigma = r * 0.5;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float o = float(i) / 12.0 * r;
    float w = exp(-0.5 * (o * o) / (sigma * sigma));
    acc += tex(uv + dir * o) * w;
    wsum += w;
  }
  return acc / wsum;
}`;

const CENTER_PARAMS: EffectDef['params'] = [
  { key: 'centerX', label: 'Center X', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
  { key: 'centerY', label: 'Center Y', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
];

const effects: EffectDef[] = [
  {
    id: 'directional-blur',
    name: 'Directional Blur',
    category: 'blur',
    passes: 2,
    params: [
      { key: 'dist', label: 'Length', type: 'float', default: 60, min: 0, max: 400, step: 1, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float len = dist * u_px;
  if (len < 0.5) return tex(uv);
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a)) / u_res;
  // Pass 0 spreads 25 taps over the whole streak; pass 1 fills the gaps between those taps, so
  // long streaks stay perfectly smooth instead of breaking up into ghost copies.
  float span = u_pass == 0 ? len : len / 24.0;
  if (u_pass == 1 && span < 1.0) return tex(uv);
  vec4 acc = vec4(0.0);
  for (int i = -12; i <= 12; i++) {
    acc += tex(uv + dir * (float(i) / 24.0) * span);
  }
  return acc / 25.0;
}`,
  },
  {
    id: 'zoom-blur',
    name: 'Zoom Blur',
    category: 'blur',
    passes: 2,
    params: [{ key: 'amount', label: 'Amount', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 }, ...CENTER_PARAMS],
    glsl: `
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  vec2 c = vec2(centerX, centerY) * 0.01;
  vec2 d = uv - c;
  // Pass 0 samples along the ray towards the centre, pass 1 fills the gaps between its taps.
  float span = u_pass == 0 ? amount : amount / 24.0;
  float bias = u_pass == 0 ? 0.0 : 0.5;
  if (u_pass == 1 && length(d * u_res) * span < 1.0) return tex(uv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 25; i++) {
    float t = float(i) / 24.0 - bias;
    acc += tex(c + d * (1.0 - span * t));
  }
  return acc / 25.0;
}`,
  },
  {
    id: 'spin-blur',
    name: 'Spin Blur',
    category: 'blur',
    passes: 2,
    params: [{ key: 'angle', label: 'Angle', type: 'float', default: 12, min: 0, max: 180, step: 0.5, unit: '°' }, ...CENTER_PARAMS],
    glsl: `
vec4 effect(vec2 uv) {
  float a = radians(angle);
  if (a < 0.0005) return tex(uv);
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 c = vec2(centerX, centerY) * 0.01;
  vec2 d = (uv - c) * asp;
  // Pass 0 covers the whole arc, pass 1 fills the gaps between its taps.
  float span = u_pass == 0 ? a : a / 24.0;
  if (u_pass == 1 && length(d) * u_res.y * span < 1.0) return tex(uv);
  vec4 acc = vec4(0.0);
  for (int i = -12; i <= 12; i++) {
    vec2 r = rot2(span * float(i) / 24.0) * d;
    acc += tex(c + r / asp);
  }
  return acc / 25.0;
}`,
  },
  {
    id: 'box-blur',
    name: 'Box Blur',
    category: 'blur',
    passes: 4,
    params: [
      { key: 'radius', label: 'Radius', type: 'float', default: 20, min: 0, max: 200, step: 1, unit: 'px' },
      { key: 'horizontal', label: 'Horizontal', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
      { key: 'vertical', label: 'Vertical', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  bool horiz = u_pass < 2;
  bool coarse = u_pass == 0 || u_pass == 2;
  float r = radius * u_px * (horiz ? horizontal : vertical);
  if (r < 0.25) return tex(uv);
  // Each axis takes two passes: 25 taps across the box, then 25 taps across the gap between them.
  float span = coarse ? r : r / 24.0;
  if (!coarse && span < 0.5) return tex(uv);
  vec2 dir = (horiz ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  vec4 acc = vec4(0.0);
  for (int i = -12; i <= 12; i++) {
    acc += tex(uv + dir * (float(i) / 12.0) * span);
  }
  return acc / 25.0;
}`,
  },
  {
    id: 'lens-blur',
    name: 'Lens Blur',
    category: 'blur',
    passes: 3,
    params: [
      { key: 'radius', label: 'Radius', type: 'float', default: 18, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'boost', label: 'Bokeh highlights', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
const float GOLDEN = 2.39996323;
vec4 disc(vec2 uv, float r, int taps, float gain) {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= taps) break;
    float f = (float(i) + 0.5) / float(taps);
    float ang = float(i) * GOLDEN;
    vec4 s = tex(uv + vec2(cos(ang), sin(ang)) * sqrt(f) * r / u_res);
    // Bright samples weigh more, which lets highlights open up into soft bokeh discs.
    float l = luma(s.rgb);
    float w = 1.0 + gain * l * l * l * 12.0;
    acc += s * w;
    wsum += w;
  }
  return acc / wsum;
}
vec4 effect(vec2 uv) {
  float r = radius * u_px;
  if (r < 0.3) return tex(uv);
  // A 48-tap aperture disc, then two much smaller discs that hide its sampling pattern.
  if (u_pass == 0) return disc(uv, r, 48, boost);
  if (u_pass == 1) return r * 0.22 < 0.5 ? tex(uv) : disc(uv, r * 0.22, 32, 0.0);
  return r * 0.06 < 0.5 ? tex(uv) : disc(uv, r * 0.06, 12, 0.0);
}`,
  },
  {
    id: 'tilt-shift',
    name: 'Tilt-Shift',
    category: 'blur',
    passes: 2,
    params: [
      { key: 'radius', label: 'Blur', type: 'float', default: 22, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'focus', label: 'Focus position', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
      { key: 'band', label: 'Focus width', type: 'float', default: 22, min: 0, max: 100, step: 0.5, unit: '%' },
      { key: 'feather', label: 'Feather', type: 'float', default: 28, min: 1, max: 100, step: 0.5, unit: '%' },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: -90, max: 90, step: 1, unit: '°' },
    ],
    glsl: `${GAUSS_LINE}
float blurMask(vec2 uv) {
  vec2 p = (uv - vec2(0.5, focus * 0.01)) * vec2(u_aspect, 1.0);
  float a = radians(angle);
  float d = abs(dot(p, vec2(-sin(a), cos(a))));
  float inner = band * 0.005;
  return smoothstep(inner, inner + feather * 0.01, d);
}
vec4 effect(vec2 uv) {
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  return gaussLine(uv, dir, radius * u_px * blurMask(uv));
}`,
  },
  {
    id: 'iris-blur',
    name: 'Iris Blur',
    category: 'blur',
    passes: 2,
    params: [
      { key: 'radius', label: 'Blur', type: 'float', default: 22, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'size', label: 'Focus size', type: 'float', default: 45, min: 0, max: 150, step: 0.5, unit: '%' },
      { key: 'feather', label: 'Feather', type: 'float', default: 35, min: 1, max: 100, step: 0.5, unit: '%' },
      ...CENTER_PARAMS,
    ],
    glsl: `${GAUSS_LINE}
float blurMask(vec2 uv) {
  vec2 p = (uv - vec2(centerX, centerY) * 0.01) * vec2(u_aspect, 1.0);
  float inner = size * 0.005;
  return smoothstep(inner, inner + feather * 0.01, length(p));
}
vec4 effect(vec2 uv) {
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  return gaussLine(uv, dir, radius * u_px * blurMask(uv));
}`,
  },
  {
    id: 'surface-blur',
    name: 'Surface Blur',
    category: 'blur',
    passes: 2,
    params: [
      { key: 'radius', label: 'Radius', type: 'float', default: 12, min: 0, max: 40, step: 0.5, unit: 'px' },
      { key: 'threshold', label: 'Edge threshold', type: 'float', default: 0.18, min: 0.02, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float r = radius * u_px;
  if (r < 0.3) return tex(uv);
  // Edge-preserving (bilateral) smoothing: neighbours count less the more their colour differs.
  // The second pass uses a rotated, tighter grid so no sampling pattern survives.
  mat2 m = u_pass == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : rot2(0.7853982) * 0.7;
  float inv = 1.0 / max(threshold * threshold, 0.0004);
  vec4 c0 = tex(uv);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 o = vec2(float(x), float(y)) / 3.0;
      vec4 s = tex(uv + (m * o) * r / u_res);
      vec4 d = s - c0;
      float w = exp(-dot(o, o) * 1.6 - dot(d, d) * inv);
      acc += s * w;
      wsum += w;
    }
  }
  return acc / wsum;
}`,
  },
  {
    id: 'frosted-glass',
    name: 'Frosted Glass',
    category: 'blur',
    params: [
      { key: 'amount', label: 'Scatter', type: 'float', default: 16, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'grain', label: 'Grain size', type: 'float', default: 4, min: 1, max: 40, step: 0.5, unit: 'px' },
      { key: 'frost', label: 'Frost', type: 'float', default: 0.12, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amt = amount * u_px;
  if (amt < 0.01) return tex(uv);
  // The glass texture lives in design pixels, so it looks the same at every render size.
  vec2 p = uv * u_res / (u_px * max(grain, 0.5));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 q = p + float(i) * vec2(37.7, 19.3);
    vec2 n = vec2(vnoise(q), vnoise(q + 71.9)) + 0.5 * vec2(vnoise(q * 2.7 + 13.1), vnoise(q * 2.7 + 5.3)) - 0.75;
    acc += tex(uv + n * (amt / 0.75) / u_res);
  }
  vec4 c = acc * 0.25;
  // The milky veil fades in with the scatter so the effect is a clean identity at 0.
  c.rgb = mix(c.rgb, vec3(c.a), frost * 0.6 * clamp(amount / 6.0, 0.0, 1.0));
  return c;
}`,
  },
];

export default effects;
