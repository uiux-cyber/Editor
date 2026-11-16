import type { TransitionDef } from '../types';

/** Dissolve family: every item is a per-pixel blend of the two pictures (no geometry). */
const transitions: TransitionDef[] = [
  {
    id: 'additive-dissolve',
    name: 'Additive Dissolve',
    category: 'basic',
    duration: 0.8,
    params: [{ key: 'amount', label: 'Glow', type: 'float', default: 0.65, min: 0, max: 1, step: 0.01 }],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  // Both pictures stay at full strength around the middle, so highlights add up and bloom.
  float wa = mix(1.0 - progress, clamp(2.0 - 2.0 * progress, 0.0, 1.0), amount);
  float wb = mix(progress, clamp(2.0 * progress, 0.0, 1.0), amount);
  wa = wa * wa * (3.0 - 2.0 * wa);
  wb = wb * wb * (3.0 - 2.0 * wb);
  vec4 c = a * wa + b * wb;
  c.a = min(c.a, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  return c;
}`,
  },
  {
    id: 'film-dissolve',
    name: 'Film Dissolve',
    category: 'basic',
    duration: 1.0,
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  // Blend in linear light with an eased ramp: highlights carry through like an optical dissolve.
  float p = progress * progress * (3.0 - 2.0 * progress);
  vec3 la = pow(max(a.rgb, 0.0), vec3(2.2));
  vec3 lb = pow(max(b.rgb, 0.0), vec3(2.2));
  vec3 c = pow(mix(la, lb, p), vec3(1.0 / 2.2));
  return vec4(c, mix(a.a, b.a, p));
}`,
  },
  {
    id: 'luma-fade',
    name: 'Luma Fade',
    category: 'basic',
    duration: 0.9,
    params: [
      {
        key: 'order',
        label: 'Order',
        type: 'select',
        default: 0,
        options: [
          { label: 'Shadows First', value: 0 },
          { label: 'Highlights First', value: 1 },
        ],
      },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.18, min: 0.02, max: 0.5, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  float l = clamp(luma(a.rgb), 0.0, 1.0);
  if (order > 0.5) l = 1.0 - l;
  float s = max(softness, 0.02);
  float edge = mix(-s, 1.0 + s, progress);
  float keep = smoothstep(edge - s, edge + s, l);
  return mix(b, a, keep);
}`,
  },
  {
    id: 'mono-dissolve',
    name: 'Mono Dissolve',
    category: 'basic',
    duration: 1.0,
    params: [
      { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff' },
      { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  vec4 c = mix(a, b, smoothstep(0.25, 0.75, progress));
  // Drain the colour towards the middle, then let it flow back.
  float k = smoothstep(0.0, 0.4, progress) * (1.0 - smoothstep(0.6, 1.0, progress));
  vec3 mono = luma(c.rgb) * tint;
  c.rgb = mix(c.rgb, mono, k * amount);
  return c;
}`,
  },
  {
    id: 'tonal-dissolve',
    name: 'Tonal Dissolve',
    category: 'basic',
    duration: 0.9,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Lighten', value: 0 },
          { label: 'Darken', value: 1 },
        ],
      },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  float wa = 1.0 - smoothstep(0.5, 1.0, progress);
  float wb = smoothstep(0.0, 0.5, progress);
  float alpha = mix(a.a, b.a, progress);
  // Lighten: the brighter picture wins, so the incoming highlights arrive first.
  // Darken: the darker picture wins, so the incoming shadows arrive first.
  vec3 c = mode < 0.5
    ? max(a.rgb * wa, b.rgb * wb)
    : min(mix(vec3(1.0), a.rgb, wa), mix(vec3(1.0), b.rgb, wb));
  return vec4(min(c, vec3(alpha)), alpha);
}`,
  },
  {
    id: 'grain-dissolve',
    name: 'Grain Dissolve',
    category: 'basic',
    duration: 0.9,
    params: [
      { key: 'grain', label: 'Grain Size', type: 'float', default: 3, min: 1, max: 24, step: 0.5, unit: 'px' },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.12, min: 0.02, max: 0.5, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  // Grain is sized against a 1080-line frame so previews and exports match.
  vec2 g = vec2(uv.x * ratio, uv.y) * 1080.0 / max(grain, 1.0);
  float n = vnoise(g) * 0.6 + vnoise(g * 2.13 + 31.7) * 0.4;
  n = smoothstep(0.18, 0.82, n);
  float s = max(softness, 0.02);
  float edge = mix(-s, 1.0 + s, progress);
  float keep = smoothstep(edge - s, edge + s, n);
  return mix(getToColor(uv), getFromColor(uv), keep);
}`,
  },
];

export default transitions;
