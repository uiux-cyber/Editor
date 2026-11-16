import type { ParamDef, TransitionDef } from '../types';

const direction = (def = 0): ParamDef => ({
  key: 'direction',
  label: 'Direction',
  type: 'select',
  default: def,
  options: [
    { label: 'Left', value: 0 },
    { label: 'Right', value: 1 },
    { label: 'Up', value: 2 },
    { label: 'Down', value: 3 },
  ],
});

/** Shared helpers: motion direction (uv is y-up), easing and anti-aliased rectangle coverage. */
const SLIDE_LIB = `
vec2 slideDir(float d) {
  return d < 0.5 ? vec2(-1.0, 0.0) : d < 1.5 ? vec2(1.0, 0.0) : d < 2.5 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
}
float easeIO(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - 0.5 * pow(2.0 - 2.0 * t, 3.0);
}
// Coverage of the unit square at q, anti-aliased over one pixel (px = pixel size in q units).
float rectCov(vec2 q, vec2 px) {
  vec2 lo = clamp(q / px + 0.5, 0.0, 1.0);
  vec2 hi = clamp((1.0 - q) / px + 0.5, 0.0, 1.0);
  return lo.x * lo.y * hi.x * hi.y;
}`;

const transitions: TransitionDef[] = [
  {
    id: 'slide-over',
    name: 'Slide Over',
    category: 'slide',
    duration: 0.6,
    params: [direction(), { key: 'shadow', label: 'Shadow', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 }],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  vec2 px = fwidth(uv);
  float e = easeIO(progress);
  // The incoming picture travels along dir and covers the outgoing one.
  vec2 q = uv + dir * (1.0 - e);
  float cov = rectCov(q, px);
  // Distance (in frame heights) ahead of the incoming picture's leading edge.
  vec2 ahead = max(-q, q - 1.0) * vec2(ratio, 1.0);
  float dist = max(dot(ahead, abs(dir)), 0.0);
  float fade = smoothstep(0.0, 0.12, progress) * (1.0 - smoothstep(0.9, 1.0, progress));
  float sh = exp(-dist / 0.05) * 0.55 * shadow * fade;
  vec4 under = getFromColor(uv);
  under.rgb *= (1.0 - sh) * (1.0 - 0.25 * e * shadow);
  return mix(under, getToColor(q), cov);
}`,
  },
  {
    id: 'slide-away',
    name: 'Slide Away',
    category: 'slide',
    duration: 0.6,
    params: [direction(), { key: 'shadow', label: 'Shadow', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 }],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  vec2 px = fwidth(uv);
  float e = easeIO(progress);
  // The outgoing picture leaves along dir and uncovers the incoming one.
  vec2 q = uv - dir * e;
  float cov = rectCov(q, px);
  vec2 behind = max(-q, q - 1.0) * vec2(ratio, 1.0);
  float dist = max(dot(behind, abs(dir)), 0.0);
  float fade = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.88, 1.0, progress));
  float sh = exp(-dist / 0.05) * 0.55 * shadow * fade;
  vec4 under = getToColor(uv);
  under.rgb *= (1.0 - sh) * (1.0 - 0.25 * (1.0 - e) * shadow);
  return mix(under, getFromColor(q), cov);
}`,
  },
  {
    id: 'split-slide',
    name: 'Split Slide',
    category: 'slide',
    duration: 0.7,
    params: [
      {
        key: 'orientation',
        label: 'Split',
        type: 'select',
        default: 0,
        options: [
          { label: 'Left / Right', value: 0 },
          { label: 'Up / Down', value: 1 },
        ],
      },
      { key: 'shadow', label: 'Shadow', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  bool vert = orientation > 0.5;
  float x = vert ? uv.y : uv.x;
  float px = vert ? fwidth(uv.y) : fwidth(uv.x);
  float unit = vert ? 1.0 : ratio;
  float e = easeIO(progress);
  float side = x < 0.5 ? -1.0 : 1.0;
  // Each half travels half a frame (plus a pixel so the last sliver is gone at the end).
  float shift = e * (0.5 + px);
  float d = abs(x - 0.5) - shift;
  // Biased by half a pixel so a centre column (odd widths) is fully covered at the start.
  float cov = clamp(d / px + 1.0, 0.0, 1.0);
  float sx = x - side * shift;
  vec2 q = vert ? vec2(uv.x, sx) : vec2(sx, uv.y);
  vec4 under = getToColor(uv);
  float fade = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.85, 1.0, progress));
  float sh = exp(min(d, 0.0) * unit / 0.05) * 0.5 * shadow * fade;
  under.rgb *= (1.0 - sh) * (1.0 - 0.2 * (1.0 - e) * shadow);
  return mix(under, getFromColor(q), cov);
}`,
  },
  {
    id: 'strip-slide',
    name: 'Strips',
    category: 'slide',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Strips', type: 'int', default: 6, min: 2, max: 24, step: 1 },
      {
        key: 'orientation',
        label: 'Orientation',
        type: 'select',
        default: 0,
        options: [
          { label: 'Vertical Strips', value: 0 },
          { label: 'Horizontal Strips', value: 1 },
        ],
      },
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: 0,
        options: [
          { label: 'Alternating', value: 0 },
          { label: 'Cascade', value: 1 },
        ],
      },
    ],
    glsl: `${SLIDE_LIB}
