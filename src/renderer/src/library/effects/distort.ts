import type { EffectDef } from '../types';

const CENTER_PARAMS: EffectDef['params'] = [
  { key: 'centerX', label: 'Center X', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
  { key: 'centerY', label: 'Center Y', type: 'float', default: 50, min: 0, max: 100, step: 0.5, unit: '%' },
];

const effects: EffectDef[] = [
  {
    id: 'wave',
    name: 'Wave',
    category: 'distort',
    animated: true,
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'float', default: 18, min: 0, max: 200, step: 0.5, unit: 'px' },
      { key: 'wavelength', label: 'Wavelength', type: 'float', default: 260, min: 10, max: 2000, step: 1, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.5, min: -4, max: 4, step: 0.05 },
      {
        key: 'axis',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontal', value: 0 },
          { label: 'Vertical', value: 1 },
          { label: 'Both', value: 2 },
        ],
      },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amp = amplitude * u_px;
  if (amp < 0.01) return tex(uv);
  vec2 p = uv * u_res / u_px;
  float k = TAU / max(wavelength, 2.0);
  float t = fract(u_time * speed) * TAU;
  vec2 o = vec2(0.0);
  if (axis < 0.5 || axis > 1.5) o.x = sin(p.y * k + t);
  if (axis > 0.5) o.y = sin(p.x * k + t + (axis > 1.5 ? 1.7 : 0.0));
  return texM(uv + o * amp / u_res);
}`,
  },
  {
    id: 'ripple',
    name: 'Ripple',
    category: 'distort',
    animated: true,
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'float', default: 14, min: 0, max: 120, step: 0.5, unit: 'px' },
      { key: 'wavelength', label: 'Wavelength', type: 'float', default: 130, min: 10, max: 1000, step: 1, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 1, min: -4, max: 4, step: 0.05 },
      { key: 'falloff', label: 'Falloff', type: 'float', default: 1, min: 0, max: 4, step: 0.05 },
      { key: 'shine', label: 'Highlights', type: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
      ...CENTER_PARAMS,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amp = amplitude * u_px;
  if (amp < 0.01) return tex(uv);
  vec2 c = vec2(centerX, centerY) * 0.01;
  vec2 d = (uv - c) * u_res / u_px;
  float r = length(d);
  float wl = max(wavelength, 2.0);
  float ph = r * TAU / wl - fract(u_time * speed) * TAU;
  // Rings fade with distance; the very centre is eased so the origin does not pinch.
  float fall = exp(-falloff * r / 500.0) * smoothstep(0.0, wl * 0.5, r);
  vec2 dir = r > 0.0 ? d / r : vec2(0.0);
  vec4 col = texM(uv + dir * sin(ph) * amp * fall / u_res);
  // The slope of each ring catches a little light.
  col.rgb = clamp(col.rgb + col.a * cos(ph) * fall * shine * 0.14, vec3(0.0), vec3(col.a));
  return col;
}`,
  },
  {
    id: 'bulge',
    name: 'Bulge & Pinch',
    category: 'distort',
    params: [
      { key: 'strength', label: 'Strength', type: 'float', default: 0.55, min: -1, max: 1, step: 0.01 },
      { key: 'radius', label: 'Radius', type: 'float', default: 45, min: 1, max: 150, step: 0.5, unit: '%' },
      ...CENTER_PARAMS,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (abs(strength) < 0.0005) return tex(uv);
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 c = vec2(centerX, centerY) * 0.01;
  vec2 d = (uv - c) * asp;
  float r = length(d) / max(radius * 0.01, 0.001);
  if (r >= 1.0) return tex(uv);
  // Positive values magnify the middle (up to 4×), negative values pull the picture inwards.
  // The warp meets the untouched picture with matching slope, so there is no visible rim.
  float k = strength > 0.0 ? strength * 0.75 : strength;
  float w = 1.0 - r * r;
  return texM(c + d * (1.0 - k * w * w) / asp);
}`,
  },
  {
    id: 'swirl',
    name: 'Swirl',
    category: 'distort',
    params: [
      { key: 'angle', label: 'Twist', type: 'float', default: 140, min: -720, max: 720, step: 1, unit: '°' },
      { key: 'radius', label: 'Radius', type: 'float', default: 50, min: 1, max: 150, step: 0.5, unit: '%' },
      ...CENTER_PARAMS,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float a = radians(angle);
  if (abs(a) < 0.0005) return tex(uv);
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 c = vec2(centerX, centerY) * 0.01;
  vec2 d = (uv - c) * asp;
  float r = length(d) / max(radius * 0.01, 0.001);
  if (r >= 1.0) return tex(uv);
  float w = 1.0 - r;
  return texM(c + (rot2(a * w * w) * d) / asp);
}`,
  },
  {
    id: 'fisheye',
    name: 'Fisheye',
    category: 'distort',
    params: [
      { key: 'strength', label: 'Strength', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: 'circle', label: 'Circular frame', type: 'bool', default: false },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (strength <= 0.0005) return tex(uv);
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 d = (uv - 0.5) * asp;
  // Normalise so the frame corners (or the circle's rim) stay where they are.
  float rmax = circle > 0.5 ? 0.5 : 0.5 * length(asp);
  float r = length(d) / rmax;
  float a = strength * 1.35;
  float s = r > 0.001 ? tan(min(r, 1.1) * a) / (tan(a) * r) : a / tan(a);
  vec4 col = texM(0.5 + d * s / asp);
  if (circle > 0.5) {
    float m = clamp((length(d) - 0.5) * u_res.y + 0.5, 0.0, 1.0);
    col = mix(col, vec4(0.0, 0.0, 0.0, 1.0) * tex(uv).a, m);
  }
  return col;
}`,
  },
  {
    id: 'lens-distortion',
    name: 'Lens Distortion',
    category: 'distort',
    params: [
      { key: 'amount', label: 'Barrel / pincushion', type: 'float', default: 0.4, min: -1, max: 1, step: 0.01 },
      { key: 'fringe', label: 'Colour fringing', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (abs(amount) < 0.0005) return tex(uv);
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 d = (uv - 0.5) * asp;
  float r2 = dot(d, d) / (0.25 * dot(asp, asp));
  // Barrel keeps the corners in place; pincushion zooms in just enough to stay inside the frame.
  float k = amount > 0.0 ? amount * 0.9 : amount * 0.3;
  float norm = amount > 0.0 ? 1.0 / (1.0 + k) : 1.0;
  vec3 ks = k * (1.0 + fringe * 0.1 * vec3(-1.0, 0.0, 1.0));
  vec4 cr = tex(0.5 + d * (1.0 + ks.r * r2) * norm / asp);
  vec4 cg = tex(0.5 + d * (1.0 + ks.g * r2) * norm / asp);
  vec4 cb = tex(0.5 + d * (1.0 + ks.b * r2) * norm / asp);
  return vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
}`,
  },
  {
    id: 'mirror',
    name: 'Mirror',
    category: 'distort',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left onto right', value: 0 },
          { label: 'Right onto left', value: 1 },
          { label: 'Top onto bottom', value: 2 },
          { label: 'Bottom onto top', value: 3 },
          { label: 'Quad', value: 4 },
        ],
      },
      { key: 'pos', label: 'Mirror line', type: 'float', default: 50, min: 5, max: 95, step: 0.5, unit: '%' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float a = pos * 0.01;
  vec2 q = uv;
  if (mode < 0.5) q.x = a - abs(uv.x - a);
  else if (mode < 1.5) q.x = a + abs(uv.x - a);
  else if (mode < 2.5) q.y = a - abs(uv.y - a);
  else if (mode < 3.5) q.y = a + abs(uv.y - a);
  else q = a - abs(uv - a);
  return texM(q);
}`,
  },
  {
    id: 'kaleidoscope',
    name: 'Kaleidoscope',
    category: 'distort',
    animated: true,
    params: [
      { key: 'segments', label: 'Segments', type: 'int', default: 6, min: 2, max: 24, step: 1 },
      { key: 'rotation', label: 'Rotation', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'spin', label: 'Spin', type: 'float', default: 10, min: -180, max: 180, step: 1, unit: '°/s' },
      { key: 'zoom', label: 'Zoom', type: 'float', default: 1, min: 0.25, max: 4, step: 0.01 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 d = (uv - 0.5) * asp;
  float seg = PI / max(floor(segments + 0.5), 1.0);
  // Fold the angle into one wedge and mirror every other one, so all seams are continuous.
  float a = atan(d.y, d.x) + radians(rotation);
  a = abs(mod(a, 2.0 * seg) - seg);
  // The source picture turns slowly underneath the mirrors.
  a += radians(mod(u_time * spin, 360.0));
  vec2 q = vec2(cos(a), sin(a)) * length(d) / max(zoom, 0.05);
  return texM(0.5 + q / asp);
}`,
  },
  {
    id: 'tile',
    name: 'Tile',
    category: 'distort',
    params: [
      { key: 'cols', label: 'Columns', type: 'int', default: 3, min: 1, max: 12, step: 1 },
      { key: 'rows', label: 'Rows', type: 'int', default: 3, min: 1, max: 12, step: 1 },
      { key: 'mirrored', label: 'Mirror alternate tiles', type: 'bool', default: false },
      { key: 'gap', label: 'Gap', type: 'float', default: 0, min: 0, max: 80, step: 0.5, unit: 'px' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 n = max(floor(vec2(cols, rows) + 0.5), 1.0);
  vec2 q = uv * n;
  vec2 id = floor(q);
  vec2 f = q - id;
  vec2 tilePx = u_res / n;
  float g = gap * u_px * 0.5;
  vec2 e = min(f, 1.0 - f) * tilePx;
  float m = gap > 0.0 ? clamp(min(e.x, e.y) - g + 0.5, 0.0, 1.0) : 1.0;
  vec2 s = (f * tilePx - g) / max(tilePx - 2.0 * g, vec2(1.0));
  if (mirrored > 0.5) s = mix(s, 1.0 - s, mod(id, 2.0));
  // 3×3 taps box-filter the shrunken picture so fine detail does not shimmer.
  vec2 st = (n - 1.0) / u_res / 3.0;
  vec4 acc = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      acc += tex(clamp(s + vec2(float(i), float(j)) * st, 0.0, 1.0));
    }
  }
  return acc / 9.0 * m;
}`,
  },
  {
    id: 'stretch',
    name: 'Stretch',
    category: 'distort',
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.55, min: -1, max: 1, step: 0.01 },
      {
        key: 'axis',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontal', value: 0 },
          { label: 'Vertical', value: 1 },
          { label: 'Both', value: 2 },
        ],
      },
    ],
    glsl: `
