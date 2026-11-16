import type { GeneratorDef, ParamDef } from '../types';

const speed = (def = 1): ParamDef => ({ key: 'speed', label: 'Speed', type: 'float', default: def, min: 0, max: 4, step: 0.05 });
const density = (def = 1): ParamDef => ({ key: 'density', label: 'Density', type: 'float', default: def, min: 0.3, max: 2.5, step: 0.05 });
const size = (def = 1): ParamDef => ({ key: 'size', label: 'Size', type: 'float', default: def, min: 0.3, max: 2, step: 0.05 });

/**
 * Particles live on jittered grids: one particle per cell, several layers of different scale for
 * depth. Travel offsets are wrapped with mod(…, 64) and cells are hashed modulo 64, so the motion
 * stays precise however long the clip runs. softDisc() never aliases: its edge is at least a pixel
 * wide and a particle smaller than a pixel dims instead of flickering.
 */
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
vec3 screenAdd(vec3 base, vec3 light) {
  return 1.0 - (1.0 - base) * (1.0 - clamp(light, 0.0, 1.0));
}
float softDisc(float d, float r, float soft, float px) {
  float w = max(r * soft, 1.5 * px);
  float g = min(r / (1.2 * px), 1.0);
  return (1.0 - smoothstep(r - 0.5 * w, r + 0.5 * w, d)) * g * g;
}`;

const generators: GeneratorDef[] = [
  {
    id: 'bokeh',
    name: 'Bokeh',
    category: 'particles',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#0d0f24' },
      { key: 'colorA', label: 'Color A', type: 'color', default: '#ffb86b' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#ff5c9d' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#6d8bff' },
      density(),
      size(),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  vec3 col = colorBg * (1.0 - 0.5 * dot(uv - 0.5, uv - 0.5));
  vec3 light = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float k = fl * 0.5;
    // Layer 0: few large, very soft discs close to the lens. Layer 2: many small, crisper ones.
    float cells = mix(2.0, 4.6, k) * density;
    vec2 g = p * cells + vec2(fl * 13.7, fl * 7.1);
    g.y += mod(t * 0.02 * (1.5 - 0.4 * fl) * cells, 64.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = mod(id + o, 64.0);
        vec2 h = hash22(cid + fl * 31.0);
        float h3 = hash21(cid * 1.7 + fl * 5.0 + 2.0);
        vec2 c = o + 0.5 + (h - 0.5) * 0.3 + 0.3 * vec2(sin(t * (0.2 + 0.3 * h.x) + TAU * h.y), cos(t * (0.17 + 0.25 * h.y) + TAU * h.x));
        float rad = mix(0.2, 0.4, h3) * size;
        float d = length(f - c);
        float disc = softDisc(d, rad, mix(0.55, 0.2, k), px * cells);
        // A slightly brighter rim, as real out-of-focus highlights have.
        float rim = 0.6 + 0.4 * smoothstep(rad * 0.5, rad * 0.95, d);
        float tw = 0.6 + 0.4 * sin(t * (0.4 + 0.8 * h3) + TAU * h.x);
        vec3 pc = h3 < 0.34 ? colorA : h3 < 0.67 ? colorB : colorC;
        light += pc * disc * rim * tw * mix(0.22, 0.4, k);
      }
    }
  }
  col = screenAdd(col, light);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'starfield',
    name: 'Starfield',
    category: 'particles',
    params: [
      { key: 'colorBg', label: 'Space', type: 'color', default: '#050714' },
      { key: 'colorA', label: 'Stars', type: 'color', default: '#eaf2ff' },
      { key: 'colorB', label: 'Nebula', type: 'color', default: '#4b2a8f' },
      density(),
      { key: 'twinkle', label: 'Twinkle', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  float dpx = designPx();
  // Faint nebula clouds give the black some depth.
  float neb = fbm(p * 1.3 + vec2(2.0, 5.0) + 0.3 * vec2(sin(t * 0.02), cos(t * 0.017)));
  float neb2 = fbm(p * 2.6 + vec2(9.0, 1.0));
  vec3 col = colorBg + colorB * (0.55 * pow(neb, 3.0) + 0.2 * pow(neb2, 4.0));
  float light = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float cells = mix(7.0, 22.0, fl * 0.5) * sqrt(density);
    vec2 g = p * cells + fl * 17.3;
    // Nearer layers drift faster: a slow parallax pan.
    g.x += mod(t * 0.006 * (3.0 - fl) * cells, 64.0);
    vec2 cid = mod(floor(g), 64.0);
    vec2 f = fract(g);
    vec2 h = hash22(cid + fl * 41.0);
    float h3 = hash21(cid * 1.3 + fl * 9.0 + 4.0);
    float d = length(f - (0.25 + 0.5 * h)) / cells;
    // Star radius in design pixels; never rendered thinner than a real pixel (it dims instead).
    float want = mix(0.9, 2.6, h3 * h3) * (1.0 - 0.25 * fl) * dpx;
    float r = max(want, 0.8 * px);
    float gain = want / r;
    float core = exp(-d * d / (r * r)) * gain;
    float halo = layer == 0 ? exp(-d / (r * 4.0)) * 0.2 * step(0.6, h3) : 0.0;
    float tw = 1.0 - twinkle * 0.6 * (0.5 + 0.5 * sin(t * (1.2 + 3.5 * h.x) + TAU * h.y));
    light += (core + halo) * tw * mix(1.0, 0.55, fl * 0.5);
  }
  col += colorA * light;
  return vec4(dither(min(col, 1.0), uv), 1.0);
}`,
  },
  {
    id: 'floating-dust',
    name: 'Floating Dust',
    category: 'particles',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#15110f' },
      { key: 'colorA', label: 'Dust', type: 'color', default: '#ffe6c2' },
      { key: 'colorB', label: 'Light Beam', type: 'color', default: '#b7783f' },
      density(),
      size(),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  // A soft diagonal shaft of light: motes glow while they cross it.
  float shaft = (p.x * 0.6 + p.y * 0.8 + 0.12) / 0.42;
  float beam = exp(-shaft * shaft);
  vec3 col = colorBg * (1.0 - 0.6 * dot(uv - 0.5, uv - 0.5)) + colorB * beam * 0.22;
  float light = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float k = fl * 0.5;
    float cells = mix(3.2, 9.0, k) * density;
    vec2 g = p * cells + fl * 11.0;
    g -= mod(t * vec2(0.012, -0.02) * (1.6 - 0.5 * fl) * cells, 64.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = mod(id + o, 64.0);
        vec2 h = hash22(cid + fl * 23.0);
        float h3 = hash21(cid * 1.9 + fl * 3.0 + 6.0);
        vec2 c = o + 0.5 + (h - 0.5) * 0.7 + 0.16 * vec2(sin(t * (0.3 + 0.4 * h.x) + TAU * h.y), cos(t * (0.25 + 0.3 * h.y) + TAU * h.x));
        // Near motes are large and out of focus, distant ones small and sharp.
        float rad = mix(0.03, 0.085, h3) * size * mix(1.8, 1.0, k);
        float disc = softDisc(length(f - c), rad, mix(0.95, 0.5, k), px * cells);
        float tw = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * (0.6 + h3) + TAU * h.x));
        light += disc * tw * mix(0.3, 0.75, k);
      }
    }
  }
  col = screenAdd(col, colorA * light * (0.35 + 1.1 * beam));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'snow',
    name: 'Snow',
    category: 'particles',
    params: [
      { key: 'colorA', label: 'Sky Top', type: 'color', default: '#1c2b4a' },
      { key: 'colorB', label: 'Sky Bottom', type: 'color', default: '#5f7fa8' },
      { key: 'colorC', label: 'Snow', type: 'color', default: '#ffffff' },
      density(),
      size(),
      { key: 'wind', label: 'Wind', type: 'float', default: 0.25, min: -1.5, max: 1.5, step: 0.01 },
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  vec3 col = mix(colorA, colorB, smoothstep(0.0, 1.0, uv.y));
  float light = 0.0;
  for (int layer = 0; layer < 4; layer++) {
    float fl = float(layer);
    float k = fl / 3.0;
    // k = 0: close, big, fast, blurry. k = 1: distant, small, slow.
    float cells = mix(5.0, 17.0, k) * density;
    float fall = mix(0.26, 0.08, k);
    vec2 g = p * cells + fl * 23.0;
    g -= mod(t * vec2(wind * fall, fall) * cells, 64.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = mod(id + o, 64.0);
        vec2 h = hash22(cid + fl * 37.0);
        float h3 = hash21(cid * 1.3 + fl * 7.0 + 1.0);
        vec2 c = o + 0.5 + (h - 0.5) * 0.6 + vec2(0.22 * sin(t * (0.6 + 0.8 * h.x) + TAU * h.y), 0.0);
        float rad = mix(0.035, 0.08, h3) * size;
        light += softDisc(length(f - c), rad, mix(0.95, 0.5, k), px * cells) * mix(0.95, 0.55, k) * (0.7 + 0.3 * h.x);
      }
    }
  }
  col = mix(col, colorC, clamp(light, 0.0, 1.0));
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    category: 'particles',
    params: [
      { key: 'colorA', label: 'Water Top', type: 'color', default: '#19b3c7' },
      { key: 'colorB', label: 'Water Bottom', type: 'color', default: '#0a2f6b' },
      { key: 'colorC', label: 'Bubbles', type: 'color', default: '#e6fbff' },
      density(),
      size(),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  vec3 col = mix(colorA, colorB, smoothstep(-0.1, 1.0, uv.y));
  // Soft light falling in from the surface.
  col += colorA * 0.25 * exp(-uv.y * 3.0) * (0.7 + 0.3 * sin(p.x * 5.0 + t * 0.4));
  float light = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float k = fl * 0.5;
    float cells = mix(3.0, 7.5, k) * density;
    vec2 g = p * cells + fl * 29.0;
    g.y += mod(t * mix(0.16, 0.07, k) * cells, 64.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float pc = px * cells;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = mod(id + o, 64.0);
        vec2 h = hash22(cid + fl * 19.0);
        float h3 = hash21(cid * 1.6 + fl * 4.0 + 8.0);
        float present = step(hash21(cid * 2.3 + fl * 11.0 + 7.0), 0.7);
        vec2 c = o + 0.5 + (h - 0.5) * 0.5 + vec2(0.16 * sin(t * (0.8 + h.x) + TAU * h.y), 0.0);
        float rad = mix(0.1, 0.3, h3 * h3) * size;
        vec2 q = f - c;
        float d = length(q);
        float body = softDisc(d, rad, 0.08, pc);
        // Thin bright rim, faint glassy body that thickens towards the edge, and a specular glint.
        float wall = max(0.09 * rad, 1.2 * pc);
        float rim = body * smoothstep(rad - 1.6 * wall, rad - 0.4 * wall, d);
        float fill = body * (0.05 + 0.1 * pow(clamp(d / rad, 0.0, 1.0), 3.0));
        float glint = softDisc(length(q - rad * vec2(-0.38, -0.42)), rad * 0.16, 0.9, pc) * body;
        light += (rim * 0.55 + fill + glint * 0.8) * present * mix(1.0, 0.6, k);
      }
    }
  }
  col = screenAdd(col, colorC * light);
  return vec4(dither(col, uv), 1.0);
}`,
  },
  {
    id: 'confetti',
    name: 'Confetti',
    category: 'particles',
    params: [
      { key: 'colorBg', label: 'Background', type: 'color', default: '#1a1440' },
      { key: 'colorA', label: 'Color A', type: 'color', default: '#ff5c8a' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#ffd166' },
      { key: 'colorC', label: 'Color C', type: 'color', default: '#3ddbd9' },
      { key: 'colorD', label: 'Color D', type: 'color', default: '#8f7bff' },
      density(),
      size(),
      speed(),
    ],
    glsl: `${GEN_LIB}
