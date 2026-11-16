import type { EffectDef, ParamDef } from '../types';

const AMOUNT: ParamDef = { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 };

/** 3×3 Sobel edge strength of the luminance, sampled through `fn` (tex or orig). */
const sobel = (fn: 'tex' | 'orig'): string => `
float edgeLum(vec2 uv) { return luma(${fn}(uv).rgb); }
float sobel(vec2 uv, vec2 d) {
  float tl = edgeLum(uv + vec2(-d.x, -d.y));
  float tc = edgeLum(uv + vec2(0.0, -d.y));
  float tr = edgeLum(uv + vec2(d.x, -d.y));
  float ml = edgeLum(uv + vec2(-d.x, 0.0));
  float mr = edgeLum(uv + vec2(d.x, 0.0));
  float bl = edgeLum(uv + vec2(-d.x, d.y));
  float bc = edgeLum(uv + vec2(0.0, d.y));
  float br = edgeLum(uv + vec2(d.x, d.y));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return length(vec2(gx, gy));
}`;

// 5×5 glyph bitmaps for the ASCII effect, ordered from empty to dense. Bit (x + 5·y) is set where
// the glyph is inked; the integers are baked into the shader below.
const GLYPH_ART = [
  ['.....', '.....', '.....', '.....', '.....'],
  ['.....', '.....', '.....', '.....', '..#..'],
  ['.....', '..#..', '.....', '..#..', '.....'],
  ['.....', '.....', '.###.', '.....', '.....'],
  ['.....', '..#..', '.###.', '..#..', '.....'],
  ['.....', '.###.', '.....', '.###.', '.....'],
  ['.....', '#.#.#', '.###.', '#.#.#', '.....'],
  ['.###.', '#...#', '.###.', '#...#', '.###.'],
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
  ['.###.', '#.###', '#.#.#', '#.###', '.####'],
];
const GLYPH_BITS = GLYPH_ART.map((rows) =>
  rows.reduce((n, row, y) => n + [...row].reduce((m, ch, x) => m + (ch === '#' ? 2 ** (x + 5 * y) : 0), 0), 0),
);

