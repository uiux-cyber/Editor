import type { EffectDef } from '../types';

/** One line of a separable Gaussian: 21 bilinear taps spread over ±r real pixels. */
const GAUSS_LINE = `
vec4 gaussLine(vec2 uv, vec2 dir, float r) {
  if (r < 0.25) return tex(uv);
  float sigma = r * 0.5;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float o = float(i) / 10.0 * r;
    float w = exp(-0.5 * (o * o) / (sigma * sigma));
    acc += tex(uv + dir * o) * w;
    wsum += w;
  }
  return acc / wsum;
}`;

/** Only the highlights of the picture, with a soft knee around `threshold`. */
const BRIGHT = `
vec4 bright(vec2 uv) {
  vec4 c = tex(uv);
  return c * smoothstep(threshold - 0.1, threshold + 0.1, luma(c.rgb));
}`;

/** ±½ LSB of triangular noise: hides banding in smooth generated gradients. */
const DITHER = `
float dither() {
  return (hash21(gl_FragCoord.xy) + hash21(gl_FragCoord.xy + 71.3) - 1.0) / 255.0;
}`;

const CENTER = (x: number, y: number): EffectDef['params'] => [
  { key: 'centerX', label: 'Center X', type: 'float', default: x, min: 0, max: 100, step: 0.5, unit: '%' },
  { key: 'centerY', label: 'Center Y', type: 'float', default: y, min: 0, max: 100, step: 0.5, unit: '%' },
];

