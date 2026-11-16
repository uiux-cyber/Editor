import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });
const angle = (def: number): ParamDef => ({ key: 'angle', label: 'Angle', type: 'float', default: def, min: 0, max: 360, step: 1, unit: '°' });

/**
 * Pattern sizes are given in design pixels and converted with designPx(), so a preview and a 4K
 * export show the same number of stripes / dots. Every edge is box-filtered: pulse() is the exact
 * average of a periodic on/off pattern over one pixel, lineCov() the coverage of a thin line.
 */
const GEN_LIB = `
vec2 frameUv(vec2 uv) {
  return (uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
}
// Size of one design pixel in frameUv units.
float designPx() {
  return u_px / min(u_res.x, u_res.y);
}
vec3 dither(vec3 c, vec2 uv) {
  return c + (hash21(uv * u_res) - 0.5) / 255.0;
}
// Periodic pulse (1 while fract(x) < duty) averaged over a window of width w.
float pulse(float x, float duty, float w) {
  w = max(w, 1e-5);
  float a = x - 0.5 * w;
  float b = x + 0.5 * w;
  float ia = floor(a) * duty + min(fract(a), duty);
  float ib = floor(b) * duty + min(fract(b), duty);
  return (ib - ia) / w;
}
// Coverage of a line of width w at distance d from its centre (both in real pixels).
float lineCov(float d, float w) {
  return clamp(0.5 * w - d + 0.5, 0.0, 1.0) - clamp(-0.5 * w - d + 0.5, 0.0, 1.0);
}`;

const generators: GeneratorDef[] = [
  {
    id: 'stripes',
    name: 'Stripes',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#20264d' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#2c3566' },
      angle(45),
      { key: 'width', label: 'Stripe Width', type: 'float', default: 70, min: 4, max: 400, step: 1, unit: 'px' },
      { key: 'softness', label: 'Softness', type: 'float', default: 0, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) / designPx();
  float a = radians(angle);
  float period = 2.0 * max(width, 2.0);
  // Stripes run along 'angle' and travel across it at 40 px/s.
  float x = dot(p, vec2(-sin(a), cos(a))) / period + fract(u_time * speed * 40.0 / period);
  float w = fwidth(x);
  float hard = pulse(x, 0.5, w);
  float soft = 0.5 + 0.5 * sin(TAU * x) * (1.0 - smoothstep(0.3, 0.6, w));
  vec3 col = mix(colorA, colorB, mix(hard, soft, softness));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'chevrons',
    name: 'Chevrons',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#f4b942' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#f7c95f' },
      { key: 'width', label: 'Stripe Width', type: 'float', default: 60, min: 4, max: 300, step: 1, unit: 'px' },
      { key: 'zig', label: 'Zigzag Size', type: 'float', default: 160, min: 16, max: 800, step: 1, unit: 'px' },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) / designPx();
  float period = 2.0 * max(width, 2.0);
  float z = max(zig, 8.0);
  float tri = abs(fract(p.x / (2.0 * z)) - 0.5) * 2.0;
  float x = (p.y + tri * z) / period + fract(u_time * speed * 40.0 / period);
  vec3 col = mix(colorA, colorB, pulse(x, 0.5, fwidth(x)));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'polka-dots',
    name: 'Polka Dots',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Dots', type: 'color', default: '#ff6b8b' },
      { key: 'colorB', label: 'Background', type: 'color', default: '#fff1e6' },
      { key: 'size', label: 'Dot Size', type: 'float', default: 56, min: 2, max: 400, step: 1, unit: 'px' },
      { key: 'spacing', label: 'Spacing', type: 'float', default: 130, min: 8, max: 600, step: 1, unit: 'px' },
      { key: 'stagger', label: 'Stagger Rows', type: 'bool', default: true },
      { key: 'wave', label: 'Size Wave', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
      angle(20),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) / designPx();
  float sp = max(spacing, 4.0);
  float a = radians(angle);
  // The grid drifts along 'angle' at 30 px/s; it repeats every 2 cells, so the offset can wrap.
  vec2 off = mod(vec2(cos(a), sin(a)) * u_time * speed * 30.0 / sp, 2.0);
  vec2 g = p / sp - off;
  float shift = stagger > 0.5 ? 0.5 * mod(floor(g.y), 2.0) : 0.0;
  g.x += shift;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  // Each dot swells as a slow wave passes over its (un-wrapped) position.
  vec2 centre = cell + 0.5 + off - vec2(shift, 0.0);
  float swell = 1.0 + wave * 0.45 * sin(dot(centre, vec2(0.55, 0.8)) - u_time * speed * 1.4);
  float r = min(0.5 * size * swell, 0.49 * sp);
  float d = (length(f) * sp - r) * u_px;
  vec3 col = mix(colorB, colorA, clamp(0.5 - d, 0.0, 1.0));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'checkerboard',
    name: 'Checkerboard',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#1f2430' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#2b3242' },
      { key: 'size', label: 'Square Size', type: 'float', default: 120, min: 4, max: 600, step: 1, unit: 'px' },
      angle(0),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = rot2(radians(angle)) * (frameUv(uv) / designPx());
  float period = 2.0 * max(size, 2.0);
  vec2 g = p / period + fract(vec2(0.6, 0.8) * u_time * speed * 40.0 / period);
  vec2 w = fwidth(g);
  float cx = pulse(g.x, 0.5, w.x);
  float cy = pulse(g.y, 0.5, w.y);
  float m = 0.5 - 0.5 * (1.0 - 2.0 * cx) * (1.0 - 2.0 * cy);
  return vec4(dither(mix(colorA, colorB, m), uv), 1.0);
}`,
  },
  {
    id: 'grid-lines',
    name: 'Grid',
    category: 'pattern',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0f1b33' },
      { key: 'colorA', label: 'Lines', type: 'color', default: '#5fa8ff' },
      { key: 'size', label: 'Cell Size', type: 'float', default: 54, min: 6, max: 400, step: 1, unit: 'px' },
      { key: 'major', label: 'Major Every', type: 'int', default: 4, min: 1, max: 12, step: 1 },
      { key: 'lineWidth', label: 'Line Width', type: 'float', default: 1.5, min: 0.5, max: 12, step: 0.1, unit: 'px' },
      { key: 'fade', label: 'Edge Fade', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      angle(0),
      speed(0.5),
    ],
    glsl: `${GEN_LIB}