// Colour of strip i at this pixel: the outgoing strip slides out along its length.
vec4 stripColor(float i, float n, vec2 uv, bool horiz, vec2 px, vec4 under) {
  i = clamp(i, 0.0, n - 1.0);
  float order = i / max(n - 1.0, 1.0);
  float sgn = pattern < 0.5 ? (mod(i, 2.0) < 0.5 ? 1.0 : -1.0) : 1.0;
  float lp = clamp((progress - order * 0.45) / 0.55, 0.0, 1.0);
  float e = easeIO(lp);
  vec2 axis = horiz ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 q = uv - axis * sgn * e * (1.0 + 2.0 * max(px.x, px.y));
  return mix(under, getFromColor(q), rectCov(q, px));
}
vec4 transition(vec2 uv) {
  float n = max(count, 1.0);
  bool horiz = orientation > 0.5;
  vec2 px = fwidth(uv);
  float across = (horiz ? 1.0 - uv.y : uv.x) * n;
  float w = fwidth(across);
  float fa = fract(across);
  float fs = fa > 0.5 ? fa - 1.0 : fa;
  float side = clamp(fs / w * 0.75 + 0.5, 0.0, 1.0);
  float iPlus = floor(across + 0.5);
  vec4 under = getToColor(uv);
  vec4 a = stripColor(iPlus - 1.0, n, uv, horiz, px, under);
  vec4 b = stripColor(iPlus, n, uv, horiz, px, under);
  return mix(a, b, side);
}`,
  },
  {
    id: 'bounce-push',
    name: 'Bounce Push',
    category: 'slide',
    duration: 0.9,
    params: [direction(), { key: 'bounce', label: 'Bounce', type: 'float', default: 0.6, min: 0, max: 1, step: 0.01 }],
    glsl: `${SLIDE_LIB}