const effects: EffectDef[] = [
  {
    id: 'vignette',
    name: 'Vignette',
    category: 'light',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'size', label: 'Size', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
      { key: 'feather', label: 'Feather', type: 'float', default: 0.6, min: 0.02, max: 1.5, step: 0.01 },
      { key: 'roundness', label: 'Roundness', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
      { key: 'color', label: 'Colour', type: 'color', default: '#000000' },
    ],
    glsl: `${DITHER}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  // Roundness 0 follows the frame's shape, 1 is a true circle. The corner is always at distance 1.
  vec2 k = vec2(mix(1.0, u_aspect, roundness), 1.0);
  float d = length((uv - 0.5) * 2.0 * k) / length(k);
  float v = smoothstep(size, size + max(feather, 0.02), d);
  vec3 rgb = mix(c.rgb / c.a, color, v * amount) + dither();
  return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}`,
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    category: 'light',
    params: [
      { key: 'amount', label: 'Darkness', type: 'float', default: 0.75, min: 0, max: 1, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 35, min: 2, max: 150, step: 0.5, unit: '%' },
      { key: 'feather', label: 'Feather', type: 'float', default: 0.6, min: 0.01, max: 1, step: 0.01 },
      ...CENTER(50, 50),
      { key: 'tint', label: 'Light colour', type: 'color', default: '#fff4dc' },
    ],
    glsl: `${DITHER}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec2 d = (uv - vec2(centerX, centerY) * 0.01) * vec2(u_aspect, 1.0);
  float r = length(d) / max(radius * 0.01, 0.001);
  float f = max(feather, 0.01);
  float m = 1.0 - smoothstep(1.0 - f, 1.0 + f, r);
  vec3 rgb = c.rgb / c.a;
  // Inside the pool the picture takes on the lamp's colour; outside it falls into shadow.
  vec3 lit = mix(rgb, rgb * tint * 1.15, amount);
  rgb = mix(rgb * (1.0 - amount), lit, m) + dither();
  return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}`,
  },
  {
    id: 'soft-focus',
    name: 'Soft Focus',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Glow', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 28, min: 1, max: 160, step: 1, unit: 'px' },
      { key: 'soften', label: 'Soften detail', type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${GAUSS_LINE}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    // A blurred copy is screened over the sharp picture, which lets the highlights bloom while
    // the detail underneath stays readable.
    vec4 bl = tex(uv);
    vec4 soft = mix(base, bl, soften * min(amount * 2.0, 1.0));
    vec3 rgb = soft.rgb + bl.rgb * amount * 0.8 * (1.0 - soft.rgb);
    return vec4(rgb, soft.a + min(1.0, bl.a * amount * 0.8) * (1.0 - soft.a));
  }
  if (amount <= 0.0) return tex(uv);
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  return gaussLine(uv, dir, radius * u_px);
}`,
  },
  {
    id: 'anamorphic-streaks',
    name: 'Anamorphic Streaks',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 0.9, min: 0, max: 3, step: 0.01 },
      { key: 'streak', label: 'Length', type: 'float', default: 280, min: 10, max: 900, step: 5, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.78, min: 0, max: 1, step: 0.01 },
      { key: 'tint', label: 'Tint', type: 'color', default: '#5aa8ff' },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: -90, max: 90, step: 1, unit: '°' },
    ],
    glsl: `${BRIGHT}
vec4 effect(vec2 uv) {
  float len = streak * u_px;
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    // The streak takes the lens coating's colour but keeps a little of its source.
    vec4 s = tex(uv);
    vec3 flare = mix(s.rgb, tint * luma(s.rgb) * 1.6, 0.75) * amount;
    vec3 rgb = base.rgb + flare * (1.0 - base.rgb);
    return vec4(rgb, base.a + min(1.0, max(flare.r, max(flare.g, flare.b))) * (1.0 - base.a));
  }
  if (amount <= 0.0) return tex(uv);
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a)) / u_res;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  if (u_pass == 0) {
    // Highlights are smeared along the streak with long exponential tails.
    for (int i = -14; i <= 14; i++) {
      float f = float(i) / 14.0;
      float w = exp(-abs(f) * 3.5);
      acc += bright(uv + dir * f * len) * w;
      wsum += w;
    }
    return min(acc / wsum * 3.0, vec4(1.0));
  }
  // A second, short blur fills the gaps between those taps.
  float gap = len / 14.0;
  if (gap < 1.0) return tex(uv);
  for (int i = -10; i <= 10; i++) {
    float f = float(i) / 10.0;
    float w = exp(-f * f * 2.5);
    acc += tex(uv + dir * f * gap) * w;
    wsum += w;
  }
  return acc / wsum;
}`,
  },
  {
    id: 'god-rays',
    name: 'God Rays',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 1, min: 0, max: 3, step: 0.01 },
      { key: 'reach', label: 'Length', type: 'float', default: 0.6, min: 0.05, max: 1, step: 0.01 },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.72, min: 0, max: 1, step: 0.01 },
      ...CENTER(50, 25),
      { key: 'tint', label: 'Tint', type: 'color', default: '#fff1cf' },
    ],
    glsl: `${BRIGHT}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    vec3 rays = tex(uv).rgb * tint * amount;
    vec3 rgb = base.rgb + rays * (1.0 - base.rgb);
    return vec4(rgb, base.a + min(1.0, max(rays.r, max(rays.g, rays.b))) * (1.0 - base.a));
  }
  if (amount <= 0.0) return tex(uv);
  vec2 d = vec2(centerX, centerY) * 0.01 - uv;
  vec4 acc = vec4(0.0);
  if (u_pass == 0) {
    // March from each pixel towards the light, gathering highlights that fade with distance.
    float wsum = 0.0;
    for (int i = 0; i < 28; i++) {
      float f = float(i) / 27.0;
      float w = (1.0 - f) * (1.0 - f);
      acc += bright(uv + d * f * reach) * w;
      wsum += w;
    }
    return min(acc / wsum * 1.6, vec4(1.0));
  }
  // A short second march along the same ray fills the gaps between the first one's steps.
  float gap = reach / 27.0;
  if (length(d * u_res) * gap < 1.0) return tex(uv);
  for (int i = -6; i <= 6; i++) {
    acc += tex(uv + d * (float(i) / 12.0) * gap);
  }
  return acc / 13.0;
}`,
  },
  {
    id: 'dirty-lens-glow',
    name: 'Dirty Lens Glow',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 1, min: 0, max: 3, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 70, min: 4, max: 250, step: 1, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'dirt', label: 'Lens dirt', type: 'float', default: 0.7, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${GAUSS_LINE}${BRIGHT}
// Specks and smudges on the front element. They belong to the lens, so they stay fixed to the frame.
float lensDirt(vec2 uv) {
  vec2 p = uv * vec2(u_aspect, 1.0);
  float acc = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 g = p * (3.0 + fk * 2.5) + fk * 13.7;
    vec2 id = floor(g);
    vec2 f = g - id;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 cid = id + o + fk * 31.0;
        vec2 rnd = hash22(cid);
        float r = 0.15 + 0.4 * hash21(cid + 5.0);
        float d = length(f - o - rnd);
        // An out-of-focus speck: a soft disc with a slightly brighter rim.
        float disc = (1.0 - smoothstep(r * 0.85, r, d)) * (0.55 + 0.45 * smoothstep(r * 0.5, r * 0.95, d));
        acc += disc * step(0.45, hash21(cid + 9.0)) * (0.3 + 0.7 * rnd.x);
      }
    }
  }
  float smudge = fbm(p * 2.5 + 7.0);
  return clamp(acc * 0.45 + smudge * smudge * 0.6, 0.0, 1.0);
}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    // The bloom lights the dirt up; clean glass only passes a faint veil of it.
    vec3 halo = tex(uv).rgb * amount * (1.0 - 0.6 * dirt + 2.2 * dirt * lensDirt(uv));
    halo = min(halo, vec3(1.0));
    vec3 rgb = base.rgb + halo * (1.0 - base.rgb);
    return vec4(rgb, base.a + max(halo.r, max(halo.g, halo.b)) * (1.0 - base.a));
  }
  if (amount <= 0.0) return tex(uv);
  float r = radius * u_px;
  float sigma = max(r * 0.5, 0.001);
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  if (u_pass == 1) return gaussLine(uv, dir, r);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float o = float(i) / 10.0 * r;
    float w = exp(-0.5 * (o * o) / (sigma * sigma));
    acc += bright(uv + dir * o) * w;
    wsum += w;
  }
  return acc / wsum;
}`,
  },
  {
    id: 'lens-flare',
    name: 'Lens Flare',
    category: 'light',
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 1, min: 0, max: 2, step: 0.01 },
      { key: 'posX', label: 'Light X', type: 'float', default: 25, min: 0, max: 100, step: 0.5, unit: '%' },
      { key: 'posY', label: 'Light Y', type: 'float', default: 25, min: 0, max: 100, step: 0.5, unit: '%' },
      { key: 'size', label: 'Size', type: 'float', default: 1, min: 0.3, max: 3, step: 0.01 },
      { key: 'streak', label: 'Streak', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'tint', label: 'Tint', type: 'color', default: '#ffd9a0' },
    ],
    glsl: `${DITHER}
// p and lp are aspect-corrected positions relative to the frame centre, in frame heights.
vec3 flare(vec2 p, vec2 lp) {
  float s = max(size, 0.05);
  vec2 d = p - lp;
  float r = length(d);
  // Hot core and a soft glow around it.
  vec3 col = vec3(exp(-r * r / (0.0009 * s * s))) + tint * 0.5 * exp(-r / (0.11 * s));
  // Starburst: six regular blades plus thinner, uneven rays.
  float ang = atan(d.y, d.x);
  float rays = pow(0.5 + 0.5 * sin(ang * 6.0 + 0.6), 8.0) * 0.6 + pow(vnoise(d / max(r, 0.0001) * 3.5 + 20.0), 3.0) * 0.5;
  col += tint * rays * exp(-r / (0.2 * s)) * 0.5;
  // Anamorphic streak and a faint halo ring with a hint of dispersion.
  col += vec3(0.5, 0.7, 1.0) * streak * exp(-abs(d.y) / (0.006 * s)) * exp(-abs(d.x) / (0.6 * s)) * 0.6;
  vec3 ring = (vec3(r) - vec3(0.33, 0.345, 0.36) * s) / (0.012 * s);
  col += exp(-ring * ring) * tint * 0.12;
  // Ghosts: reflections strung along the line through the frame centre.
  const float GK[5] = float[5](0.55, 0.2, -0.3, -0.6, -1.0);
  const float GR[5] = float[5](0.05, 0.03, 0.08, 0.045, 0.13);
  const vec3 GC[5] = vec3[5](vec3(0.6, 0.9, 0.5), vec3(1.0, 0.7, 0.4), vec3(0.4, 0.6, 1.0), vec3(1.0, 0.5, 0.6), vec3(0.5, 0.8, 0.9));
  for (int i = 0; i < 5; i++) {
    float gr = GR[i] * s;
    float gd = length(p - lp * GK[i]);
    float disc = (1.0 - smoothstep(gr * 0.75, gr, gd)) * (0.5 + 0.5 * smoothstep(gr * 0.2, gr, gd));
    col += GC[i] * disc * 0.13;
  }
  return col;
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec2 asp = vec2(u_aspect, 1.0);
  vec3 fl = clamp(flare((uv - 0.5) * asp, (vec2(posX, posY) * 0.01 - 0.5) * asp) * amount, 0.0, 1.0);
  vec3 rgb = 1.0 - (1.0 - c.rgb / c.a) * (1.0 - fl) + dither();
  return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}`,
  },
  {
    id: 'light-leak',
    name: 'Light Leak',
    category: 'light',
    animated: true,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 0.9, min: 0, max: 1.5, step: 0.01 },
      { key: 'angle', label: 'Direction', type: 'float', default: 160, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'spread', label: 'Spread', type: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.5, min: 0, max: 3, step: 0.05 },
      { key: 'colorA', label: 'Colour 1', type: 'color', default: '#ff7a2f' },
      { key: 'colorB', label: 'Colour 2', type: 'color', default: '#ff2f6d' },
    ],
    glsl: `${DITHER}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
  float t = u_time * speed;
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  // side runs from -1 at the far edge to 1 at the edge the light comes in from.
  float side = dot(p, dir) / (0.5 * (abs(dir.x) * u_aspect + abs(dir.y)));
  float along = dot(p, vec2(-dir.y, dir.x));
  // Slowly rolling clouds of light shape the edge of the leak and its colour.
  float n1 = fbm(vec2(along * 1.2 + t * 0.35, t * 0.22 + 3.0));
  float n2 = fbm(vec2(along * 2.1 - t * 0.28, side * 1.5 + t * 0.17 + 11.0));
  float leak = smoothstep(mix(1.0, -1.0, spread), 1.2, side + (n1 - 0.5) * 1.4);
  leak *= (0.55 + 0.45 * n2) * (0.75 + 0.25 * sin(t * 1.3 + n1 * 4.0));
  vec3 col = mix(colorA, colorB, clamp(n2 * 1.6 - 0.3 + side * 0.2, 0.0, 1.0));
  vec3 rgb = 1.0 - (1.0 - c.rgb / c.a) * (1.0 - min(col * leak * amount, vec3(1.0))) + dither();
  return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}`,
  },
  {
    id: 'light-sweep',
    name: 'Light Sweep',
    category: 'light',
    animated: true,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 0.8, min: 0, max: 2, step: 0.01 },
      { key: 'angle', label: 'Angle', type: 'float', default: 20, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'width', label: 'Width', type: 'float', default: 160, min: 10, max: 800, step: 5, unit: 'px' },
      { key: 'interval', label: 'Interval', type: 'float', default: 3, min: 0.2, max: 20, step: 0.1, unit: 's' },
      { key: 'sweepTime', label: 'Sweep time', type: 'float', default: 1.2, min: 0.1, max: 10, step: 0.05, unit: 's' },
      { key: 'tint', label: 'Colour', type: 'color', default: '#ffffff' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 frame = u_res / u_px;
  vec2 p = (uv - 0.5) * frame;
  // The band starts and ends just outside the frame, then waits for the next interval.
  float span = 0.5 * (abs(dir.x) * frame.x + abs(dir.y) * frame.y) + width * 1.5;
  float k = clamp(mod(u_time, max(interval, 0.05)) / max(sweepTime, 0.01), 0.0, 1.0);
  float d = (dot(p, dir) - mix(-span, span, k)) / max(width, 1.0);
  // A soft body with a crisp core, like light glancing off a polished surface.
  float band = exp(-d * d * 3.0) * 0.7 + exp(-d * d * 40.0) * 0.5;
  vec3 rgb = 1.0 - (1.0 - c.rgb / c.a) * (1.0 - min(tint * band * amount, vec3(1.0)));
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    category: 'light',
    passes: 4,
    animated: true,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 1.2, min: 0, max: 3, step: 0.01 },
      { key: 'size', label: 'Ray length', type: 'float', default: 70, min: 8, max: 400, step: 1, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'float', default: 0.8, min: 0, max: 1, step: 0.01 },
      { key: 'speed', label: 'Twinkle speed', type: 'float', default: 1, min: 0, max: 5, step: 0.05 },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: -90, max: 90, step: 1, unit: '°' },
      { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff' },
    ],
    glsl: `
vec4 glintSource(vec2 uv) {
  vec4 c = orig(uv);
  return c * smoothstep(threshold - 0.06, threshold + 0.06, luma(c.rgb));
}
// One arm pair of the star: highlights smeared along dir with a sharp peak and a long tail.
vec4 rays(vec2 uv, vec2 dir, float len) {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float f = float(i) / 12.0;
    float w = exp(-abs(f) * 4.0);
    acc += glintSource(uv + dir * f * len) * w;
    wsum += w;
  }
  return min(acc / wsum * 3.5, vec4(1.0));
}
vec4 effect(vec2 uv) {
  float len = size * u_px;
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  if (u_pass == 3) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    // Neighbouring glints twinkle out of step with each other.
    float t = u_time * speed;
    vec2 p = uv * u_res / u_px;
    float tw = speed > 0.0 ? pow(vnoise(p / 90.0 + vec2(t * 0.9, -t * 0.6)) * 1.5, 2.0) : 1.0;
    vec3 add = min(tex(uv).rgb * tint * amount * tw, vec3(1.0));
    vec3 rgb = base.rgb + add * (1.0 - base.rgb);
    return vec4(rgb, base.a + max(add.r, max(add.g, add.b)) * (1.0 - base.a));
  }
  if (amount <= 0.0) return tex(uv);
  // Every highlight throws a four-point star: one pass per pair of arms...
  if (u_pass == 0) return rays(uv, dir / u_res, len);
  if (u_pass == 1) return min(tex(uv) + rays(uv, vec2(-dir.y, dir.x) / u_res, len), vec4(1.0));
  // ...and a small blur that fills the gaps between the taps along each arm.
  float gap = len / 12.0;
  if (gap < 1.0) return tex(uv);
  vec4 acc = vec4(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      acc += tex(uv + (dir * float(i) + vec2(-dir.y, dir.x) * float(j)) * gap * 0.2 / u_res);
    }
  }
  return acc / 25.0;
}`,
  },
  {
    id: 'strobe',
    name: 'Strobe',
    category: 'light',
    animated: true,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 0.85, min: 0, max: 1, step: 0.01 },
      { key: 'rate', label: 'Rate', type: 'float', default: 3, min: 0.25, max: 30, step: 0.25, unit: 'Hz' },
      { key: 'duty', label: 'Flash length', type: 'float', default: 0.5, min: 0.05, max: 1, step: 0.01 },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Flash', value: 0 },
          { label: 'Blackout', value: 1 },
          { label: 'Negative', value: 2 },
        ],
      },
      { key: 'color', label: 'Flash colour', type: 'color', default: '#ffffff' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  // Each flash snaps on and decays over its share of the cycle, like a real strobe tube.
  float ph = fract(u_time * rate);
  float f = ph < duty ? pow(1.0 - ph / max(duty, 0.001), 1.5) * amount : 0.0;
  vec3 rgb = c.rgb / c.a;
  if (mode < 0.5) rgb = 1.0 - (1.0 - rgb) * (1.0 - color * f);
  else if (mode < 1.5) rgb *= 1.0 - f;
  else rgb = mix(rgb, 1.0 - rgb, f);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'flicker',
    name: 'Flicker',
    category: 'light',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: 'speed', label: 'Speed', type: 'float', default: 8, min: 0.5, max: 40, step: 0.5 },
      { key: 'warmth', label: 'Warm dips', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  if (amount <= 0.0 || c.a <= 0.0) return c;
  float t = u_time * speed;
  // A restless lamp: slow drift, quicker shimmer and the odd sharp dip.
  float n = vnoise(vec2(t, 3.7)) * 0.6 + vnoise(vec2(t * 3.1, 9.2)) * 0.4;
  float dip = smoothstep(0.8, 0.95, vnoise(vec2(t * 1.7, 21.0)));
  float k = amount * ((n - 0.5) * 0.8 - dip * 0.5);
  // Like a filament, the light turns warmer as it dims.
  vec3 warm = mix(vec3(1.0), vec3(1.06, 1.0, 0.88), clamp(-k * 2.0, 0.0, 1.0) * warmth);
  c.rgb = min(c.rgb * (1.0 + k) * warm, vec3(c.a));
  return c;
}`,
  },
  {
    id: 'outer-glow',
    name: 'Outer Glow',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Intensity', type: 'float', default: 1.6, min: 0, max: 4, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 40, min: 1, max: 200, step: 1, unit: 'px' },
      { key: 'color', label: 'Colour', type: 'color', default: '#ff3df2' },
    ],
    glsl: `${GAUSS_LINE}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    // The blurred silhouette becomes a coloured halo that sits behind the layer.
    float h = clamp(tex(uv).a * amount, 0.0, 1.0);
    return base + vec4(color * h, h) * (1.0 - base.a);
  }
  if (amount <= 0.0) return tex(uv);
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  return gaussLine(uv, dir, radius * u_px);
}`,
  },
  {
    id: 'drop-shadow',
    name: 'Drop Shadow',
    category: 'light',
    passes: 3,
    params: [
      { key: 'amount', label: 'Opacity', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'dist', label: 'Distance', type: 'float', default: 16, min: 0, max: 200, step: 0.5, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'float', default: 45, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'softness', label: 'Softness', type: 'float', default: 18, min: 0, max: 150, step: 0.5, unit: 'px' },
      { key: 'color', label: 'Colour', type: 'color', default: '#000000' },
    ],
    glsl: `${GAUSS_LINE}
vec4 effect(vec2 uv) {
  if (u_pass == 2) {
    vec4 base = orig(uv);
    if (amount <= 0.0) return base;
    float sh = tex(uv).a * amount;
    return base + vec4(color * sh, sh) * (1.0 - base.a);
  }
  if (amount <= 0.0) return tex(uv);
  // Pass 0 also moves the silhouette to where the shadow falls.
  float a = radians(angle);
  vec2 off = u_pass == 0 ? vec2(cos(a), sin(a)) * dist * u_px / u_res : vec2(0.0);
  vec2 dir = (u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / u_res;
  return gaussLine(uv - off, dir, softness * u_px);
}`,
  },
];

export default effects;