// Positive k stretches the middle and squeezes the edges; negative k does the opposite.
float warp(float u, float k) {
  float t = u * 2.0 - 1.0;
  return (t + k * (t * t * t - t)) * 0.5 + 0.5;
}
vec4 effect(vec2 uv) {
  if (abs(amount) < 0.0005) return tex(uv);
  float k = amount > 0.0 ? amount * 0.9 : amount * 0.5;
  vec2 q = uv;
  if (axis < 0.5 || axis > 1.5) q.x = warp(uv.x, k);
  if (axis > 0.5) q.y = warp(uv.y, k);
  return tex(q);
}`,
  },
  {
    id: 'heat-haze',
    name: 'Heat Haze',
    category: 'distort',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 8, min: 0, max: 60, step: 0.5, unit: 'px' },
      { key: 'scale', label: 'Scale', type: 'float', default: 60, min: 8, max: 400, step: 1, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 1, min: 0, max: 5, step: 0.05 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amt = amount * u_px;
  if (amt < 0.01) return tex(uv);
  vec2 p = uv * u_res / (u_px * max(scale, 2.0));
  float t = u_time * speed;
  // Two layers of shimmer drifting upwards at different speeds.
  vec2 q1 = vec2(p.x, p.y * 0.6 + t * 1.4);
  vec2 q2 = vec2(p.x * 2.1 + 9.0, p.y * 1.3 + t * 2.3);
  vec2 o = vec2(vnoise(q1) + 0.5 * vnoise(q2), vnoise(q1 + 37.1) + 0.5 * vnoise(q2 + 11.7)) / 0.75 - 1.0;
  return texM(uv + o * amt / u_res);
}`,
  },
  {
    id: 'liquid',
    name: 'Liquid',
    category: 'distort',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 45, min: 0, max: 300, step: 1, unit: 'px' },
      { key: 'scale', label: 'Scale', type: 'float', default: 320, min: 40, max: 1500, step: 5, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.4, min: 0, max: 3, step: 0.05 },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float amt = amount * u_px;
  if (amt < 0.01) return tex(uv);
  vec2 p = uv * u_res / (u_px * max(scale, 4.0));
  float t = u_time * speed;
  // Domain-warped noise gives slow, folding currents rather than a uniform wobble.
  vec2 w = vec2(fbm(p + vec2(0.0, t * 0.35)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.3, 0.0)));
  vec2 o = vec2(fbm(p + 1.7 * w + vec2(1.7, 9.2) + t * 0.15), fbm(p + 1.7 * w + vec2(8.3, 2.8) - t * 0.12)) * 2.0 - 1.0;
  return texM(uv + o * amt * 1.6 / u_res);
}`,
  },
  {
    id: 'underwater',
    name: 'Underwater',
    category: 'distort',
    animated: true,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
      { key: 'wobble', label: 'Wobble', type: 'float', default: 12, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'scale', label: 'Scale', type: 'float', default: 220, min: 30, max: 1000, step: 5, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 0.6, min: 0, max: 3, step: 0.05 },
      { key: 'caustics', label: 'Caustics', type: 'float', default: 0.45, min: 0, max: 1, step: 0.01 },
      { key: 'tint', label: 'Water colour', type: 'color', default: '#1fa3c4' },
    ],
    glsl: `
