import type { EffectDef } from '../types';

/** Core effects the app relies on by id. Do not rename or remove. */
const effects: EffectDef[] = [
  {
    id: 'gaussian-blur',
    name: 'Gaussian Blur',
    category: 'blur',
    passes: 2,
    params: [{ key: 'radius', label: 'Radius', type: 'float', default: 24, min: 0, max: 200, step: 1, unit: 'px' }],
    glsl: `
vec4 effect(vec2 uv) {
  float r = radius * u_px;
  if (r < 0.25) return tex(uv);
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  // 25 bilinear taps spread over ±r keep the cost constant for any radius.
  float sigma = max(r * 0.5, 0.001);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float o = float(i) / 12.0 * r;
    float w = exp(-0.5 * (o * o) / (sigma * sigma));
    acc += tex(uv + dir * o) * w;
    wsum += w;
  }
  return acc / wsum;
}`,
  },
  {
    id: 'glow',
    name: 'Glow',
    category: 'light',
    passes: 3,
    params: [
      { key: 'radius', label: 'Radius', type: 'float', default: 30, min: 1, max: 160, step: 1, unit: 'px' },
      { key: 'amount', label: 'Intensity', type: 'float', default: 0.8, min: 0, max: 2, step: 0.01 },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 bright(vec2 uv) {
  vec4 c = tex(uv);
  float l = luma(c.rgb);
  return c * smoothstep(threshold - 0.1, threshold + 0.1, l);
}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    // Screen the blurred highlights over the original picture.
    vec4 base = orig(uv);
    vec4 halo = tex(uv) * amount;
    vec3 rgb = base.rgb + halo.rgb * (1.0 - base.rgb);
    float a = max(base.a, min(1.0, halo.a));
    return vec4(rgb, a);
  }
  float r = radius * u_px;
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  float sigma = max(r * 0.5, 0.001);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float o = float(i) / 10.0 * r;
    float w = exp(-0.5 * (o * o) / (sigma * sigma));
    acc += (u_pass == 0 ? bright(uv + dir * o) : tex(uv + dir * o)) * w;
    wsum += w;
  }
  return acc / wsum;
}`,
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    category: 'stylize',
    params: [{ key: 'size', label: 'Block size', type: 'float', default: 24, min: 1, max: 200, step: 1, unit: 'px' }],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 cell = vec2(max(size * u_px, 1.0)) / u_res;
  vec2 q = (floor(uv / cell) + 0.5) * cell;
  return tex(q);
}`,
  },
  {
    id: 'rgb-split',
    name: 'RGB Split',
    category: 'glitch',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 12, min: 0, max: 120, step: 0.5, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float a = radians(angle);
  vec2 off = vec2(cos(a), sin(a)) * amount * u_px / u_res;
  vec4 r = tex(uv + off);
  vec4 g = tex(uv);
  vec4 b = tex(uv - off);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  },
];

export default effects;