vec4 generate(vec2 uv) {
  vec2 p = frameUv(uv);
  float t = u_time * speed;
  float px = realPx();
  vec3 col = colorBg * (1.0 - 0.5 * dot(uv - 0.5, uv - 0.5));
  // Far layer first, so nearer pieces cover it.
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float k = fl * 0.5;
    float cells = mix(9.0, 4.2, k) * density;
    vec2 g = p * cells + fl * 19.0;
    g.y -= mod(t * mix(0.1, 0.22, k) * cells, 64.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float pc = px * cells;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = mod(id + o, 64.0);
        vec2 h = hash22(cid + fl * 43.0);
        float h3 = hash21(cid * 1.4 + fl * 6.0 + 3.0);
        float h4 = hash21(cid * 2.7 + fl * 13.0 + 9.0);
        vec2 c = o + 0.5 + (h - 0.5) * 0.6 + vec2(0.2 * sin(t * (0.7 + 0.9 * h.x) + TAU * h.y), 0.0);
        float spin = t * (0.8 + 1.6 * h3) * (h.x < 0.5 ? -1.0 : 1.0) + TAU * h.y;
        // Tumbling in depth is faked by squashing the short axis.
        float flip = cos(t * (1.5 + 2.5 * h4) + TAU * h3);
        vec2 l = rot2(spin) * (f - c);
        vec2 hs = vec2(0.19, 0.085 * abs(flip)) * size;
        float covX = clamp((hs.x - abs(l.x)) / pc + 0.5, 0.0, 1.0);
        float covY = clamp((hs.y - abs(l.y)) / pc + 0.5, 0.0, 1.0) - clamp((-hs.y - abs(l.y)) / pc + 0.5, 0.0, 1.0);
        vec3 pcol = h4 < 0.25 ? colorA : h4 < 0.5 ? colorB : h4 < 0.75 ? colorC : colorD;
        pcol *= (0.72 + 0.28 * flip) * mix(0.7, 1.0, k);
        col = mix(col, pcol, covX * covY * step(h3, 0.8));
      }
    }
  }
  return vec4(dither(col, uv), 1.0);
}`,
  },
];

export default generators;
