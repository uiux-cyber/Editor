import type { GeneratorDef } from '../types';

/** Core generators the app relies on by id. Do not rename or remove. */
const generators: GeneratorDef[] = [
  {
    id: 'solid',
    name: 'Solid Color',
    category: 'gradient',
    params: [{ key: 'colorA', label: 'Color', type: 'color', default: '#1b1e27' }],
    glsl: `
vec4 generate(vec2 uv) {
  return vec4(colorA, 1.0);
}`,
  },
  {
    id: 'linear-gradient',
    name: 'Linear Gradient',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#7c5cff' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#22d3ee' },
      { key: 'angle', label: 'Angle', type: 'float', default: 45, min: 0, max: 360, step: 1, unit: '°' },
    ],
    glsl: `
vec4 generate(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  float t = dot(uv - 0.5, dir) / (abs(dir.x) + abs(dir.y)) + 0.5;
  vec3 c = mix(colorA, colorB, smoothstep(0.0, 1.0, t));
  // Dither to hide banding in smooth gradients.
  c += (hash21(uv * u_res) - 0.5) / 255.0;
  return vec4(c, 1.0);
}`,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#7c5cff' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#22d3ee' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#ff4d8d' },
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0b0c14' },
      { key: 'speed', label: 'Speed', type: 'float', default: 1, min: 0, max: 4, step: 0.05 },
    ],
    glsl: `
float blob(vec2 p, vec2 c, float r) {
  float d = length(p - c);
  return exp(-(d * d) / (r * r));
}
vec4 generate(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);
  float t = u_time * speed * 0.25;
  vec2 warp = vec2(fbm(p * 1.3 + t * 0.6), fbm(p * 1.3 - t * 0.5 + 7.0)) - 0.5;
  p += warp * 0.35;
  vec2 a = vec2(sin(t * 1.1) * 0.55, cos(t * 0.9) * 0.30);
  vec2 b = vec2(cos(t * 0.7 + 2.0) * 0.60, sin(t * 1.3 + 1.0) * 0.32);
  vec2 c = vec2(sin(t * 0.5 + 4.0) * 0.45, cos(t * 0.6 + 3.0) * 0.36);
  vec3 col = colorBg;
  col = mix(col, colorA, blob(p, a, 0.55) * 0.9);
  col = mix(col, colorB, blob(p, b, 0.50) * 0.8);
  col = mix(col, colorC, blob(p, c, 0.45) * 0.7);
  col += (hash21(uv * u_res + fract(u_time)) - 0.5) / 255.0;
  return vec4(col, 1.0);
}`,
  },
];

export default generators;
