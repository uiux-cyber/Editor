import type { TransitionDef } from '../types';

/** Mirrored sampling keeps displaced lookups inside the picture without streaking its border. */
const MIRROR = `
vec2 mirrorUv(vec2 u) {
  return 1.0 - abs(1.0 - mod(u, 2.0));
}`;

const transitions: TransitionDef[] = [
  {
    id: 'ripple',
    name: 'Ripple',
    category: 'distort',
    duration: 1.0,
    params: [
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'amplitude', label: 'Amplitude', type: 'float', default: 0.035, min: 0, max: 0.15, step: 0.001 },
      { key: 'waves', label: 'Waves', type: 'float', default: 5, min: 1, max: 16, step: 0.5 },
      { key: 'width', label: 'Ripple Width', type: 'float', default: 0.3, min: 0.05, max: 1, step: 0.01 },
    ],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  // centerY is measured from the top of the frame.
  vec2 c = vec2(centerX, 1.0 - centerY);
  vec2 p = (uv - c) * asp;
  float r = length(p);
  float rmax = length(max(c, 1.0 - c) * asp);
  float w = max(width, 0.02);
  // A band of ripples expands from the centre like a drop in water; the incoming picture is inside it.
  float front = mix(-1.5 * w, rmax + 1.5 * w, progress);
  float x = (r - front) / w;
  float env = exp(-x * x * 2.5) * (1.0 - smoothstep(1.2, 1.5, abs(x)));
  float wave = sin(x * waves * PI) * env;
  vec2 dirn = p / max(r, 1e-5);
  vec2 q = mirrorUv(uv + dirn * wave * amplitude / asp);
  float reveal = 1.0 - smoothstep(-0.35, 0.35, x);
  vec4 col = mix(getFromColor(q), getToColor(q), reveal);
  // Crests catch a little light.
  col.rgb = clamp(col.rgb * (1.0 + 4.0 * amplitude * wave), 0.0, col.a);
  return col;
}`,
  },
  {
    id: 'wave',
    name: 'Wave',
    category: 'distort',
    duration: 0.9,
    params: [
      {
        key: 'orientation',
        label: 'Displace',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontally', value: 0 },
          { label: 'Vertically', value: 1 },
        ],
      },
      { key: 'amplitude', label: 'Amplitude', type: 'float', default: 0.06, min: 0, max: 0.3, step: 0.005 },
      { key: 'frequency', label: 'Frequency', type: 'float', default: 3, min: 0.5, max: 20, step: 0.1 },
      { key: 'travel', label: 'Travel', type: 'float', default: 1.5, min: -6, max: 6, step: 0.1 },
    ],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  bool vert = orientation > 0.5;
  // Rows (or columns) slide back and forth like a flag; the wave runs along the other axis.
  float along = vert ? uv.x * ratio : uv.y;
  float ph = along * frequency * TAU + progress * travel * TAU;
  float disp = amplitude * k * (sin(ph) + 0.35 * sin(ph * 2.3 + 1.7));
  vec2 q = vert ? vec2(uv.x, uv.y + disp) : vec2(uv.x + disp / ratio, uv.y);
  q = mirrorUv(q);
  return mix(getFromColor(q), getToColor(q), smoothstep(0.25, 0.75, progress));
}`,
  },
  {
    id: 'liquid',
    name: 'Liquid',
    category: 'distort',
    duration: 1.0,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.22, min: 0.02, max: 0.6, step: 0.01 },
      { key: 'detail', label: 'Detail', type: 'float', default: 2.2, min: 0.5, max: 8, step: 0.1 },
    ],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  vec2 p = vec2(uv.x * ratio, uv.y) * detail;
  float t = progress * 1.5;
  // Warp the warp: two nested noise fields give a thick, flowing displacement.
  vec2 w1 = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(5.2, 1.3 - t))) - 0.5;
  vec2 w2 = vec2(fbm(p + 2.5 * w1 + vec2(1.7, 9.2 + t)), fbm(p + 2.5 * w1 + vec2(8.3 - t, 2.8))) - 0.5;
  vec2 off = w2 * amount * k;
  vec2 q = mirrorUv(uv + vec2(off.x / ratio, off.y));
  return mix(getFromColor(q), getToColor(q), smoothstep(0.3, 0.7, progress));
}`,
  },
  {
    id: 'morph',
    name: 'Morph',
    category: 'distort',
    duration: 1.0,
    params: [{ key: 'strength', label: 'Strength', type: 'float', default: 0.12, min: 0, max: 0.4, step: 0.005 }],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  float e = progress * progress * (3.0 - 2.0 * progress);
  // Brightness gradient of the half-way blend, measured on a ring of eight samples.
  vec2 grad = vec2(0.0);
  const int N = 8;
  for (int i = 0; i < N; i++) {
    float a = float(i) * TAU / float(N);
    vec2 d = vec2(cos(a), sin(a));
    vec2 q = uv + d * vec2(0.03 / ratio, 0.03);
    grad += d * luma(mix(getFromColor(q), getToColor(q), 0.5).rgb);
  }
  // Shapes slide along that gradient: the outgoing picture is pulled one way, the incoming one
  // arrives from the other, so features appear to flow into each other.
  vec2 flow = grad * strength * vec2(1.0 / ratio, 1.0);
  vec4 a = getFromColor(mirrorUv(uv + flow * e));
  vec4 b = getToColor(mirrorUv(uv - flow * (1.0 - e)));
  return mix(a, b, e);
}`,
  },
  {
    id: 'stretch',
    name: 'Stretch',
    category: 'distort',
    duration: 0.6,
    params: [
      {
        key: 'orientation',
        label: 'Axis',
        type: 'select',
        default: 0,
        options: [
          { label: 'Horizontal', value: 0 },
          { label: 'Vertical', value: 1 },
        ],
      },
      { key: 'amount', label: 'Amount', type: 'float', default: 6, min: 1, max: 30, step: 0.5 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  bool vert = orientation > 0.5;
  float p = progress;
  float e = p * p * p * (p * (6.0 * p - 15.0) + 10.0);
  float L = log(1.0 + amount);
  // The outgoing picture is pulled out along one axis; the incoming one snaps back from the same stretch.
  float sa = exp(L * e);
  float sb = exp(L * (1.0 - e));
  vec2 d = uv - 0.5;
  vec2 qa = 0.5 + (vert ? vec2(d.x, d.y / sa) : vec2(d.x / sa, d.y));
  vec2 qb = 0.5 + (vert ? vec2(d.x, d.y / sb) : vec2(d.x / sb, d.y));
  return mix(getFromColor(qa), getToColor(qb), smoothstep(0.4, 0.6, progress));
}`,
  },
  {
    id: 'pixel-stretch',
    name: 'Pixel Stretch',
    category: 'distort',
    duration: 0.8,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 1,
        options: [
          { label: 'Left', value: 0 },
          { label: 'Right', value: 1 },
          { label: 'Up', value: 2 },
          { label: 'Down', value: 3 },
        ],
      },
      { key: 'zone', label: 'Stretch Length', type: 'float', default: 0.45, min: 0.05, max: 1, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  bool vert = direction > 1.5;
  // x runs 0 → 1 along the travel direction of the wipe line (uv is y-up).
  float x = vert ? uv.y : uv.x;
  bool rev = direction < 0.5 || direction > 2.5;
  if (rev) x = 1.0 - x;
  float k = max(sin(progress * PI), 0.0);
  float w = zone * k;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float line = e * (1.0 + w);
  // Behind the line the incoming picture; ahead of it the outgoing one. In between, the two columns
  // of pixels at the borders of the gap are smeared across it.
  float xt = clamp(min(x, line - w), 0.0, 1.0);
  float xf = clamp(max(x, line), 0.0, 1.0);
  float u = clamp((x - (line - w)) / max(w, 1e-5), 0.0, 1.0);
  if (rev) { xt = 1.0 - xt; xf = 1.0 - xf; }
  vec2 qt = vert ? vec2(uv.x, xt) : vec2(xt, uv.y);
  vec2 qf = vert ? vec2(uv.x, xf) : vec2(xf, uv.y);
  return mix(getToColor(qt), getFromColor(qf), u * u * (3.0 - 2.0 * u));
}`,
  },
  {
    id: 'kaleidoscope',
    name: 'Kaleidoscope',
    category: 'distort',
    duration: 1.0,
    params: [
      { key: 'segments', label: 'Segments', type: 'int', default: 6, min: 2, max: 16, step: 1 },
      { key: 'spin', label: 'Spin', type: 'float', default: 90, min: -360, max: 360, step: 5, unit: '°' },
    ],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float k = smoothstep(0.0, 0.4, progress) * (1.0 - smoothstep(0.6, 1.0, progress));
  float n = max(floor(segments + 0.5), 2.0);
  float seg = TAU / n;
  float r = length(p);
  // Fold the angle into one mirrored wedge, then turn the whole mirror box.
  float a = abs(mod(atan(p.y, p.x), seg) - 0.5 * seg) + radians(spin) * progress;
  vec2 pk = r * vec2(cos(a), sin(a));
  // Blending coordinates (not colours) makes the picture fold itself into the kaleidoscope.
  vec2 q = mirrorUv(mix(p, pk, k) / asp + 0.5);
  return mix(getFromColor(q), getToColor(q), smoothstep(0.35, 0.65, progress));
}`,
  },
  {
    id: 'glass-blocks',
    name: 'Glass Blocks',
    category: 'distort',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Rows', type: 'int', default: 6, min: 2, max: 30, step: 1 },
      { key: 'refraction', label: 'Refraction', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
    ],
    glsl: `${MIRROR}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float k = max(sin(progress * PI), 0.0);
  vec2 asp = vec2(ratio, 1.0);
  float n = max(count, 1.0);
  vec2 g = (uv - 0.5) * asp * n;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  // Every block is a small lens: it magnifies around its own centre and is tilted a random amount.
  vec2 tilt = (hash22(id + 31.0) - 0.5) * 0.8;
  vec2 off = (tilt - f) * refraction * k / n;
  vec2 q = mirrorUv(uv + off / asp);
  vec4 col = mix(getFromColor(q), getToColor(q), smoothstep(0.3, 0.7, progress));
  // Mortar lines hide the jump between neighbouring lenses; a bevel highlight sits beside them.
  float edge = min(0.5 - abs(f.x), 0.5 - abs(f.y)) / n;
  float seam = 1.0 - smoothstep(0.0, max(0.004, 1.5 * px), edge);
  float bevel = smoothstep(0.03, 0.0, (0.5 - max(f.x, -f.y)) / n) * (1.0 - seam);
  col.rgb *= 1.0 - 0.55 * seam * min(k * 3.0, 1.0);
  col.rgb = min(col.rgb + 0.1 * bevel * k * col.a, vec3(col.a));
  return col;
}`,
  },
  {
    id: 'melt',
    name: 'Melt',
    category: 'distort',
    duration: 1.1,
    params: [
      { key: 'columns', label: 'Columns', type: 'float', default: 14, min: 2, max: 80, step: 1 },
      { key: 'spread', label: 'Unevenness', type: 'float', default: 0.6, min: 0, max: 1.5, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float x = uv.x * ratio;
  // Each column starts to run at its own moment.
  float n = vnoise(vec2(x * columns, 1.7)) * 0.6 + vnoise(vec2(x * columns * 0.31, 7.3)) * 0.4;
  float lp = clamp(progress * (1.0 + spread) - n * spread, 0.0, 1.0);
  // Accelerate like a falling drip; a finished column has travelled just over one frame height.
  float d = lp * lp * (1.0 + 4.0 * px);
  // The outgoing picture slides down (uv is y-up) and uncovers the incoming one from the top.
  vec2 q = vec2(uv.x, uv.y + d);
  float gone = clamp((q.y - 1.0) / max(fwidth(q.y), 1e-6) + 0.5, 0.0, 1.0);
  vec4 a = getFromColor(q);
  a.rgb *= 1.0 - 0.3 * smoothstep(0.0, 0.7, d);
  return mix(a, getToColor(uv), gone);
}`,
  },
];

export default transitions;
