import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });

/**
 * frameUv: centred coordinates in which the shorter side of the frame spans -0.5..0.5, so a layout
 * keeps its proportions on 16:9, 9:16 and 1:1. dither hides banding in smooth ramps.
 */
const GEN_LIB = `
vec2 frameUv(vec2 uv) {
  return (uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec3 dither(vec3 c, vec2 uv) {
  return c + (hash21(uv * u_res) - 0.5) / 255.0;
}`;

const generators: GeneratorDef[] = [
  {
    id: 'mesh-gradient',
    name: 'Mesh Gradient',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#6d5dfc' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#22c1dc' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#ff5c9d' },
      { key: 'colorD', label: 'Color D', type: 'color', default: '#ffb86b' },
      { key: 'warp', label: 'Warp', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = 0.5 * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
  float t = u_time * speed * 0.12;
  vec2 w = vec2(fbm(p * 0.8 + vec2(t * 0.9, 3.0)), fbm(p * 0.8 + vec2(11.0, -t * 0.8))) - 0.5;
  p += w * 0.5 * warp;
  // Four colour points wander around their home corners.
  vec2 a = vec2(-0.62, -0.58) * ext + 0.24 * vec2(sin(t * 1.3), cos(t * 1.1 + 0.4));
  vec2 b = vec2(0.66, -0.5) * ext + 0.24 * vec2(cos(t * 0.9 + 1.0), sin(t * 1.2 + 2.0));
  vec2 c = vec2(-0.56, 0.62) * ext + 0.24 * vec2(sin(t * 1.1 + 3.0), cos(t * 0.8 + 1.5));
  vec2 d = vec2(0.6, 0.6) * ext + 0.24 * vec2(cos(t * 1.4 + 2.2), sin(t * 1.0 + 0.7));
  // Inverse-distance weights give the soft, blurred-mesh look; mixing squared colours keeps blends bright.
  float wa = pow(dot(p - a, p - a) + 0.02, -1.4);
  float wb = pow(dot(p - b, p - b) + 0.02, -1.4);
  float wc = pow(dot(p - c, p - c) + 0.02, -1.4);
  float wd = pow(dot(p - d, p - d) + 0.02, -1.4);
  vec3 col = (colorA * colorA * wa + colorB * colorB * wb + colorC * colorC * wc + colorD * colorD * wd) / (wa + wb + wc + wd);
  return vec4(dither(sqrt(col), uv), 1.0);
}`,
  },
  {
    id: 'radial-glow',
    name: 'Radial Glow',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Center', type: 'color', default: '#ff8a5c' },
      { key: 'colorB', label: 'Edge', type: 'color', default: '#2a1650' },
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 0.65, min: 0.1, max: 2, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  // The glow drifts a little and breathes.
  vec2 c = frameUv(vec2(centerX, centerY)) + 0.035 * vec2(sin(t * 0.43), cos(t * 0.37));
  float rad = max(radius, 0.05) * (1.0 + 0.06 * sin(t * 0.9));
  float r = length(p - c) / rad;
  float f = mix(exp(-r * r * 1.6), 1.0 - smoothstep(0.0, 1.5, r), 0.3);
  vec3 col = sqrt(mix(colorB * colorB, colorA * colorA, f));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'conic-sweep',
    name: 'Conic Sweep',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#5b4bff' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#19c9c2' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#ff5aa0' },
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'twist', label: 'Twist', type: 'float', default: 0.2, min: -1, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) - frameUv(vec2(centerX, centerY));
  float r = length(p);
  float a = atan(p.y, p.x) / TAU + fract(u_time * speed * 0.04) + twist * r;
  // Three cosine lobes 120 degrees apart: periodic, so the sweep has no seam.
  vec3 w = 0.5 + 0.5 * cos(TAU * (a - vec3(0.0, 1.0, 2.0) / 3.0));
  w *= w;
  vec3 col = (colorA * colorA * w.x + colorB * colorB * w.y + colorC * colorC * w.z) / (w.x + w.y + w.z);
  vec3 mid = (colorA * colorA + colorB * colorB + colorC * colorC) / 3.0;
  // Melt the pole into the average colour instead of pinching to a point.
  col = mix(mid, col, smoothstep(0.0, 0.16, r));
  return vec4(dither(sqrt(col), uv), 1.0);
}`,
  },
  {
    id: 'gradient-flow',
    name: 'Gradient Flow',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#1b1464' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#c2348b' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#ffb65c' },
      { key: 'angle', label: 'Angle', type: 'float', default: 35, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'flow', label: 'Flow', type: 'float', default: 0.7, min: 0, max: 2, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed * 0.1;
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 ext = vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
  // The colour ramp is bent by a slow two-layer current.
  vec2 w = vec2(fbm(p * 0.9 + vec2(t, 1.7)), fbm(p * 0.9 + vec2(6.3, -t * 0.8))) - 0.5;
  vec2 q = p + w * 0.6 * flow;
  q += 0.08 * flow * vec2(sin(q.y * 2.3 + t * 2.1), cos(q.x * 1.9 - t * 1.7));
  float v = dot(q, dir) / (abs(dir.x) * ext.x + abs(dir.y) * ext.y) + 0.5;
  vec3 col = mix(colorA * colorA, colorB * colorB, smoothstep(0.0, 0.55, v));
  col = mix(col, colorC * colorC, smoothstep(0.45, 1.0, v));
  return vec4(dither(sqrt(col), uv), 1.0);
}`,
  },
  {
    id: 'horizon-glow',
    name: 'Horizon Glow',
    category: 'gradient',
    params: [
      { key: 'colorA', label: 'Sky', type: 'color', default: '#0c1030' },
      { key: 'colorB', label: 'Glow', type: 'color', default: '#ff7a59' },
      { key: 'colorC', label: 'Ground', type: 'color', default: '#07060f' },
      { key: 'horizon', label: 'Horizon', type: 'float', default: 0.66, min: 0.1, max: 0.95, step: 0.01 },
      { key: 'glow', label: 'Glow Size', type: 'float', default: 1, min: 0.2, max: 3, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float hy = frameUv(vec2(0.5, horizon)).y;
  float t = u_time * speed;
  float d = p.y - hy;
  float g = max(glow, 0.05) * (1.0 + 0.07 * sin(t * 0.6));
  // The glow shimmers gently along the horizon line.
  float shimmer = 0.82 + 0.3 * fbm(vec2(p.x * 1.4 + t * 0.04, t * 0.06));
  float up = exp(min(d, 0.0) / (0.3 * g));
  float down = exp(-max(d, 0.0) / (0.09 * g));
  vec3 sky = mix(colorA * colorA, colorB * colorB, clamp(up * up * shimmer, 0.0, 1.0));
  vec3 ground = mix(colorC * colorC, colorB * colorB, clamp(down * shimmer, 0.0, 1.0));
  vec3 col = d < 0.0 ? sky : ground;
  // A wide bloom where the light source sits just below the horizon.
  vec2 b = vec2(p.x * 0.55, d * 1.6) / g;
  col += colorB * colorB * 0.35 * exp(-dot(b, b) * 9.0);
  col += vec3(1.0, 0.92, 0.8) * 0.18 * exp(-dot(b, b) * 60.0);
  return vec4(dither(sqrt(min(col, 1.0)), uv), 1.0);
}`,
  },
];

export default generators;
