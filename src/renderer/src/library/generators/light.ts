import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });
const intensity = (def = 1): ParamDef => ({ key: 'intensity', label: 'Intensity', type: 'float', default: def, min: 0, max: 2, step: 0.01 });

const GEN_LIB = `
vec2 frameUv(vec2 uv) {
  return (uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec2 frameExt() {
  return 0.5 * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec3 dither(vec3 c, vec2 uv) {
  return c + (hash21(uv * u_res) - 0.5) / 255.0;
}
vec3 screenAdd(vec3 base, vec3 light) {
  return 1.0 - (1.0 - base) * (1.0 - clamp(light, 0.0, 1.0));
}`;

const generators: GeneratorDef[] = [
  {
    id: 'spotlight',
    name: 'Spotlight',
    category: 'light',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0a0a12' },
      { key: 'colorA', label: 'Light', type: 'color', default: '#ffe7c4' },
      { key: 'posX', label: 'Position X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'posY', label: 'Position Y', type: 'float', default: 0.52, min: 0, max: 1, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 0.34, min: 0.05, max: 1, step: 0.01 },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.45, min: 0.02, max: 1, step: 0.01 },
      { key: 'haze', label: 'Beam Haze', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed;
  // The lamp sways a little, as if hand-operated.
  vec2 c = frameUv(vec2(posX, posY)) + 0.06 * vec2(sin(t * 0.5), 0.5 * cos(t * 0.37));
  float rad = max(radius, 0.02);
  vec2 d = (p - c) * vec2(1.0, 1.12);
  float r = length(d) / rad;
  float pool = 1.0 - smoothstep(1.0 - softness, 1.0 + 0.6 * softness, r);
  float hot = exp(-r * r * 1.6);
  float spill = exp(-r * 0.9) * 0.16;
  // Haze in the cone between the lamp (above the frame) and the pool.
  vec2 src = vec2(c.x * 0.25, -ext.y - 0.45);
  vec2 axis = c - src;
  float along = clamp(dot(p - src, axis) / dot(axis, axis), 0.0, 1.0);
  float across = length(p - src - axis * along) / (rad * along + 0.02);
  float cone = exp(-across * across * 1.3) * along * 0.3 * haze;
  vec3 col = colorBg * (1.0 - 0.4 * dot(uv - 0.5, uv - 0.5));
  // The pool keeps a visible gradient (it never burns out to a flat disc).
  col = mix(col, colorA, clamp(pool * (0.42 + 0.5 * hot), 0.0, 1.0));
  col = screenAdd(col, colorA * (spill + cone));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'studio-backdrop',
    name: 'Studio Backdrop',
    category: 'light',
    params: [
      { key: 'colorA', label: 'Backdrop', type: 'color', default: '#d9dee8' },
      { key: 'colorB', label: 'Shadow', type: 'color', default: '#6f7a91' },
      { key: 'lightX', label: 'Light X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'lightY', label: 'Light Y', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'spread', label: 'Light Spread', type: 'float', default: 0.75, min: 0.2, max: 2, step: 0.01 },
      { key: 'floorLine', label: 'Floor Line', type: 'float', default: 0.74, min: 0.3, max: 1.2, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  // A broad key light on a seamless paper backdrop; it breathes almost imperceptibly.
  vec2 lc = frameUv(vec2(lightX, lightY)) + 0.02 * vec2(sin(t * 0.31), cos(t * 0.27));
  vec2 d = (p - lc) * vec2(0.8, 1.0);
  float sp = max(spread, 0.05);
  float key = exp(-dot(d, d) / (0.5 * sp * sp)) * (1.0 + 0.03 * sin(t * 0.8));
  vec3 col = mix(colorB, colorA, clamp(0.18 + 0.82 * key, 0.0, 1.0));
  // The cove where the wall sweeps into the floor: a faint highlight, then the floor falls off.
  float fy = frameUv(vec2(0.5, floorLine)).y;
  float y = p.y - fy;
  col *= 1.0 + 0.05 * exp(-y * y * 220.0);
  col *= 1.0 - 0.22 * smoothstep(0.0, 0.45, y);
  col *= 1.0 - 0.3 * smoothstep(0.25, 1.3, length(uv - 0.5) * 2.0);
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'light-leaks',
    name: 'Light Leaks',
    category: 'light',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0b0607' },
      { key: 'colorA', label: 'Color A', type: 'color', default: '#ff8a3c' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#ff3d6e' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#ffd27a' },
      { key: 'size', label: 'Size', type: 'float', default: 1, min: 0.4, max: 2.5, step: 0.01 },
      intensity(1),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed * 0.25;
  vec3 light = vec3(0.0);
  // Four stretched, breathing blooms wander around the frame like light creeping into a camera body.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(fi * 3.7 + 1.0, fi * 9.1 + 4.0));
    vec2 c = vec2(sin(t * (0.5 + 0.4 * h.x) + TAU * h.y), cos(t * (0.35 + 0.4 * h.y) + TAU * h.x)) * ext * vec2(1.05, 0.9);
    vec2 d = rot2(0.5 + 0.9 * sin(t * 0.2 + fi * 2.1)) * (p - c);
    d *= vec2(0.55, 1.5) / max(size, 0.05);
    float wob = fbm(p * 1.1 + vec2(fi * 7.0, t * 0.6));
    float g = exp(-dot(d, d) * (2.0 + 2.2 * wob));
    float breath = 0.6 + 0.4 * sin(t * (0.9 + 0.6 * h.x) + fi * 1.3);
    vec3 lc = i == 0 ? colorA : i == 1 ? colorB : i == 2 ? colorC : mix(colorA, colorB, 0.5);
    light += lc * g * breath;
  }
  light *= intensity;
  vec3 col = screenAdd(colorBg, light);
  // The densest overlap burns out towards white.
  col = screenAdd(col, vec3(1.0, 0.96, 0.88) * pow(clamp(luma(light), 0.0, 1.0), 3.0) * 0.35);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'god-rays',
    name: 'God Rays',
    category: 'light',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0c1326' },
      { key: 'colorA', label: 'Rays', type: 'color', default: '#ffe1a8' },
      { key: 'sourceX', label: 'Source X', type: 'float', default: 0.18, min: -0.5, max: 1.5, step: 0.01 },
      { key: 'sourceY', label: 'Source Y', type: 'float', default: -0.08, min: -0.5, max: 1.5, step: 0.01 },
      { key: 'reach', label: 'Reach', type: 'float', default: 1, min: 0.2, max: 3, step: 0.01 },
      intensity(1),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 d = p - frameUv(vec2(sourceX, sourceY));
  float r = length(d);
  float a = atan(d.y, d.x);
  float t = u_time * speed;
  // Pixels per radian at this distance: fine shafts fade out before they could alias near the source.
  float ppr = r * min(u_res.x, u_res.y);
  float k2 = 1.0 - smoothstep(0.15, 0.4, 23.0 / (TAU * max(ppr, 1.0)));
  float k3 = 1.0 - smoothstep(0.15, 0.4, 41.0 / (TAU * max(ppr, 1.0)));
  // Three sine combs with whole-number frequencies: periodic in angle, so there is no seam.
  float s1 = 0.5 + 0.5 * sin(a * 9.0 + t * 0.21 + 1.0);
  float s2 = mix(0.5, 0.5 + 0.5 * sin(a * 23.0 - t * 0.13 + 4.0), k2);
  float s3 = mix(0.5, 0.5 + 0.5 * sin(a * 41.0 + t * 0.34), k3);
  float shafts = pow((0.2 + 0.8 * s1) * (0.45 + 0.55 * s2) * (0.7 + 0.3 * s3), 1.3);
  float fall = exp(-r * 1.25 / max(reach, 0.05));
  float dust = 0.8 + 0.4 * fbm(p * 2.6 + vec2(t * 0.03, -t * 0.02));
  float core = exp(-r * r * 22.0);
  vec3 col = colorBg * (1.0 - 0.35 * dot(uv - 0.5, uv - 0.5));
  col = screenAdd(col, colorA * (shafts * fall * dust * 0.85 + fall * 0.12 + core) * intensity);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'light-curtain',
    name: 'Light Curtain',
    category: 'light',
    params: [
      { key: 'colorBg', label: 'Sky', type: 'color', default: '#050a1c' },
      { key: 'colorA', label: 'Lower Glow', type: 'color', default: '#3dffb0' },
      { key: 'colorB', label: 'Upper Glow', type: 'color', default: '#8a5cff' },
      { key: 'height', label: 'Height', type: 'float', default: 1, min: 0.3, max: 3, step: 0.01 },
      intensity(1),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  vec3 col = mix(colorBg * 0.6, colorBg * 1.3, smoothstep(0.0, 1.0, uv.y));
  vec3 light = vec3(0.0);
  float hgt = max(height, 0.05);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x * (1.2 + 0.35 * fi) + fi * 5.0;
    // The hem of each curtain is a slow wavy line; light rises from it and fades out.
    float hem = 0.2 - 0.13 * fi + 0.1 * sin(x * 1.3 + t * 0.21 + fi) + 0.05 * sin(x * 2.9 - t * 0.17);
    float h = hem - p.y;
    float rays = vnoise(vec2(x * 9.0 + 0.6 * sin(t * 0.3 + fi), t * 0.25 + fi * 3.0)) * 0.6 + vnoise(vec2(x * 23.0 - t * 0.15, t * 0.4 + 9.0)) * 0.4;
    float fold = 0.5 + 0.5 * sin(x * 2.2 + 1.5 * sin(x * 0.7 + t * 0.15) + t * 0.1);
    float body = smoothstep(0.0, 0.035, h) * exp(-max(h, 0.0) * (2.6 + 1.5 * fi) / hgt);
    float amt = body * (0.3 + 0.7 * rays) * (0.35 + 0.65 * fold);
    vec3 cc = mix(colorA, colorB, clamp(h * 1.7 / hgt + 0.15 * fi, 0.0, 1.0));
    light += cc * amt * (1.0 - 0.25 * fi);
  }
  col = screenAdd(col, light * intensity);
  return vec4(dither(col, uv), 1.0);
}`,
  },
];

export default generators;