float bounceOut(float t) {
  const float n = 7.5625;
  const float d = 2.75;
  if (t < 1.0 / d) return n * t * t;
  if (t < 2.0 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
  t -= 2.625 / d;
  return n * t * t + 0.984375;
}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  vec2 px = fwidth(uv);
  // Blend a plain ease-out with a full bounce so the rebound height is adjustable.
  float plain = 1.0 - pow(1.0 - progress, 3.0);
  float e = mix(plain, bounceOut(progress), bounce);
  vec2 q = uv - dir * e;
  float cov = rectCov(q, px);
  return mix(getToColor(q + dir), getFromColor(q), cov);
}`,
  },
  {
    id: 'parallax-push',
    name: 'Parallax Push',
    category: 'slide',
    duration: 0.8,
    params: [direction(), { key: 'depth', label: 'Depth', type: 'float', default: 0.5, min: 0, max: 0.9, step: 0.01 }],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  vec2 px = fwidth(uv);
  float e = easeIO(progress);
  // The frames travel a full width while their contents lag behind, like layers at different depths.
  vec2 qf = uv - dir * e;
  vec2 qt = qf + dir;
  float cov = rectCov(qf, px);
  vec4 a = getFromColor(qf + dir * e * depth);
  vec4 b = getToColor(qt - dir * (1.0 - e) * depth);
  a.rgb *= 1.0 - 0.45 * e * depth;
  b.rgb *= 1.0 - 0.45 * (1.0 - e) * depth;
  return mix(b, a, cov);
}`,
  },
  {
    id: 'squeeze',
    name: 'Squeeze',
    category: 'slide',
    duration: 0.7,
    params: [direction()],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  bool vert = direction > 1.5;
  // Moving left / down means the incoming picture enters from the right / top edge (uv is y-up).
  bool enterHigh = direction < 0.5 || direction > 2.5;
  float x = vert ? uv.y : uv.x;
  float px = vert ? fwidth(uv.y) : fwidth(uv.x);
  if (enterHigh) x = 1.0 - x;
  float e = easeIO(progress);
  // The incoming picture occupies [0, e], the outgoing one is squeezed into [e, 1].
  float cov = clamp((e - x) / px + 0.5, 0.0, 1.0);
  float xt = clamp(x / max(e, 1e-4), 0.0, 1.0);
  float xf = clamp((x - e) / max(1.0 - e, 1e-4), 0.0, 1.0);
  if (enterHigh) { xt = 1.0 - xt; xf = 1.0 - xf; }
  vec2 qt = vert ? vec2(uv.x, xt) : vec2(xt, uv.y);
  vec2 qf = vert ? vec2(uv.x, xf) : vec2(xf, uv.y);
  return mix(getFromColor(qf), getToColor(qt), cov);
}`,
  },
  {
    id: 'whip-pan',
    name: 'Whip Pan',
    category: 'slide',
    duration: 0.5,
    params: [direction(), { key: 'blur', label: 'Motion Blur', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 }],
    glsl: `${SLIDE_LIB}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  float p = progress;
  float e = p * p * p * (p * (6.0 * p - 15.0) + 10.0);
  // Blur length follows the speed of the move, so it vanishes at both ends.
  float speed = 16.0 * p * p * (1.0 - p) * (1.0 - p);
  float len = blur * 0.9 * speed;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 acc = vec4(0.0);
  const int N = 28;
  for (int i = 0; i < N; i++) {
    float o = ((float(i) + jitter) / float(N) - 0.5) * len;
    vec2 q = uv - dir * clamp(e + o, 0.0, 1.0);
    vec2 inside = step(vec2(0.0), q) * step(q, vec2(1.0));
    acc += inside.x * inside.y > 0.5 ? getFromColor(q) : getToColor(q + dir);
  }
  return acc / float(N);
}`,
  },
  {
    id: 'card-swipe',
    name: 'Card Swipe',
    category: 'slide',
    duration: 0.9,
    params: [
      direction(),
      { key: 'shrink', label: 'Shrink', type: 'float', default: 0.2, min: 0, max: 0.5, step: 0.01 },
      { key: 'corner', label: 'Corner Radius', type: 'float', default: 0.04, min: 0, max: 0.15, step: 0.005 },
      { key: 'background', label: 'Background', type: 'color', default: '#000000' },
    ],
    glsl: `${SLIDE_LIB}
// Signed distance to a rounded rectangle of half-size b (corner radius r).
float cardSd(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec4 transition(vec2 uv) {
  vec2 dir = slideDir(direction);
  float px = fwidth(uv.y);
  float e = easeIO(progress);
  // Both pictures shrink into cards while they travel, then grow back.
  float k = smoothstep(0.0, 0.35, progress) * (1.0 - smoothstep(0.65, 1.0, progress));
  float sc = 1.0 - shrink * k;
  float rad = corner * k;
  vec2 asp = vec2(ratio, 1.0);
  vec2 p = (uv - 0.5) * asp;
  vec2 step1 = dir * asp;
  vec2 cf = step1 * e;
  vec2 ct = cf - step1;
  vec2 lf = (p - cf) / sc;
  vec2 lt = (p - ct) / sc;
  float covF = clamp(0.5 - cardSd(lf, asp * 0.5, rad) * sc / px, 0.0, 1.0);
  float covT = clamp(0.5 - cardSd(lt, asp * 0.5, rad) * sc / px, 0.0, 1.0);
  vec4 c = vec4(background, 1.0);
  c = mix(c, getFromColor(lf / asp + 0.5), covF);
  c = mix(c, getToColor(lt / asp + 0.5), covT);
  return c;
}`,
  },
];

export default transitions;
