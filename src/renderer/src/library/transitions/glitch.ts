import type { TransitionDef } from '../types';

const transitions: TransitionDef[] = [
  {
    id: 'rgb-split',
    name: 'RGB Split',
    category: 'glitch',
    duration: 0.6,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 0.08, min: 0.005, max: 0.4, step: 0.005 },
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
    ],
    glsl: `
vec2 mirrorUv(vec2 u) {
  return 1.0 - abs(1.0 - mod(u, 2.0));
}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a) / ratio, sin(a)) * amount;
  float e = progress * progress * (3.0 - 2.0 * progress);
  // The outgoing channels fly apart while the incoming ones converge.
  vec2 oa = dir * e;
  vec2 ob = dir * (1.0 - e);
  float m = smoothstep(0.25, 0.75, progress);
  vec4 ar = getFromColor(mirrorUv(uv + oa));
  vec4 ag = getFromColor(uv);
  vec4 ab = getFromColor(mirrorUv(uv - oa));
  vec4 br = getToColor(mirrorUv(uv - ob));
  vec4 bg = getToColor(uv);
  vec4 bb = getToColor(mirrorUv(uv + ob));
  vec4 ca = vec4(ar.r, ag.g, ab.b, (ar.a + ag.a + ab.a) / 3.0);
  vec4 cb = vec4(br.r, bg.g, bb.b, (br.a + bg.a + bb.a) / 3.0);
  return mix(ca, cb, m);
}`,
  },
  {
    id: 'chroma-burst',
    name: 'Chroma Burst',
    category: 'glitch',
    duration: 0.6,
    params: [
      { key: 'amount', label: 'Dispersion', type: 'float', default: 0.18, min: 0.02, max: 0.6, step: 0.01 },
      { key: 'punch', label: 'Punch', type: 'float', default: 0.12, min: 0, max: 0.5, step: 0.01 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  float m = smoothstep(0.3, 0.7, progress);
  vec2 d = uv - 0.5;
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  float alpha = 0.0;
  // Each wavelength is magnified a little differently, like a cheap lens pushed too far.
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = float(i) / float(N - 1);
    vec3 w = max(1.0 - abs(t - vec3(0.0, 0.5, 1.0)) * 2.0, 0.0);
    float sc = (1.0 + punch * k) * (1.0 + amount * k * (t - 0.5));
    vec2 q = 0.5 + d / sc;
    vec4 s = mix(getFromColor(q), getToColor(q), m);
    acc += s.rgb * w;
    wsum += w;
    alpha += s.a;
  }
  return vec4(acc / wsum, alpha / float(N));
}`,
  },
  {
    id: 'block-glitch',
    name: 'Block Glitch',
    category: 'glitch',
    duration: 0.6,
    params: [
      { key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0.1, max: 2, step: 0.05 },
      { key: 'size', label: 'Block Size', type: 'float', default: 1, min: 0.3, max: 3, step: 0.05 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  float st = floor(progress * 16.0) + 1.0;
  vec2 p = vec2(uv.x * ratio, 1.0 - uv.y);
  vec2 c1 = floor(p * vec2(3.5, 7.0) / size);
  vec2 c2 = floor(p * vec2(11.0, 22.0) / size);
  float on1 = step(1.0 - 0.5 * k, hash21(c1 + st * 7.13));
  float on2 = step(1.0 - 0.35 * k, hash21(c2 + st * 3.71 + 40.0));
  float dx = ((hash21(c1 * 1.3 + st) - 0.5) * 0.3 * on1 + (hash21(c2 * 2.1 - st) - 0.5) * 0.1 * on2) * amount;
  // Every large block switches to the incoming picture at its own moment.
  float sw = step(0.3 + 0.4 * hash21(c1 + 19.0), progress);
  vec2 q = vec2(fract(uv.x + dx), uv.y);
  vec2 ca = vec2((0.003 + 0.02 * on1) * k * amount, 0.0);
  vec4 a0 = getFromColor(q);
  vec4 b0 = getToColor(q);
  vec4 a = vec4(getFromColor(q + ca).r, a0.g, getFromColor(q - ca).b, a0.a);
  vec4 b = vec4(getToColor(q + ca).r, b0.g, getToColor(q - ca).b, b0.a);
  vec4 c = mix(a, b, sw);
  // A few small blocks blow out or invert for a frame.
  float pick = hash21(c2 + st * 5.0 + 80.0);
  float hot = on2 * step(0.9, pick);
  float inv = on2 * step(pick, 0.08);
  c.rgb = mix(c.rgb, vec3(c.a) - c.rgb, inv * 0.85);
  c.rgb = min(c.rgb * (1.0 + 0.9 * hot), vec3(c.a));
  return c;
}`,
  },
  {
    id: 'glitch-slices',
    name: 'Glitch Slices',
    category: 'glitch',
    duration: 0.6,
    params: [
      { key: 'count', label: 'Slices', type: 'int', default: 9, min: 2, max: 30, step: 1 },
      { key: 'fringe', label: 'Color Fringe', type: 'float', default: 1, min: 0, max: 3, step: 0.05 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float n = max(count, 2.0) * 0.5;
  // Each base row is cut once at a random height, which gives slices of uneven thickness.
  float yy = (1.0 - uv.y) * n;
  float i0 = floor(yy);
  float cut = 0.3 + 0.4 * hash11(i0 * 3.7 + 1.3);
  float idx = i0 * 2.0 + step(cut, fract(yy));
  float sgn = hash11(idx * 2.17 + 3.0) < 0.5 ? -1.0 : 1.0;
  float delay = hash11(idx * 5.31 + 7.0) * 0.5;
  float lp = clamp((progress - delay) / 0.5, 0.0, 1.0);
  float e = lp * lp * lp * (lp * (6.0 * lp - 15.0) + 10.0);
  float x = uv.x - sgn * e;
  float px = fwidth(uv.x);
  float cov = clamp(x / px + 0.5, 0.0, 1.0) * clamp((1.0 - x) / px + 0.5, 0.0, 1.0);
  float ca = 0.012 * fringe * sin(lp * PI);
  float xb = x + sgn;
  vec4 a0 = getFromColor(vec2(x, uv.y));
  vec4 b0 = getToColor(vec2(xb, uv.y));
  vec4 a = vec4(getFromColor(vec2(x + ca, uv.y)).r, a0.g, getFromColor(vec2(x - ca, uv.y)).b, a0.a);
  vec4 b = vec4(getToColor(vec2(xb + ca, uv.y)).r, b0.g, getToColor(vec2(xb - ca, uv.y)).b, b0.a);
  return mix(b, a, cov);
}`,
  },
  {
    id: 'scan-tear',
    name: 'Scan Tear',
    category: 'glitch',
    duration: 0.6,
    params: [{ key: 'amount', label: 'Amount', type: 'float', default: 1, min: 0.1, max: 2.5, step: 0.05 }],
    glsl: `
vec4 transition(vec2 uv) {
  float k = max(sin(progress * PI), 0.0);
  float st = floor(progress * 20.0) + 1.0;
  float y = 1.0 - uv.y;
  // Wide bands tear sideways and reshuffle every step; thin lines jitter on top.
  float band = floor(y * 13.0 + hash11(st * 1.9) * 13.0);
  float on = step(1.0 - 0.6 * k, hash11(band * 3.3 + st * 7.7));
  float line = floor(y * 240.0);
  float lineN = hash21(vec2(line, st));
  float dx = ((hash11(band * 9.1 + st * 2.3) - 0.5) * 0.35 * on + (lineN - 0.5) * 0.012 * k) * amount;
  // Fixed bands decide when each part of the frame cuts to the incoming picture.
  float sw = step(0.32 + 0.36 * hash11(floor(y * 7.0) * 1.7 + 3.0), progress);
  vec2 q = vec2(fract(uv.x + dx), uv.y);
  vec2 ca = vec2((0.004 + 0.015 * on) * k * amount, 0.0);
  vec4 a0 = getFromColor(q);
  vec4 b0 = getToColor(q);
  vec4 a = vec4(getFromColor(q + ca).r, a0.g, getFromColor(q - ca).b, a0.a);
  vec4 b = vec4(getToColor(q + ca).r, b0.g, getToColor(q - ca).b, b0.a);
  vec4 c = mix(a, b, sw);
  c.rgb = min(c.rgb + on * k * 0.12 * lineN * c.a, vec3(c.a));
  return c;
}`,
  },
  {
    id: 'static-burst',
    name: 'Static Burst',
    category: 'glitch',
    duration: 0.7,
    params: [
      { key: 'grain', label: 'Grain Size', type: 'float', default: 3, min: 1, max: 16, step: 0.5, unit: 'px' },
      { key: 'tint', label: 'Tint', type: 'color', default: '#e8eef5' },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float amt = smoothstep(0.0, 0.5, progress) * (1.0 - smoothstep(0.5, 1.0, progress));
  float st = floor(progress * 30.0) + 1.0;
  // Grain is sized against a 1080-line frame so previews and exports match.
  vec2 cell = floor(vec2(uv.x * ratio, uv.y) * 1080.0 / max(grain, 1.0));
  float n = hash21(cell + st * 17.0);
  float n2 = hash21(cell * 1.31 + st * 5.0 + 100.0);
  float bar = smoothstep(0.55, 0.9, vnoise(vec2(uv.y * 5.0 - st * 0.9, st * 0.37)));
  vec3 snow = tint * mix(n * n, 1.0, bar * 0.4);
  // The picture loses horizontal hold while the static takes over.
  float jx = (hash11(floor(uv.y * 90.0) + st * 3.0) - 0.5) * 0.08 * amt * amt;
  vec2 q = vec2(fract(uv.x + jx), uv.y);
  vec4 base;
  if (progress < 0.5) base = getFromColor(q);
  else base = getToColor(q);
  // Speckles first, then a full screen of snow exactly when the picture changes.
  float cover = clamp(amt * amt * (0.3 + 1.0 * step(1.0 - amt, n2)), 0.0, 1.0);
  return mix(base, vec4(snow, 1.0), cover);
}`,
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    category: 'glitch',
    duration: 0.8,
    params: [
      { key: 'size', label: 'Block Size', type: 'float', default: 0.09, min: 0.01, max: 0.3, step: 0.005 },
      { key: 'steps', label: 'Steps', type: 'int', default: 12, min: 2, max: 40, step: 1 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float k = max(sin(progress * PI), 0.0);
  // Block size grows and shrinks in discrete steps, which keeps the grid from swimming.
  float n = max(steps, 1.0);
  float lv = ceil(k * n - 0.001) / n;
  float sz = size * lv * lv;
  vec2 q = uv;
  if (sz > px) {
    vec2 asp = vec2(ratio, 1.0);
    vec2 p = (floor((uv - 0.5) * asp / sz) + 0.5) * sz;
    q = clamp(p / asp + 0.5, 0.0, 1.0);
  }
  return mix(getFromColor(q), getToColor(q), smoothstep(0.4, 0.6, progress));
}`,
  },
];

export default transitions;