const effects: EffectDef[] = [
  {
    id: 'posterize',
    name: 'Posterize',
    category: 'stylize',
    params: [{ key: 'levels', label: 'Levels', type: 'int', default: 5, min: 2, max: 16, step: 1 }, AMOUNT],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float n = max(floor(levels + 0.5), 2.0) - 1.0;
  vec3 v = rgb * n;
  // Band edges are anti-aliased over the local gradient, so they never crawl or stair-step.
  vec3 w = clamp(fwidth(v) * 0.75, 0.001, 0.5);
  vec3 q = (floor(v) + smoothstep(0.5 - w, 0.5 + w, fract(v))) / n;
  return vec4(mix(rgb, q, amount) * c.a, c.a);
}`,
  },
  {
    id: 'halftone',
    name: 'Halftone',
    category: 'stylize',
    params: [
      { key: 'size', label: 'Dot size', type: 'float', default: 10, min: 3, max: 80, step: 0.5, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: -90, max: 90, step: 1, unit: '°' },
      {
        key: 'mode',
        label: 'Inks',
        type: 'select',
        default: 0,
        options: [
          { label: 'Four colour', value: 0 },
          { label: 'Single ink', value: 1 },
        ],
      },
      { key: 'ink', label: 'Ink', type: 'color', default: '#15151c' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#f7f3e8' },
      AMOUNT,
    ],
    glsl: `
vec2 cellCentre(vec2 p, mat2 m, float cell) {
  vec2 q = (m * p) / cell;
  return (transpose(m) * (floor(q) + 0.5)) * cell;
}
float dotCover(vec2 p, vec2 centre, float cell, float tone, float aa) {
  // Dot radius for the requested ink coverage; above ~78% neighbouring dots start to merge.
  float t = clamp(tone, 0.0, 1.0);
  float x = max(t - 0.785, 0.0) / 0.215;
  float r = t < 0.785 ? sqrt(t / PI) : 0.5 + 0.2071 * x * x;
  float d = length(p - centre) / cell;
  return (1.0 - smoothstep(r - aa, r + aa, d)) * smoothstep(0.0, 0.03, tone);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 src = c.rgb / c.a;
  float cell = max(size, 2.0);
  vec2 p = (uv - 0.5) * u_res / u_px;
  float aa = 0.75 / (cell * u_px);
  // Dots that are too small to resolve fade to their average tone instead of turning into moiré.
  float vis = clamp(cell * u_px * 0.5 - 1.0, 0.0, 1.0);
  float a0 = radians(angle);
  vec3 res;
  if (mode < 0.5) {
    // Classic print rosette: cyan, magenta, yellow and black screens at different angles.
    const float ANG[4] = float[4](0.2618, 1.3090, 0.0, 0.7854);
    vec4 cov = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      mat2 m = rot2(a0 + ANG[i]);
      vec2 ctr = cellCentre(p, m, cell);
      vec4 s4 = tex(ctr * u_px / u_res + 0.5);
      vec3 s = s4.a > 0.0 ? s4.rgb / s4.a : src;
      float k = 1.0 - max(s.r, max(s.g, s.b));
      vec3 cmy = (1.0 - s - k) / max(1.0 - k, 0.001);
      float tone = i == 0 ? cmy.x : (i == 1 ? cmy.y : (i == 2 ? cmy.z : k));
      cov[i] = mix(tone, dotCover(p, ctr, cell, tone, aa), vis);
    }
    res = paper;
    res *= mix(vec3(1.0), vec3(0.0, 0.66, 0.93), cov.x);
    res *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), cov.y);
    res *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), cov.z);
    res = mix(res, ink, cov.w);
  } else {
    mat2 m = rot2(a0 + 0.7854);
    vec2 ctr = cellCentre(p, m, cell);
    vec4 s4 = tex(ctr * u_px / u_res + 0.5);
    vec3 s = s4.a > 0.0 ? s4.rgb / s4.a : src;
    float tone = 1.0 - luma(s);
    res = mix(paper, ink, mix(tone, dotCover(p, ctr, cell, tone, aa), vis));
  }
  return vec4(mix(src, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'dot-screen',
    name: 'Dot Screen',
    category: 'stylize',
    params: [
      { key: 'size', label: 'Pitch', type: 'float', default: 9, min: 3, max: 80, step: 0.5, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 25, min: -90, max: 90, step: 1, unit: '°' },
      {
        key: 'shape',
        label: 'Pattern',
        type: 'select',
        default: 0,
        options: [
          { label: 'Dots', value: 0 },
          { label: 'Lines', value: 1 },
          { label: 'Diamonds', value: 2 },
        ],
      },
      {
        key: 'tone',
        label: 'Tone',
        type: 'select',
        default: 0,
        options: [
          { label: 'Two tone', value: 0 },
          { label: 'Colour', value: 1 },
        ],
      },
      { key: 'ink', label: 'Ink', type: 'color', default: '#141a2e' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#f4f0e6' },
      AMOUNT,
    ],
    glsl: `
float screenTone(float v, vec2 p, float vis) {
  float pat;
  if (shape < 0.5) pat = cos(p.x) * cos(p.y);
  else if (shape < 1.5) pat = cos(p.x);
  else pat = 0.5 * (cos(p.x) + cos(p.y));
  float e = (v - 0.5) * 2.0 + pat;
  float w = max(fwidth(e) * 0.75, 0.001);
  return mix(v, smoothstep(-w, w, e), vis);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float pitch = max(size, 2.0);
  float vis = clamp(pitch * u_px * 0.5 - 1.0, 0.0, 1.0);
  float k = (shape < 0.5 ? 4.4428829 : TAU) / pitch;
  float a0 = radians(angle) + (shape < 0.5 ? 0.7853982 : 0.0);
  vec2 p = (uv - 0.5) * u_res / u_px * k;
  vec3 res;
  if (tone < 0.5) {
    res = mix(ink, paper, screenTone(luma(rgb), rot2(a0) * p, vis));
  } else {
    // One screen per channel, each at its own angle.
    res = vec3(
      screenTone(rgb.r, rot2(a0) * p, vis),
      screenTone(rgb.g, rot2(a0 + 0.5236) * p, vis),
      screenTone(rgb.b, rot2(a0 + 1.0472) * p, vis));
  }
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'crosshatch',
    name: 'Crosshatch',
    category: 'stylize',
    params: [
      { key: 'spacing', label: 'Spacing', type: 'float', default: 9, min: 4, max: 60, step: 0.5, unit: 'px' },
      { key: 'thickness', label: 'Stroke', type: 'float', default: 2.4, min: 0.5, max: 12, step: 0.1, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 45, min: -90, max: 90, step: 1, unit: '°' },
      { key: 'ink', label: 'Ink', type: 'color', default: '#1b1b26' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#f4efe3' },
      AMOUNT,
    ],
    glsl: `
float strokes(vec2 p, float ang, float pitch, float width, float aa) {
  float d = abs(fract(dot(p, vec2(cos(ang), sin(ang))) / pitch) - 0.5) * pitch;
  return clamp((width * 0.5 - d) / (2.0 * aa) + 0.5, 0.0, 1.0) * smoothstep(0.0, aa, width);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float l = luma(rgb);
  float pitch = max(spacing, 2.0);
  vec2 p = uv * u_res / u_px;
  // A little wobble keeps the strokes from looking ruled.
  p += (vec2(vnoise(p * 0.012), vnoise(p * 0.012 + 40.0)) - 0.5) * pitch * 1.2;
  float aa = 0.5 / u_px;
  float vis = clamp(pitch * u_px * 0.5 - 1.0, 0.0, 1.0);
  float a0 = radians(angle);
  // Four layers of strokes come in one after another as the picture gets darker.
  // Strokes also swell a little in the shadows, like a pen pressed harder.
  float w = thickness * (1.0 + 0.8 * (1.0 - l));
  float h = strokes(p, a0, pitch, w * clamp((0.92 - l) / 0.3, 0.0, 1.0), aa);
  h = max(h, strokes(p, a0 + 1.5708, pitch, w * clamp((0.72 - l) / 0.25, 0.0, 1.0), aa));
  h = max(h, strokes(p + pitch * 0.5, a0 + 0.7854, pitch, w * clamp((0.52 - l) / 0.22, 0.0, 1.0), aa));
  h = max(h, strokes(p, a0 - 0.7854, pitch * 0.5, w * clamp((0.32 - l) / 0.22, 0.0, 1.0), aa));
  h = mix(1.0 - l, h, vis);
  return vec4(mix(rgb, mix(paper, ink, h), amount) * c.a, c.a);
}`,
  },
  {
    id: 'pencil-sketch',
    name: 'Pencil Sketch',
    category: 'stylize',
    params: [
      { key: 'thickness', label: 'Line width', type: 'float', default: 1.5, min: 0.5, max: 8, step: 0.1, unit: 'px' },
      { key: 'strength', label: 'Line strength', type: 'float', default: 1.6, min: 0, max: 5, step: 0.05 },
      { key: 'shading', label: 'Shading', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'pencil', label: 'Pencil', type: 'color', default: '#2a2a33' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#f7f4ec' },
      AMOUNT,
    ],
    glsl: `${sobel('tex')}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec2 d = vec2(max(thickness * u_px, 1.0)) / u_res;
  vec2 p = uv * u_res / u_px;
  float line = smoothstep(0.06, 0.55, sobel(uv, d) * strength) * (0.8 + 0.2 * vnoise(p * 0.5));
  // Loose diagonal strokes shade the darker areas.
  float vis = clamp(6.0 * u_px * 0.5 - 1.0, 0.0, 1.0);
  float h = 0.5 + 0.5 * sin((p.x + p.y) * 0.7405 + vnoise(p * 0.03) * 5.0);
  h = mix(0.5, h, vis);
  float shade = smoothstep(0.3, 1.0, (1.0 - luma(rgb)) + (h - 0.5) * 0.7) * shading;
  float graphite = clamp(line + shade * (1.0 - line), 0.0, 1.0);
  vec3 res = mix(paper, pencil, graphite) * (1.0 - 0.05 * vnoise(p * 0.8));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'neon-edges',
    name: 'Neon Edges',
    category: 'stylize',
    params: [
      { key: 'thickness', label: 'Line width', type: 'float', default: 1.5, min: 0.5, max: 8, step: 0.1, unit: 'px' },
      { key: 'gain', label: 'Brightness', type: 'float', default: 1.6, min: 0, max: 5, step: 0.05 },
      { key: 'backdrop', label: 'Backdrop', type: 'float', default: 0.08, min: 0, max: 1, step: 0.01 },
      {
        key: 'colorize',
        label: 'Colour',
        type: 'select',
        default: 0,
        options: [
          { label: 'From picture', value: 0 },
          { label: 'Tint', value: 1 },
        ],
      },
      { key: 'tint', label: 'Tint', type: 'color', default: '#35f2ff' },
      AMOUNT,
    ],
    glsl: `
vec3 edgeRGB(vec2 uv, vec2 d) {
  vec3 tl = tex(uv + vec2(-d.x, -d.y)).rgb;
  vec3 tc = tex(uv + vec2(0.0, -d.y)).rgb;
  vec3 tr = tex(uv + vec2(d.x, -d.y)).rgb;
  vec3 ml = tex(uv + vec2(-d.x, 0.0)).rgb;
  vec3 mr = tex(uv + vec2(d.x, 0.0)).rgb;
  vec3 bl = tex(uv + vec2(-d.x, d.y)).rgb;
  vec3 bc = tex(uv + vec2(0.0, d.y)).rgb;
  vec3 br = tex(uv + vec2(d.x, d.y)).rgb;
  vec3 gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  vec3 gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return sqrt(gx * gx + gy * gy);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec2 d = vec2(max(thickness * u_px, 1.0)) / u_res;
  // A crisp edge plus a wider, fainter one that reads as glow.
  vec3 e = edgeRGB(uv, d) + 0.45 * edgeRGB(uv, d * 3.0);
  float m = max(e.r, max(e.g, e.b));
  vec3 hue = m > 0.0 ? pow(e / m, vec3(1.6)) : vec3(0.0);
  m = max(m - 0.04, 0.0);
  if (colorize > 0.5) hue = tint;
  vec3 neon = hue * (1.0 - exp(-m * gain * 1.5));
  vec3 res = clamp(rgb * backdrop + neon, 0.0, 1.0);
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'outline',
    name: 'Outline',
    category: 'stylize',
    params: [
      { key: 'thickness', label: 'Line width', type: 'float', default: 2, min: 0.5, max: 10, step: 0.1, unit: 'px' },
      { key: 'threshold', label: 'Sensitivity', type: 'float', default: 0.25, min: 0.02, max: 1.5, step: 0.01 },
      { key: 'ink', label: 'Colour', type: 'color', default: '#0a0a10' },
      AMOUNT,
    ],
    glsl: `${sobel('tex')}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  vec2 d = vec2(max(thickness * u_px, 1.0)) / u_res;
  float line = smoothstep(threshold, threshold + 0.25, sobel(uv, d)) * amount;
  return vec4(mix(rgb, ink, line) * c.a, c.a);
}`,
  },
  {
    id: 'emboss',
    name: 'Emboss',
    category: 'stylize',
    params: [
      { key: 'angle', label: 'Light angle', type: 'float', default: 135, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'depth', label: 'Depth', type: 'float', default: 2, min: 0.5, max: 12, step: 0.1, unit: 'px' },
      { key: 'strength', label: 'Strength', type: 'float', default: 2.5, min: 0, max: 8, step: 0.05 },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 0,
        options: [
          { label: 'Grey relief', value: 0 },
          { label: 'Keep colour', value: 1 },
        ],
      },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float a = radians(angle);
  vec2 d = vec2(cos(a), sin(a)) * max(depth * u_px, 0.75) / u_res;
  float e = (luma(tex(uv - d).rgb) - luma(tex(uv + d).rgb)) * strength;
  vec3 res = style < 0.5 ? vec3(clamp(0.5 + e, 0.0, 1.0)) : clamp(rgb + e, 0.0, 1.0);
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'cartoon',
    name: 'Cartoon',
    category: 'stylize',
    passes: 2,
    params: [
      { key: 'levels', label: 'Shades', type: 'int', default: 4, min: 2, max: 8, step: 1 },
      { key: 'smoothing', label: 'Smoothing', type: 'float', default: 8, min: 0, max: 30, step: 0.5, unit: 'px' },
      { key: 'edge', label: 'Line width', type: 'float', default: 1.8, min: 0.5, max: 8, step: 0.1, unit: 'px' },
      { key: 'lines', label: 'Line strength', type: 'float', default: 0.85, min: 0, max: 1, step: 0.01 },
      { key: 'vivid', label: 'Colour boost', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
      AMOUNT,
    ],
    glsl: `${sobel('orig')}
vec4 effect(vec2 uv) {
  if (u_pass == 0) {
    // Edge-preserving smoothing flattens textures into clean areas of colour.
    vec4 c0 = tex(uv);
    float r = smoothing * u_px;
    if (r < 0.3 || amount <= 0.0) return c0;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 o = vec2(float(x), float(y)) * 0.5;
        vec4 s = tex(uv + o * r / u_res);
        vec4 df = s - c0;
        float w = exp(-dot(o, o) * 1.5 - dot(df, df) * 18.0);
        acc += s * w;
        wsum += w;
      }
    }
    return acc / wsum;
  }
  vec4 base = orig(uv);
  vec4 c = tex(uv);
  if (amount <= 0.0 || base.a <= 0.0 || c.a <= 0.0) return base;
  vec3 hsv = rgb2hsv(c.rgb / c.a);
  float n = max(floor(levels + 0.5), 2.0);
  float v = hsv.z * n;
  hsv.z = (floor(v) + smoothstep(0.35, 0.65, fract(v))) / n;
  hsv.y = min(hsv.y * (1.0 + vivid), 1.0);
  vec3 rgb = hsv2rgb(hsv);
  vec2 d = vec2(max(edge * u_px, 1.0)) / u_res;
  float line = smoothstep(0.22, 0.6, sobel(uv, d)) * lines;
  rgb = mix(rgb, vec3(0.04, 0.04, 0.07), line);
  return vec4(mix(base.rgb / base.a, rgb, amount) * base.a, base.a);
}`,
  },
  {
    id: 'oil-paint',
    name: 'Oil Paint',
    category: 'stylize',
    passes: 2,
    params: [
      { key: 'radius', label: 'Brush size', type: 'float', default: 9, min: 0, max: 30, step: 0.5, unit: 'px' },
      { key: 'crisp', label: 'Edge definition', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'vivid', label: 'Colour boost', type: 'float', default: 0.2, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float r = radius * u_px * (u_pass == 0 ? 1.0 : 0.6);
  if (r < 0.25) return tex(uv);
  // Kuwahara-style painting: average four sectors around the pixel and favour the calmest one.
  // The second pass repeats it with a smaller, rotated brush to clean the strokes up.
  float turn = u_pass == 0 ? 0.0 : 0.7853982;
  float q = mix(2.0, 6.0, crisp);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec4 m = vec4(0.0);
    vec3 m2 = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float ang = turn + (float(k) + (float(i % 4) + 0.5) * 0.25) * 1.5707963;
      float rad = float(i / 4 + 1) / 3.0;
      vec4 s = tex(uv + vec2(cos(ang), sin(ang)) * rad * r / u_res);
      m += s;
      m2 += s.rgb * s.rgb;
    }
    m /= 12.0;
    m2 /= 12.0;
    vec3 v3 = max(m2 - m.rgb * m.rgb, 0.0);
    float w = pow(v3.r + v3.g + v3.b + 0.0002, -q);
    acc += m * w;
    wsum += w;
  }
  vec4 c = acc / wsum;
  if (u_pass == 1 && c.a > 0.0) {
    vec3 rgb = c.rgb / c.a;
    rgb = clamp(mix(vec3(luma(rgb)), rgb, 1.0 + vivid), 0.0, 1.0);
    c.rgb = rgb * c.a;
  }
  return c;
}`,
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'stylize',
    params: [
      { key: 'size', label: 'Tile size', type: 'float', default: 42, min: 4, max: 300, step: 1, unit: 'px' },
      {
        key: 'shape',
        label: 'Shape',
        type: 'select',
        default: 0,
        options: [
          { label: 'Hexagon', value: 0 },
          { label: 'Triangle', value: 1 },
          { label: 'Diamond', value: 2 },
          { label: 'Square', value: 3 },
        ],
      },
      { key: 'gap', label: 'Grout', type: 'float', default: 0.06, min: 0, max: 0.5, step: 0.01 },
      { key: 'grout', label: 'Grout colour', type: 'color', default: '#101016' },
    ],
    glsl: `
// Centre (xy, in tile units) of the tile containing p, and the distance to the tile's edge (z).
vec3 tileAt(vec2 p) {
  if (shape < 0.5) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 d = dot(a, a) < dot(b, b) ? a : b;
    vec2 ad = abs(d);
    return vec3(p - d, 0.5 - max(ad.x, dot(ad, vec2(0.5, 0.8660254))));
  }
  if (shape < 1.5) {
    // Equilateral triangles: skew to a unit grid and split every rhombus along its diagonal.
    vec2 q = vec2(p.x - p.y * 0.5773503, p.y * 1.1547005);
    vec2 id = floor(q);
    vec2 f = q - id;
    float up = step(1.0, f.x + f.y);
    vec2 cq = id + mix(vec2(1.0 / 3.0), vec2(2.0 / 3.0), up);
    float e = up > 0.5 ? min(min(1.0 - f.x, 1.0 - f.y), f.x + f.y - 1.0) : min(min(f.x, f.y), 1.0 - f.x - f.y);
    return vec3(cq.x + cq.y * 0.5, cq.y * 0.8660254, e * 0.8660254);
  }
  if (shape < 2.5) {
    vec2 q = vec2(p.x + p.y, p.y - p.x) * 0.7071068;
    vec2 id = floor(q) + 0.5;
    vec2 f = abs(q - id);
    return vec3((id.x - id.y) * 0.7071068, (id.x + id.y) * 0.7071068, 0.5 - max(f.x, f.y));
  }
  vec2 id = floor(p) + 0.5;
  vec2 f = abs(p - id);
  return vec3(id, 0.5 - max(f.x, f.y));
}
vec4 effect(vec2 uv) {
  float tile = max(size, 2.0) * (shape > 0.5 && shape < 1.5 ? 1.5 : 1.0);
  vec2 toUv = vec2(tile * u_px) / u_res;
  vec2 p0 = (uv - 0.5) / toUv;
  float pxw = 1.0 / (tile * u_px);
  float hw = gap * (shape > 0.5 && shape < 1.5 ? 0.29 : 0.5) * 0.5;
  // 4× supersampling anti-aliases the tile edges; every sample also reads a slightly different
  // spot of its tile so the tile colour is a stable average rather than a single texel.
  const vec2 OFF[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375), vec2(0.375, 0.125), vec2(-0.125, 0.375));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 t = tileAt(p0 + OFF[i] * pxw);
    vec4 s = tex((t.xy + OFF[i] * 0.3) * toUv + 0.5);
    float g = gap > 0.0 ? 1.0 - smoothstep(hw - pxw * 0.25, hw + pxw * 0.25, t.z) : 0.0;
    acc += mix(s, vec4(grout, 1.0) * s.a, g);
  }
  return acc * 0.25;
}`,
  },
  {
    id: 'stained-glass',
    name: 'Stained Glass',
    category: 'stylize',
    params: [
      { key: 'size', label: 'Pane size', type: 'float', default: 70, min: 12, max: 300, step: 1, unit: 'px' },
      { key: 'lead', label: 'Lead width', type: 'float', default: 4, min: 1, max: 20, step: 0.5, unit: 'px' },
      { key: 'vivid', label: 'Colour boost', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'shine', label: 'Glass shine', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec2 seedOf(vec2 cellId) { return 0.15 + 0.7 * hash22(cellId); }
vec4 effect(vec2 uv) {
  float pane = max(size, 6.0);
  vec2 toUv = vec2(pane * u_px) / u_res;
  vec2 p = uv / toUv;
  vec2 n = floor(p);
  vec2 f = p - n;
  // Nearest seed of a jittered grid, then the distance to the border with its neighbours.
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + seedOf(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + seedOf(n + g) - f;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 0.00001) bd = min(bd, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  vec2 site = (p + mr) * toUv;
  vec2 sp = toUv * 0.18;
  vec4 s = (tex(site) * 2.0 + tex(site + vec2(sp.x, 0.0)) + tex(site - vec2(sp.x, 0.0)) + tex(site + vec2(0.0, sp.y)) + tex(site - vec2(0.0, sp.y))) / 6.0;
  if (s.a <= 0.0) return vec4(0.0);
  vec3 rgb = s.rgb / s.a;
  rgb = mix(vec3(luma(rgb)), rgb, 1.0 + vivid);
  // Every pane catches the light a little differently and glows towards its middle.
  float rnd = hash21(n + mg + 3.7);
  rgb *= 0.88 + 0.24 * rnd;
  rgb += shine * 0.3 * smoothstep(0.0, 0.45, bd) * (0.35 + 0.65 * vnoise(p * 2.5 + rnd * 20.0));
  float aa = 1.0 / (pane * u_px);
  float hw = lead * 0.5 / pane;
  float line = 1.0 - smoothstep(hw - aa * 0.5, hw + aa * 0.5, bd);
  rgb = mix(clamp(rgb, 0.0, 1.0), vec3(0.06, 0.06, 0.08), line);
  return vec4(rgb * s.a, s.a);
}`,
  },
  {
    id: 'duotone',
    name: 'Duotone',
    category: 'stylize',
    params: [
      { key: 'shadow', label: 'Shadows', type: 'color', default: '#22145a' },
      { key: 'highlight', label: 'Highlights', type: 'color', default: '#ff8f6b' },
      { key: 'contrast', label: 'Contrast', type: 'float', default: 0.15, min: -0.5, max: 1, step: 0.01 },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float l = clamp((luma(rgb) - 0.5) * (1.0 + contrast) + 0.5, 0.0, 1.0);
  vec3 res = mix(shadow, highlight, l);
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'threshold',
    name: 'Threshold',
    category: 'stylize',
    params: [
      { key: 'level', label: 'Level', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'softness', label: 'Softness', type: 'float', default: 0.02, min: 0, max: 0.5, step: 0.005 },
      { key: 'ink', label: 'Dark', type: 'color', default: '#0c0c12' },
      { key: 'paper', label: 'Light', type: 'color', default: '#f6f3ea' },
      AMOUNT,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  float l = luma(rgb);
  // Never harder than one pixel of anti-aliasing, however low the softness.
  float w = max(softness * 0.5, fwidth(l) * 0.75) + 0.0005;
  vec3 res = mix(ink, paper, smoothstep(level - w, level + w, l));
  return vec4(mix(rgb, res, amount) * c.a, c.a);
}`,
  },
  {
    id: 'ascii-art',
    name: 'ASCII Art',
    category: 'stylize',
    params: [
      { key: 'size', label: 'Character size', type: 'float', default: 16, min: 6, max: 64, step: 1, unit: 'px' },
      {
        key: 'colorize',
        label: 'Colour',
        type: 'select',
        default: 0,
        options: [
          { label: 'From picture', value: 0 },
          { label: 'Tint', value: 1 },
        ],
      },
      { key: 'tint', label: 'Tint', type: 'color', default: '#4dff88' },
      { key: 'backdrop', label: 'Backdrop', type: 'float', default: 0.18, min: 0, max: 0.6, step: 0.01 },
      AMOUNT,
    ],
    glsl: `
const int GLYPHS[10] = int[10](${GLYPH_BITS.join(', ')});
// 1 where glyph g is inked at q (0..6: a 5×5 bitmap centred in the character cell).
float glyphAt(int g, vec2 q) {
  vec2 b = floor(q - 0.5);
  if (b.x < 0.0 || b.x > 4.0 || b.y < 0.0 || b.y > 4.0) return 0.0;
  int bit = int(b.x) + 5 * int(b.y);
  return float((GLYPHS[g] >> bit) & 1);
}
vec4 effect(vec2 uv) {
  vec4 base = tex(uv);
  if (amount <= 0.0) return base;
  float cell = max(size, 4.0) * u_px;
  vec2 q = uv * u_res / cell;
  vec2 id = floor(q);
  vec2 cuv = (id + 0.5) * cell / u_res;
  vec2 sp = vec2(cell * 0.25) / u_res;
  vec4 s = (tex(cuv + sp) + tex(cuv - sp) + tex(cuv + vec2(sp.x, -sp.y)) + tex(cuv + vec2(-sp.x, sp.y))) * 0.25;
  if (s.a <= 0.0) return base * (1.0 - amount);
  vec3 col = s.rgb / s.a;
  float l = luma(col);
  int g = int(clamp(floor(pow(l, 0.7) * 10.0), 0.0, 9.0));
  // 2×2 supersampling keeps the tiny glyph pixels clean at any size.
  float cov = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i & 1), float(i >> 1)) - 0.5) * 0.5;
    cov += glyphAt(g, fract(q + o / cell) * 6.0);
  }
  cov *= 0.25;
  // Characters too small to read fade to a plain tone.
  cov = mix(l, cov, clamp(cell / 4.0 - 1.0, 0.0, 1.0));
  float mx = max(col.r, max(col.g, col.b));
  vec3 inkCol = colorize < 0.5 ? mix(col, col / max(mx, 0.05), 0.85) : tint;
  vec3 res = mix(col * backdrop, inkCol, cov);
  vec4 outc = vec4(res * s.a, s.a);
  return mix(base, outc, amount);
}`,
  },
  {
    id: 'stroke',
    name: 'Stroke',
    category: 'stylize',
    passes: 3,
    params: [
      { key: 'width', label: 'Width', type: 'float', default: 8, min: 0, max: 60, step: 0.5, unit: 'px' },
      { key: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
      { key: 'amount', label: 'Opacity', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
// Grows the layer's silhouette by r real pixels (three rings of taps keep thin shapes intact).
float grow(vec2 uv, float r) {
  float a = tex(uv).a;
  for (int i = 0; i < 16; i++) {
    float ang = (float(i) + 0.5) * TAU / 16.0;
    vec2 d = vec2(cos(ang), sin(ang)) * r / u_res;
    a = max(a, tex(uv + d).a);
    a = max(a, tex(uv + rot2(0.19635) * d * 0.667).a);
    a = max(a, tex(uv + d * 0.333).a);
  }
  return a;
}
vec4 effect(vec2 uv) {
  float w = width * u_px;
  if (u_pass < 2) {
    if (w < 0.05 || amount <= 0.0) return tex(uv);
    // Two half-width dilations add up to a clean, round outline of the full width.
    return vec4(grow(uv, w * 0.5));
  }
  vec4 base = orig(uv);
  if (w < 0.05 || amount <= 0.0) return base;
  float a = max(tex(uv).a, base.a) * amount;
  // The layer sits on top of its outline.
  return base + vec4(color * a, a) * (1.0 - base.a);
}`,
  },
];

export default effects;
