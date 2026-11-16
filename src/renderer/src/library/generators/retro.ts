import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });

const GEN_LIB = `
vec2 frameUv(vec2 uv) {
  return (uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
vec2 frameExt() {
  return 0.5 * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
// Size of one real / one design pixel in frameUv units.
float realPx() {
  return 1.0 / min(u_res.x, u_res.y);
}
float designPx() {
  return u_px / min(u_res.x, u_res.y);
}
vec3 dither(vec3 c, vec2 uv) {
  return c + (hash21(uv * u_res) - 0.5) / 255.0;
}
// Periodic pulse (1 while fract(x) < duty) averaged over a window of width w: alias-free.
float pulse(float x, float duty, float w) {
  w = max(w, 1e-5);
  float a = x - 0.5 * w;
  float b = x + 0.5 * w;
  float ia = floor(a) * duty + min(fract(a), duty);
  float ib = floor(b) * duty + min(fract(b), duty);
  return (ib - ia) / w;
}`;

const generators: GeneratorDef[] = [
  {
    id: 'synthwave',
    name: 'Synthwave',
    category: 'retro',
    params: [
      { key: 'colorA', label: 'Sky', type: 'color', default: '#170a3a' },
      { key: 'colorB', label: 'Horizon', type: 'color', default: '#ff3d9a' },
      { key: 'colorC', label: 'Sun', type: 'color', default: '#ffd36e' },
      { key: 'colorD', label: 'Grid', type: 'color', default: '#3fe0ff' },
      { key: 'horizon', label: 'Horizon', type: 'float', default: 0.58, min: 0.3, max: 0.85, step: 0.01 },
      { key: 'sunSize', label: 'Sun Size', type: 'float', default: 0.25, min: 0, max: 0.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float t = u_time * speed;
  float px = realPx();
  float hy = frameUv(vec2(0.5, horizon)).y;
  // d < 0: sky, d > 0: ground.
  float d = p.y - hy;

  float up = clamp(-d / (hy + ext.y), 0.0, 1.0);
  vec3 sky = mix(mix(colorA, colorB, 0.4), colorA, smoothstep(0.0, 0.8, up));
  sky += colorB * 0.4 * exp(-up * 7.0);

  // The sun sits on the horizon; its lower half is cut by slits that drift downwards and widen.
  float sr = sunSize;
  vec2 sc = vec2(0.0, hy - sr * 0.55);
  float sd = length(p - sc) - sr;
  float sv = clamp((p.y - (sc.y - sr)) / max(2.0 * sr, 1e-4), 0.0, 1.0);
  float u = (sv - 0.42) / 0.58;
  float k = u * 7.0 - fract(t * 0.06);
  float slit = pulse(k, mix(0.12, 0.62, clamp(u, 0.0, 1.0)), fwidth(k)) * step(0.0, u);
  float sun = clamp(0.5 - sd / px, 0.0, 1.0) * (1.0 - slit) * step(0.001, sr);
  vec3 sunCol = mix(colorC, colorB, smoothstep(0.1, 0.95, sv));
  sky += (colorB * 0.45 * exp(-max(sd, 0.0) / 0.14) + colorC * 0.2 * exp(-max(sd, 0.0) / 0.04)) * step(0.001, sr);
  sky = mix(sky, sunCol, sun);

  // Perspective floor: project the pixel onto a plane and draw a box-filtered grid on it.
  float gd = max(d, 1e-4);
  float z = 0.3 / gd;
  vec2 g = vec2(p.x * z * 2.4, z * 2.4 + fract(t * 0.5));
  vec2 gw = fwidth(g);
  float lx = pulse(g.x + 0.03, 0.06, gw.x);
  float lz = pulse(g.y + 0.03, 0.06, gw.y);
  float core = 1.0 - (1.0 - lx) * (1.0 - lz);
  float gx2 = pulse(g.x + 0.11, 0.22, gw.x);
  float gz2 = pulse(g.y + 0.11, 0.22, gw.y);
  float halo = 1.0 - (1.0 - gx2) * (1.0 - gz2);
  vec3 ground = colorA * 0.35;
  ground += colorD * (core * 0.9 + halo * 0.22) * smoothstep(0.0, 0.05, gd);
  ground = mix(ground, colorB, 0.75 * exp(-gd * 16.0));

  vec3 col = mix(sky, ground, smoothstep(-px, px, d));
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'retro-arcs',
    name: 'Retro Arcs',
    category: 'retro',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#f3e3c3' },
      { key: 'colorA', label: 'Band 1', type: 'color', default: '#e4572e' },
      { key: 'colorB', label: 'Band 2', type: 'color', default: '#f3a712' },
      { key: 'colorC', label: 'Band 3', type: 'color', default: '#a8c256' },
      { key: 'colorD', label: 'Band 4', type: 'color', default: '#29335c' },
      {
        key: 'corner',
        label: 'Corner',
        type: 'select',
        default: 0,
        options: [
          { label: 'Bottom Left', value: 0 },
          { label: 'Bottom Right', value: 1 },
          { label: 'Top Left', value: 2 },
          { label: 'Top Right', value: 3 },
        ],
      },
      { key: 'width', label: 'Band Width', type: 'float', default: 56, min: 6, max: 300, step: 1, unit: 'px' },
      { key: 'gap', label: 'Gap', type: 'int', default: 4, min: 0, max: 12, step: 1 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec3 bandColor(float i, float groups) {
  float m = mod(i, groups);
  return m < 0.5 ? colorA : m < 1.5 ? colorB : m < 2.5 ? colorC : m < 3.5 ? colorD : colorBg;
}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  vec2 c = vec2(mod(corner, 2.0) < 0.5 ? -ext.x : ext.x, corner < 1.5 ? ext.y : -ext.y);
  float groups = 4.0 + max(gap, 0.0);
  // Band index grows with the distance from the corner; the whole rainbow drifts outwards.
  float k = length(p - c) / designPx() / max(width, 2.0) - fract(u_time * speed * 0.05) * groups;
  float w = fwidth(k);
  // Blend the two bands that meet at the nearest boundary by pixel coverage.
  float b = floor(k + 0.5);
  float cov = clamp((k - b) / max(w, 1e-5) + 0.5, 0.0, 1.0);
  vec3 col = mix(bandColor(b - 1.0, groups), bandColor(b, groups), cov);
  // A hint of printed-paper shading.
  col *= 0.96 + 0.08 * fbm(p * 3.0);
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'crt-screen',
    name: 'CRT Screen',
    category: 'retro',
    params: [
      { key: 'colorA', label: 'Dark', type: 'color', default: '#07140f' },
      { key: 'colorB', label: 'Phosphor', type: 'color', default: '#35e08a' },
      { key: 'pitch', label: 'Line Pitch', type: 'float', default: 6, min: 2, max: 40, step: 0.5, unit: 'px' },
      { key: 'scanlines', label: 'Scanlines', type: 'float', default: 0.7, min: 0, max: 1, step: 0.01 },
      { key: 'mask', label: 'RGB Mask', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 n = p / frameExt();
  float t = u_time * speed;
  // An idle signal: soft interference bands and a hum bar rolling down the tube.
  float sig = vnoise(vec2(p.y * 6.0 + 3.0, t * 0.5)) * 0.6 + vnoise(vec2(p.y * 17.0, t * 0.9 + 5.0)) * 0.4;
  float bar = fract(uv.y - t * 0.11) - 0.5;
  bar = exp(-bar * bar / 0.02);
  float lum = 0.2 + 0.35 * sig + 0.45 * bar;
  lum *= 1.0 + 0.02 * sin(t * 47.0);
  vec3 col = mix(colorA, colorB, clamp(lum, 0.0, 1.0));
  // Scanlines and an RGB aperture grille, both locked to design pixels. They fade to their mean
  // brightness when they get too fine for the output resolution.
  float lp = max(pitch, 2.0) * u_px;
  float sl = 0.5 + 0.5 * cos(TAU * uv.y * u_res.y / lp);
  float keepS = 1.0 - smoothstep(0.3, 0.55, 1.0 / lp);
  col *= 1.0 - scanlines * 0.6 * mix(0.5, 1.0 - sl, keepS);
  float mp = lp * 1.5;
  vec3 tri = 0.5 + 0.5 * cos(TAU * (uv.x * u_res.x / mp - vec3(0.0, 1.0, 2.0) / 3.0));
  float keepM = 1.0 - smoothstep(0.3, 0.55, 1.0 / mp);
  col *= 1.0 - mask * 0.45 * mix(vec3(0.5), 1.0 - tri, keepM);
  col *= 1.0 + 0.6 * scanlines * 0.3 + 0.2 * mask;
  // Curved glass: brightness falls off towards the bezel.
  float edge = pow(abs(n.x), 6.0) + pow(abs(n.y), 6.0);
  col *= (1.0 - 0.25 * dot(n, n) * 0.5) * (1.0 - 0.85 * smoothstep(0.55, 1.05, edge));
  col += colorB * 0.05 * exp(-dot(n, n) * 1.5);
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'led-wall',
    name: 'LED Wall',
    category: 'retro',
    params: [
      { key: 'colorBg', label: 'Panel', type: 'color', default: '#07070d' },
      { key: 'colorA', label: 'Color A', type: 'color', default: '#ff2e88' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#2ed3ff' },
      { key: 'pitch', label: 'LED Pitch', type: 'float', default: 26, min: 6, max: 160, step: 1, unit: 'px' },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 pf = frameUv(uv);
  float s = max(pitch, 4.0);
  float cell = s * designPx();
  vec2 g = pf / cell;
  vec2 f = fract(g) - 0.5;
  // Every LED shows one sample of a slow plasma "video".
  vec2 cp = (floor(g) + 0.5) * cell;
  float t = u_time * speed;
  vec2 o = 0.4 * vec2(sin(t * 0.3), cos(t * 0.23));
  float v = sin(cp.x * 3.1 + t * 0.9) + sin(cp.y * 2.7 - t * 0.7) + sin((cp.x + cp.y) * 2.2 + t * 0.5) + sin(length(cp - o) * 5.0 - t * 1.1);
  float b = smoothstep(-0.5, 0.8, v * 0.25);
  vec3 led = mix(colorA, colorB, 0.5 + 0.5 * sin(v * 1.3 + t * 0.2)) * (0.06 + 0.94 * b * b);
  float cellPx = s * u_px;
  float r = length(f);
  float lens = clamp(0.5 - (r - 0.34) * cellPx, 0.0, 1.0);
  float bleed = exp(-r * r * 9.0) * 0.4;
  float m = lens * (0.8 + 0.2 * exp(-r * r * 30.0)) + bleed * (1.0 - lens);
  // LEDs smaller than a few pixels melt into their average brightness.
  m = mix(m, 0.45, smoothstep(0.3, 0.6, 1.0 / cellPx));
  vec3 col = colorBg + led * m;
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'film-grain',
    name: 'Film Grain',
    category: 'retro',
    params: [
      { key: 'colorA', label: 'Center', type: 'color', default: '#2a2622' },
      { key: 'colorB', label: 'Edges', type: 'color', default: '#0d0b0a' },
      { key: 'amount', label: 'Grain', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      { key: 'grainSize', label: 'Grain Size', type: 'float', default: 2, min: 1, max: 12, step: 0.1, unit: 'px' },
      { key: 'flicker', label: 'Flicker', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'scratches', label: 'Dust & Scratches', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  vec2 ext = frameExt();
  float px = realPx();
  float dpx = designPx();
  // The grain changes 24 times a second (scaled by speed); speed 0 freezes one frame.
  float frame = mod(floor(u_time * speed * 24.0), 1024.0);
  float flick = 1.0 + flicker * 0.08 * (hash11(frame * 3.1 + 1.0) - 0.5);
  vec3 col = mix(colorA, colorB, smoothstep(0.2, 1.0, length(p / ext) * 0.75)) * flick;
  vec2 dp = p / dpx;
  float gs = max(grainSize, 0.5);
  float g1 = hash21(floor(dp / gs) + frame * 17.0);
  float g2 = vnoise(dp / (gs * 2.6) + frame * 5.3);
  col += ((g1 - 0.5) * 0.6 + (g2 - 0.5) * 0.7) * amount * 0.16;
  // A vertical scratch on some frames.
  float sx = (hash11(frame * 7.7 + 2.0) * 2.0 - 1.0) * ext.x;
  float sw = max(1.2 * dpx, px);
  float scratch = (1.0 - smoothstep(0.0, sw, abs(p.x - sx))) * step(0.72, hash11(frame * 1.3 + 9.0));
  scratch *= 0.4 + 0.6 * vnoise(vec2(p.y * 9.0, frame));
  col += scratch * 0.14 * scratches;
  // A few dust specks.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(frame + fi * 37.0, fi * 7.0 + 3.0));
    float r = max((2.0 + 5.0 * hash11(frame * 0.7 + fi * 3.3)) * dpx, px);
    float speck = 1.0 - smoothstep(0.5 * r, r, length(p - (h * 2.0 - 1.0) * ext));
    col -= speck * 0.2 * scratches * step(0.55, hash11(frame * 2.1 + fi * 5.0));
  }
  return vec4(dither(clamp(col, 0.0, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'paper',
    name: 'Paper',
    category: 'retro',
    params: [
      { key: 'colorA', label: 'Paper', type: 'color', default: '#efe6d3' },
      { key: 'colorB', label: 'Fibres', type: 'color', default: '#b9a889' },
      { key: 'roughness', label: 'Roughness', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      { key: 'fibres', label: 'Fibres', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      speed(0),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  // With speed > 0 the sheet is swapped 8 times a second, like stop-motion; 0 keeps it still.
  float frame = mod(floor(u_time * speed * 8.0), 512.0);
  vec2 q = p / designPx() + (hash22(vec2(frame, 3.0)) - 0.5) * 900.0 * step(0.5, frame);
  float mott = fbm(q / 260.0);
  // Fine tooth; faded out when it would be smaller than the output pixels.
  float tooth = vnoise(q / 2.4) * 0.6 + vnoise(q / 6.0 + 40.0) * 0.4;
  float toothAmt = smoothstep(0.35, 1.2, 2.4 * u_px);
  // Fibres: noise stretched along two directions.
  vec2 r1 = rot2(0.5) * q;
  vec2 r2 = rot2(-1.1) * q;
  float f1 = vnoise(vec2(r1.x / 46.0, r1.y / 2.8));
  float f2 = vnoise(vec2(r2.x / 60.0, r2.y / 3.4) + 17.0);
  float fib = (smoothstep(0.62, 0.9, f1) + smoothstep(0.66, 0.92, f2)) * smoothstep(0.3, 1.0, 2.8 * u_px);
  vec3 col = mix(colorA, colorB, clamp((mott - 0.45) * 0.5 * roughness, 0.0, 1.0));
  col *= 1.0 + (tooth - 0.5) * 0.12 * roughness * toothAmt;
  col = mix(col, colorB, clamp(fib * 0.28 * fibres, 0.0, 1.0));
  col *= 1.0 - 0.18 * dot(uv - 0.5, uv - 0.5);
  return vec4(dither(col, uv), 1.0);
}`,
  },
];

export default generators;
