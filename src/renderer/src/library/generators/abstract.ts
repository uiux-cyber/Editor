import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });
const scale = (def = 1): ParamDef => ({ key: 'scale', label: 'Scale', type: 'float', default: def, min: 0.3, max: 4, step: 0.05 });

/** frameUv: centred coordinates, shorter side spans -0.5..0.5. frameExt: half-size of the frame in those units. */
const GEN_LIB = `
vec2 frameUv(vec2 uv) {
  return (uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec2 frameExt() {
  return 0.5 * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec3 dither(vec3 c, vec2 uv) {
  return c + (hash21(uv * u_res) - 0.5) / 255.0;
}`;

/** Value noise that repeats every `per` cells, so a scroll offset can be wrapped with mod() and stays precise for hours. */
const PERIODIC_NOISE = `
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, per);
  vec2 i1 = mod(i + 1.0, per);
  float a = hash21(i0);
  float b = hash21(vec2(i1.x, i0.y));
  float c = hash21(vec2(i0.x, i1.y));
  float d = hash21(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pfbm(vec2 p, vec2 per) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * pnoise(p, per);
    p *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return sum / 0.9375;
}`;

const generators: GeneratorDef[] = [
  {
    id: 'soft-waves',
    name: 'Soft Waves',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Back Wave', type: 'color', default: '#3a2fb0' },
      { key: 'colorB', label: 'Front Wave', type: 'color', default: '#19b8c9' },
      { key: 'colorBg', label: 'Background', type: 'color', default: '#141033' },
      { key: 'amplitude', label: 'Amplitude', type: 'float', default: 1, min: 0, max: 3, step: 0.05 },
      speed(),
    ],
    glsl: `${GEN_LIB}
float waveY(float x, float i, float t) {
  return 0.055 * sin(x * (2.6 + 0.9 * i) + t * (0.5 + 0.13 * i) + i * 1.7)
       + 0.03 * sin(x * (6.4 + 1.7 * i) - t * (0.35 + 0.09 * i) + i * 4.1);
}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed;
  vec3 col = mix(colorBg, colorBg * 0.7, uv.y);
  const int N = 5;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float k = fi / float(N - 1);
    float y = mix(-0.2, 0.72, k) * ext.y + waveY(p.x, fi, t) * amplitude;
    // d > 0 inside the wave body.
    float d = p.y - y;
    float aa = max(fwidth(d), 1e-5);
    float m = smoothstep(-aa, aa, d);
    vec3 wc = mix(colorA, colorB, k);
    // Bright crest, deeper body, and a soft shadow thrown on the layer behind.
    wc *= 0.86 + 0.26 * exp(-max(d, 0.0) / 0.07);
    col *= 1.0 - 0.22 * exp(-max(-d, 0.0) / 0.035) * (1.0 - m);
    col = mix(col, wc, m);
  }
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'liquid-marble',
    name: 'Liquid Marble',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#101425' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#3d5a80' },
      { key: 'colorC', label: 'Veins', type: 'color', default: '#f2e9dc' },
      scale(1),
      { key: 'veins', label: 'Vein Strength', type: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) * 1.1 * scale;
  float t = u_time * speed * 0.08;
  // The warp fields circle slowly instead of scrolling, so the pattern evolves in place.
  vec2 drift = 0.7 * vec2(sin(t * 0.7), cos(t * 0.9));
  vec2 w1 = vec2(fbm(p + drift), fbm(p + vec2(5.2, 1.3) - drift));
  vec2 swirl = 0.6 * vec2(cos(t * 1.3), sin(t * 1.1));
  vec2 w2 = vec2(fbm(p + 2.6 * w1 + vec2(1.7, 9.2) + swirl), fbm(p + 2.6 * w1 + vec2(8.3, 2.8) - swirl));
  float f = fbm(p + 2.6 * w2);
  vec3 col = mix(colorA, colorB, smoothstep(0.25, 0.75, f));
  col *= 0.82 + 0.36 * w2.x;
  // Veins follow the level lines of the warp field: thin, continuous and slightly uneven.
  float vein = pow(1.0 - abs(2.0 * w2.y - 1.0), 16.0);
  float fine = pow(1.0 - abs(2.0 * f - 1.0), 28.0) * 0.35;
  col = mix(col, colorC, clamp((vein + fine) * veins, 0.0, 1.0));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'plasma',
    name: 'Plasma',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#2b1a6b' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#e0468f' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#27c4d9' },
      scale(1),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) * scale;
  float t = u_time * speed * 0.5;
  vec2 c = 0.6 * vec2(sin(t * 0.37), cos(t * 0.29));
  float v = sin(p.x * 2.3 + t) + sin(p.y * 1.9 - t * 0.8 + 1.3) + sin((p.x + p.y) * 1.6 + t * 0.6) + sin(length(p - c) * 3.4 - t * 1.1);
  float a = v * 0.2;
  vec3 w = 0.5 + 0.5 * cos(TAU * (a - vec3(0.0, 1.0, 2.0) / 3.0));
  w = w * w * w;
  vec3 col = (colorA * colorA * w.x + colorB * colorB * w.y + colorC * colorC * w.z) / (w.x + w.y + w.z);
  return vec4(dither(sqrt(col), uv), 1.0);
}`,
  },
  {
    id: 'flowing-silk',
    name: 'Flowing Silk',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Shadow', type: 'color', default: '#3b0d3f' },
      { key: 'colorB', label: 'Fabric', type: 'color', default: '#c2255c' },
      { key: 'colorC', label: 'Sheen', type: 'color', default: '#ffd9c7' },
      scale(1),
      { key: 'sheen', label: 'Sheen', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
// Height of the cloth: q.x runs across the folds, q.y along them, so the ridges stay long and parallel.
float silkH(vec2 q, float t) {
  float a = q.x * 5.0 + 1.6 * sin(q.y * 1.1 + t * 0.5) + 0.8 * sin(q.y * 2.3 - t * 0.35 + q.x * 0.7);
  float b = q.x * 8.5 + 1.2 * sin(q.y * 1.7 - t * 0.4 + 2.0) + 3.0;
  float c = q.x * 2.2 + 2.0 * sin(q.y * 0.6 + t * 0.25);
  return 0.5 * sin(a) + 0.2 * sin(b + 0.6 * sin(a)) + 0.45 * sin(c);
}
vec4 generate(vec2 uv) {
  vec2 q = rot2(-0.6) * frameUv(uv) * scale;
  float t = u_time * speed * 0.6;
  // Shade the folds from the slope of the height field: soft diffuse plus a broad satin highlight.
  const float e = 0.004;
  float h = silkH(q, t);
  vec2 g = vec2(silkH(q + vec2(e, 0.0), t) - h, silkH(q + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-g * 0.16, 1.0));
  vec3 l = normalize(vec3(-0.5, -0.35, 0.8));
  float diff = dot(n, l);
  float spec = pow(max(reflect(-l, n).z, 0.0), 7.0);
  vec3 col = mix(colorA, colorB, smoothstep(0.25, 0.95, diff));
  col = mix(col, colorC, clamp(spec * spec * sheen, 0.0, 1.0) * 0.8);
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'clouds',
    name: 'Clouds',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Sky Top', type: 'color', default: '#2f6fd6' },
      { key: 'colorB', label: 'Sky Bottom', type: 'color', default: '#a8d8ff' },
      { key: 'colorC', label: 'Clouds', type: 'color', default: '#ffffff' },
      { key: 'cover', label: 'Coverage', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      scale(1),
      speed(),
    ],
    glsl: `${GEN_LIB}${PERIODIC_NOISE}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  vec3 sky = mix(colorA, colorB, smoothstep(0.0, 1.0, uv.y));
  vec3 col = sky;
  vec2 per = vec2(256.0);
  float thr = mix(0.72, 0.3, cover);
  for (int i = 0; i < 2; i++) {
    float fl = float(i);
    vec2 q = p * mix(1.5, 2.3, fl) * scale + vec2(0.0, fl * 37.0);
    // Two fields drifting at different rates make the shapes evolve as they travel.
    float o1 = mod(t * 0.022 * (1.0 + fl * 0.8), 256.0);
    float o2 = mod(t * 0.037 * (1.0 + fl * 0.8), 256.0);
    float n = pfbm(q + vec2(o1, 0.0), per) * 0.62 + pfbm(q * 1.9 + vec2(o2, 11.0), per) * 0.38;
    float lit = pfbm(q + vec2(o1 - 0.11, -0.14), per) * 0.62 + pfbm(q * 1.9 + vec2(o2 - 0.11, 10.86), per) * 0.38;
    float dens = smoothstep(thr, thr + 0.3, n);
    // Compare with the density a step towards the sun: thicker there means this side is in shade.
    float shade = clamp(0.62 + (n - lit) * 4.0, 0.0, 1.0);
    vec3 cc = mix(mix(sky, colorC, 0.45) * 0.82, colorC, shade);
    col = mix(col, cc, dens * (0.95 - 0.3 * fl));
  }
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'water-caustics',
    name: 'Water Caustics',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Deep', type: 'color', default: '#053a6b' },
      { key: 'colorB', label: 'Shallow', type: 'color', default: '#0f9bb5' },
      { key: 'colorC', label: 'Light', type: 'color', default: '#c9fbff' },
      scale(1),
      { key: 'intensity', label: 'Intensity', type: 'float', default: 0.7, min: 0, max: 1.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
// F2 - F1 of an animated Voronoi pattern: small along the cell borders.
float cellEdge(vec2 q, float t) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = hash22(i + g);
      vec2 o = 0.5 + 0.38 * sin(t * (0.6 + h.x) + TAU * h);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) * scale;
  float t = u_time * speed;
  // A slow refraction wobble bends the whole net.
  p += 0.05 * vec2(sin(p.y * 3.1 + t * 0.7), cos(p.x * 2.7 - t * 0.6));
  float a = cellEdge(p * 2.4, t);
  float b = cellEdge(p * 3.7 + 7.1, t * 1.3 + 4.0);
  float c1 = pow(1.0 - smoothstep(0.0, 0.42, a), 3.0);
  float c2 = pow(1.0 - smoothstep(0.0, 0.36, b), 3.0);
  // Where two nets overlap the light focuses and gets much brighter.
  float light = c1 * 0.55 + c2 * 0.35 + c1 * c2 * 1.4;
  vec3 col = mix(colorB, colorA, smoothstep(-0.2, 1.1, uv.y + 0.25 * length(uv - 0.5)));
  col += colorC * light * intensity;
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'flame',
    name: 'Flame',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Outer', type: 'color', default: '#b3200f' },
      { key: 'colorB', label: 'Middle', type: 'color', default: '#ff7a18' },
      { key: 'colorC', label: 'Core', type: 'color', default: '#ffe9a8' },
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0b0508' },
      { key: 'height', label: 'Height', type: 'float', default: 0.7, min: 0.2, max: 1.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}${PERIODIC_NOISE}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed;
  // y = 0 at the bottom edge, growing upwards; hn = 1 at the chosen flame height.
  float y = ext.y - p.y;
  float hn = y / (2.0 * ext.y * max(height, 0.05));
  float x = p.x + 0.05 * sin(y * 5.0 + t * 1.3) * hn;
  vec2 per = vec2(256.0);
  float r1 = mod(t * 0.9, 256.0);
  float r2 = mod(t * 1.7, 256.0);
  // Noise is stretched vertically so it reads as rising tongues rather than blobs.
  float n = pfbm(vec2(x * 2.6, y * 1.25 - r1), per) * 0.62 + pfbm(vec2(x * 5.2 + 13.0, y * 2.4 - r2), per) * 0.38;
  n = smoothstep(0.15, 0.85, n);
  // The tongues are carved out of a glow that fades with height.
  float f = n * 1.25 - hn * 1.0 + 0.2 * exp(-hn * 7.0);
  vec3 col = colorBg;
  col = mix(col, colorA, smoothstep(0.0, 0.3, f));
  col = mix(col, colorB, smoothstep(0.22, 0.6, f));
  col = mix(col, colorC, smoothstep(0.6, 1.1, f));
  col += colorA * 0.14 * exp(-hn * 1.8);
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'lava-lamp',
    name: 'Lava Lamp',
    category: 'abstract',
    params: [
      { key: 'colorA', label: 'Blob Top', type: 'color', default: '#ff5e7e' },
      { key: 'colorB', label: 'Blob Bottom', type: 'color', default: '#ffb347' },
      { key: 'colorBg', label: 'Background', type: 'color', default: '#1d1147' },
      { key: 'size', label: 'Blob Size', type: 'float', default: 1, min: 0.4, max: 2, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed * 0.35;
  float field = 0.0;
  const int N = 8;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(fi * 7.3 + 1.0, fi * 3.1 + 5.0));
    vec2 c = vec2(sin(t * (0.3 + 0.4 * h.x) + TAU * h.y) * 0.8 * ext.x, sin(t * (0.45 + 0.5 * h.y) + TAU * h.x * 1.7) * 0.9 * ext.y);
    float r = (0.1 + 0.09 * hash11(fi + 9.0)) * size;
    vec2 d = p - c;
    field += r * r / (dot(d, d) + 1e-4);
  }
  // Blobs merge wherever the summed field passes 1.
  float aa = min(fwidth(field), 0.5);
  float m = smoothstep(1.0 - aa, 1.0 + aa, field);
  vec3 blob = mix(colorA, colorB, smoothstep(-ext.y, ext.y, p.y));
  blob *= 0.9 + 0.2 * smoothstep(1.0, 3.5, field);
  vec3 bg = colorBg * (1.0 - 0.45 * dot(uv - 0.5, uv - 0.5) * 2.0);
  bg += blob * 0.3 * smoothstep(0.3, 1.0, field);
  return vec4(dither(mix(bg, blob, m), uv), 1.0);
}`,
  },
];

export default generators;