float ridge(vec2 p) {
  float n = vnoise(p);
  return pow(1.0 - abs(2.0 * n - 1.0), 3.5);
}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return tex(uv);
  float t = u_time * speed;
  vec2 p = uv * u_res / (u_px * max(scale, 4.0));
  vec2 o = vec2(
    sin(p.y * 2.1 + t * 1.7) + 0.5 * sin(p.y * 4.3 - t * 2.3 + p.x),
    cos(p.x * 1.9 + t * 1.3) + 0.5 * cos(p.x * 3.7 + t * 2.1 + p.y)) / 1.5;
  vec4 c = texM(uv + o * wobble * u_px * amount / u_res);
  if (c.a <= 0.0) return c;
  vec3 rgb = c.rgb / c.a;
  // Water absorbs the warm end of the spectrum and veils everything in its own colour.
  vec3 hueCast = tint / max(max(tint.r, max(tint.g, tint.b)), 0.001);
  vec3 graded = mix(rgb * mix(vec3(1.0), hueCast, 0.65), tint, 0.14);
  // Ripples on the surface focus the light into a moving net of caustics.
  float net = ridge(p * 1.6 + o * 0.25 + vec2(t * 0.35, t * 0.2)) + ridge(p * 1.15 + 7.3 - vec2(t * 0.25, -t * 0.3));
  graded += pow(net * 0.55, 1.6) * caustics * 0.55 * vec3(0.8, 1.0, 0.95);
  rgb = mix(rgb, clamp(graded, 0.0, 1.0), amount);
  return vec4(rgb * c.a, c.a);
}`,
  },
  {
    id: 'water-reflection',
    name: 'Water Reflection',
    category: 'distort',
    animated: true,
    params: [
      { key: 'horizon', label: 'Waterline', type: 'float', default: 58, min: 10, max: 95, step: 0.5, unit: '%' },
      { key: 'waves', label: 'Wave strength', type: 'float', default: 12, min: 0, max: 80, step: 0.5, unit: 'px' },
      { key: 'ripple', label: 'Wave length', type: 'float', default: 46, min: 8, max: 300, step: 1, unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'float', default: 1, min: 0, max: 4, step: 0.05 },
      { key: 'depth', label: 'Water tint', type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
      { key: 'water', label: 'Water colour', type: 'color', default: '#0b3550' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  float h = horizon * 0.01;
  float edge = (uv.y - h) * u_res.y;
  if (edge <= -0.5) return tex(uv);
  // z runs from 0 at the waterline to 1 at the bottom of the frame (nearest the viewer).
  float z = max(uv.y - h, 0.0) / max(1.0 - h, 0.001);
  float t = u_time * speed;
  // Waves get longer and stronger towards the viewer, as perspective would have it.
  float designH = (1.0 - h) * u_res.y / u_px;
  float ph = TAU * designH / max(ripple, 2.0) * log(0.25 + 0.75 * z) / 0.75;
  float wob = vnoise(vec2(uv.x * 6.0, z * 5.0 - t * 0.3)) * 3.0;
  float near = 0.3 + 0.7 * z;
  vec2 o = vec2(sin(ph - t * 3.0 + wob), 0.5 * cos(ph * 0.9 - t * 2.3 + wob)) * waves * u_px * near / u_res;
  vec2 q = vec2(uv.x + o.x, min(2.0 * h - uv.y + o.y, h));
  vec4 c = tex(q);
  c.rgb *= 1.0 - depth * 0.3;
  c.rgb = mix(c.rgb, water * c.a, depth * (0.25 + 0.3 * z));
  return mix(tex(uv), c, clamp(edge + 0.5, 0.0, 1.0));
}`,
  },
  {
    id: 'tiny-planet',
    name: 'Tiny Planet',
    category: 'distort',
    animated: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 0,
        options: [
          { label: 'Planet', value: 0 },
          { label: 'Tunnel', value: 1 },
        ],
      },
      { key: 'zoom', label: 'Zoom', type: 'float', default: 1, min: 0.3, max: 3, step: 0.01 },
      { key: 'rotation', label: 'Rotation', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'spin', label: 'Spin', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°/s' },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(u_aspect, 1.0);
  float r = length(d) * 2.0 / max(zoom, 0.05);
  float a = atan(d.y, d.x) / TAU + 0.25 + (rotation + mod(u_time * spin, 360.0)) / 360.0;
  // Planet: the bottom of the picture becomes the centre. Tunnel: the top does.
  float v = mode < 0.5 ? 1.0 - r * 0.85 : r * 0.85;
  // The picture wraps around twice, mirrored, so there is no seam; eight taps along the arc
  // keep the tightly wound centre from shimmering.
  float da = 1.0 / (TAU * max(length(d) * u_res.y, 0.5));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float ai = a + (float(i) / 8.0 - 0.4375) * da;
    acc += tex(vec2(abs(fract(ai) * 2.0 - 1.0), v));
  }
  return acc / 8.0;
}`,
  },
  {
    id: 'glass-blocks',
    name: 'Glass Blocks',
    category: 'distort',
    params: [
      { key: 'size', label: 'Block size', type: 'float', default: 70, min: 8, max: 400, step: 1, unit: 'px' },
      { key: 'strength', label: 'Refraction', type: 'float', default: 0.4, min: 0, max: 1.5, step: 0.01 },
      { key: 'bevel', label: 'Bevel', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: 0,
        options: [
          { label: 'Blocks', value: 0 },
          { label: 'Vertical flutes', value: 1 },
          { label: 'Horizontal flutes', value: 2 },
        ],
      },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  if (strength <= 0.0005) return tex(uv);
  float block = max(size, 4.0);
  vec2 f = fract(uv * u_res / (u_px * block)) - 0.5;
  if (pattern > 0.5 && pattern < 1.5) f.y = 0.0;
  if (pattern > 1.5) f.x = 0.0;
  // Every block is a small lens: it pulls its view towards the block centre.
  vec4 c = texM(uv - f * block * strength * u_px / u_res);
  // Soft bevel: lit from the top left, shaded bottom right, with a thin seam between blocks.
  vec2 e = abs(f) * 2.0;
  float rim = max(e.x, e.y);
  float aa = 2.0 / (block * u_px);
  float lit = -(f.x + f.y) * pow(rim, 4.0) * bevel * 0.6;
  float seam = smoothstep(1.0 - aa, 1.0, rim) * bevel * 0.4;
  c.rgb = clamp(c.rgb + c.a * lit, vec3(0.0), vec3(c.a)) * (1.0 - seam);
  return c;
}`,
  },
];

export default effects;