float gridLines(vec2 g, vec2 w, float duty) {
  float lx = pulse(g.x + 0.5 * duty, duty, w.x);
  float ly = pulse(g.y + 0.5 * duty, duty, w.y);
  return 1.0 - (1.0 - lx) * (1.0 - ly);
}
vec4 generate(vec2 uv) {
  vec2 pf = frameUv(uv);
  vec2 p = rot2(radians(angle)) * (pf / designPx());
  float s = max(size, 4.0);
  float n = max(major, 1.0);
  // The sheet drifts diagonally at 30 px/s and wraps every major cell.
  vec2 g = p / s + mod(vec2(0.6, 0.8) * u_time * speed * 30.0 / s, n);
  vec2 w = fwidth(g);
  float minor = gridLines(g, w, clamp(lineWidth / s, 0.0, 1.0));
  float heavy = gridLines(g / n, w / n, clamp(lineWidth * 1.8 / (s * n), 0.0, 1.0));
  float vis = 1.0 - fade * smoothstep(0.15, 0.95, length(pf));
  vec3 col = colorBg * (1.0 - 0.35 * dot(uv - 0.5, uv - 0.5));
  col = mix(col, colorA, minor * 0.32 * vis);
  col = mix(col, colorA, heavy * 0.85 * vis);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'hex-grid',
    name: 'Hex Grid',
    category: 'pattern',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#10131f' },
      { key: 'colorA', label: 'Lines', type: 'color', default: '#39415e' },
      { key: 'colorB', label: 'Highlight', type: 'color', default: '#7c5cff' },
      { key: 'size', label: 'Cell Size', type: 'float', default: 96, min: 12, max: 500, step: 1, unit: 'px' },
      { key: 'lineWidth', label: 'Line Width', type: 'float', default: 3, min: 0.5, max: 20, step: 0.1, unit: 'px' },
      { key: 'density', label: 'Active Cells', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
// Nearest centre of a pointy-top hexagon lattice (centres one unit apart): xy = offset, zw = centre.
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = (floor(p / s) + 0.5) * s;
  vec2 b = floor(p / s + 0.5) * s;
  vec2 da = p - a;
  vec2 db = p - b;
  return dot(da, da) < dot(db, db) ? vec4(da, a) : vec4(db, b);
}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) / designPx();
  float s = max(size, 6.0);
  vec4 hc = hexCell(p / s);
  vec2 q = abs(hc.xy);
  // Distance to the cell border in real pixels.
  float e = (0.5 - max(q.x, dot(q, vec2(0.5, 0.8660254)))) * s * u_px;
  float line = lineCov(e, lineWidth * u_px);
  float h1 = hash21(hc.zw * 1.37 + 3.0);
  float h2 = hash21(hc.zw * 2.11 + 17.0);
  float t = u_time * speed;
  // A share of the cells breathe on their own clocks, and a slow wave brushes across all of them.
  float blink = pow(max(sin(t * (0.5 + 0.9 * h2) + TAU * h1), 0.0), 3.0) * step(1.0 - density, h1);
  float sweep = pow(0.5 + 0.5 * sin(dot(hc.zw, vec2(0.21, 0.33)) - t * 0.6), 6.0) * 0.25;
  float inner = smoothstep(0.0, 0.5 * s * u_px, e);
  vec3 col = colorBg * (1.0 - 0.4 * dot(uv - 0.5, uv - 0.5));
  col = mix(col, colorB, clamp(blink * 0.85 + sweep, 0.0, 1.0) * (0.55 + 0.45 * inner));
  col = mix(col, colorA, line);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'topographic',
    name: 'Topographic',
    category: 'pattern',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0e2a2b' },
      { key: 'colorA', label: 'Lines', type: 'color', default: '#3f8f86' },
      { key: 'colorB', label: 'Index Lines', type: 'color', default: '#b5ead7' },
      { key: 'levels', label: 'Levels', type: 'int', default: 22, min: 4, max: 80, step: 1 },
      { key: 'lineWidth', label: 'Line Width', type: 'float', default: 2, min: 0.5, max: 12, step: 0.1, unit: 'px' },
      { key: 'scale', label: 'Scale', type: 'float', default: 1, min: 0.3, max: 4, step: 0.05 },
      speed(),
    ],
    glsl: `${GEN_LIB}
float terrain(vec2 q, float t) {
  // The layers circle slowly, so the map keeps reshaping without ever scrolling away.
  vec2 d1 = 0.8 * vec2(sin(t * 0.21), cos(t * 0.17));
  vec2 d2 = 0.8 * vec2(cos(t * 0.13 + 2.0), sin(t * 0.19 + 1.0));
  return vnoise(q + d1) * 0.55 + vnoise(q * 1.9 + 7.3 - d2) * 0.3 + vnoise(q * 3.7 + 21.0 + d1.yx) * 0.15;
}
vec4 generate(vec2 uv) {
  vec2 q = frameUv(uv) * 2.2 * scale;
  float h = terrain(q, u_time * speed);
  float v = h * max(levels, 1.0);
  float fw = max(fwidth(v), 1e-5);
  // Real pixels to the nearest contour; every fifth contour is a heavier index line.
  float dist = abs(fract(v - 0.5) - 0.5) / fw;
  float index = step(mod(floor(v + 0.5), 5.0), 0.5);
  float lw = lineWidth * u_px * mix(1.0, 1.8, index);
  float line = lineCov(dist, lw);
  // Where contours crowd closer than a pixel, fade to their average coverage instead of aliasing.
  line = mix(line, clamp(lw * fw, 0.0, 1.0), smoothstep(0.3, 0.7, fw));
  vec3 col = colorBg * (0.85 + 0.3 * h);
  col = mix(col, mix(colorA, colorB, index), line * mix(0.7, 1.0, index));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'concentric-rings',
    name: 'Concentric Rings',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#132a4f' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#1c3b6e' },
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'width', label: 'Ring Width', type: 'float', default: 64, min: 4, max: 400, step: 1, unit: 'px' },
      { key: 'softness', label: 'Softness', type: 'float', default: 0, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = (frameUv(uv) - frameUv(vec2(centerX, centerY))) / designPx();
  float period = 2.0 * max(width, 2.0);
  // Rings travel outwards at 40 px/s.
  float x = length(p) / period - fract(u_time * speed * 40.0 / period);
  float w = fwidth(x);
  float hard = pulse(x, 0.5, w);
  float soft = 0.5 + 0.5 * sin(TAU * x) * (1.0 - smoothstep(0.3, 0.6, w));
  vec3 col = mix(colorA, colorB, mix(hard, soft, softness));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Color A', type: 'color', default: '#ff9f43' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#ffbe76' },
      { key: 'colorC', label: 'Center Glow', type: 'color', default: '#fff3d6' },
      { key: 'rays', label: 'Rays', type: 'int', default: 14, min: 3, max: 60, step: 1 },
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'twist', label: 'Twist', type: 'float', default: 0, min: -1, max: 1, step: 0.01 },
      { key: 'glow', label: 'Glow', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv) - frameUv(vec2(centerX, centerY));
  float r = length(p);
  float n = max(floor(rays + 0.5), 2.0);
  // One full ray period per unit of x; the whole fan turns slowly.
  float x = (atan(p.y, p.x) / TAU + twist * r) * n + fract(u_time * speed * 0.12);
  // Width of one real pixel in ray periods (computed analytically: atan has a seam).
  float w = n * (1.0 / (TAU * max(r, 1e-4)) + abs(twist)) / min(u_res.x, u_res.y);
  vec3 col = mix(colorA, colorB, pulse(x, 0.5, w));
  col = mix(col, colorC, glow * exp(-r * r * 7.0));
  col *= 1.0 - 0.25 * smoothstep(0.3, 1.1, r);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'halftone',
    name: 'Halftone',
    category: 'pattern',
    params: [
      { key: 'colorA', label: 'Dots', type: 'color', default: '#ff4f79' },
      { key: 'colorB', label: 'Background', type: 'color', default: '#2d1b4e' },
      { key: 'size', label: 'Cell Size', type: 'float', default: 30, min: 4, max: 200, step: 1, unit: 'px' },
      angle(30),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 pf = frameUv(uv);
  float t = u_time * speed;
  float a = radians(angle);
  // The tone the dots reproduce: a diagonal ramp with a slow swell rolling through it.
  float tone = dot(pf, vec2(cos(a), sin(a))) * 0.42 + 0.36;
  tone += 0.12 * sin(pf.x * 3.1 - pf.y * 1.7 + t * 0.7) + 0.3 * (fbm(pf * 1.2 + vec2(t * 0.04, 3.0)) - 0.5);
  // Stop short of solid ink so the dots stay readable everywhere.
  tone = clamp(tone, 0.0, 0.72);
  float s = max(size, 3.0);
  // Classic 45 degree screen.
  vec2 g = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678) * (pf / designPx()) / s;
  vec2 f = fract(g) - 0.5;
  float rad = 0.74 * sqrt(tone);
  float cellPx = s * u_px;
  float cov = clamp(0.5 - (length(f) - rad) * cellPx, 0.0, 1.0);
  // Cells smaller than a few pixels fall back to the ink coverage they would average to.
  cov = mix(cov, clamp(PI * rad * rad, 0.0, 1.0), smoothstep(0.3, 0.6, 1.0 / cellPx));
  return vec4(dither(mix(colorB, colorA, cov), uv), 1.0);
}`,
  },
  {
    id: 'circuit',
    name: 'Circuit',
    category: 'pattern',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#06171c' },
      { key: 'colorA', label: 'Traces', type: 'color', default: '#1d5c63' },
      { key: 'colorB', label: 'Signal', type: 'color', default: '#5ef2d6' },
      { key: 'size', label: 'Cell Size', type: 'float', default: 84, min: 16, max: 400, step: 1, unit: 'px' },
      { key: 'lineWidth', label: 'Trace Width', type: 'float', default: 5, min: 1, max: 30, step: 0.5, unit: 'px' },
      speed(),
    ],
    glsl: `${GEN_LIB}
// Whether a trace crosses the border between cell c and its neighbour in direction d
// (hashed on the shared border, so both cells agree).
float edgeOn(vec2 c, vec2 d) {
  vec2 base = min(c, c + d);
  return step(0.44, hash21(base * vec2(1.0, 1.7) + abs(d.x) * 37.0 + 5.0));
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
vec4 generate(vec2 uv) {
  vec2 pf = frameUv(uv);
  float s = max(size, 12.0);
  vec2 g = pf / designPx() / s;
  vec2 c = floor(g);
  vec2 f = fract(g) - 0.5;
  float cnt = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 d = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(0.0, 1.0) : k == 2 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
    cnt += edgeOn(c, d);
  }
  // Dead ends finish in a ring pad, so their trace starts at the pad's rim.
  float pad = cnt > 0.5 && cnt < 1.5 ? 0.17 : 0.0;
  float dist = 1e3;
  for (int k = 0; k < 4; k++) {
    vec2 d = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(0.0, 1.0) : k == 2 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
    if (edgeOn(c, d) > 0.5) dist = min(dist, segDist(f, d * pad, d * 0.5));
  }
  float cellPx = s * u_px;
  float lw = lineWidth * u_px;
  float r = length(f);
  float trace = lineCov(dist * cellPx, lw);
  float ring = pad > 0.0 ? lineCov(abs(r - pad) * cellPx, lw) : 0.0;
  float node = cnt > 2.5 ? clamp(0.5 - (r * cellPx - lw * 1.1), 0.0, 1.0) : 0.0;
  float via = cnt < 0.5 ? clamp(0.5 - (r * cellPx - lw * 0.45), 0.0, 1.0) * 0.5 : 0.0;
  float copper = max(max(trace, ring), max(node, via));
  // Signals: two sets of wavefronts sweep across the board and light up the copper they touch.
  float t = u_time * speed;
  float s1 = pow(0.5 + 0.5 * sin(dot(g, vec2(0.31, 0.47)) - t * 1.3), 14.0);
  float s2 = pow(0.5 + 0.5 * sin(dot(g, vec2(-0.43, 0.23)) - t * 0.9 + 2.0), 18.0);
  float signal = clamp(s1 + s2, 0.0, 1.0);
  vec3 col = colorBg * (1.0 - 0.5 * dot(uv - 0.5, uv - 0.5));
  col += colorB * 0.06 * signal;
  col = mix(col, mix(colorA, colorB, signal), copper);
  return vec4(dither(col, uv), 1.0);
}`,
  },
];

export default generators;
