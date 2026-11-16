import type { ParamDef, TransitionDef } from '../types';

const softness = (def: number, max = 0.5): ParamDef => ({ key: 'softness', label: 'Softness', type: 'float', default: def, min: 0, max, step: 0.005 });

const orientation = (a: string, b: string): ParamDef => ({
  key: 'orientation',
  label: 'Orientation',
  type: 'select',
  default: 0,
  options: [
    { label: a, value: 0 },
    { label: b, value: 1 },
  ],
});

const openClose: ParamDef = {
  key: 'mode',
  label: 'Mode',
  type: 'select',
  default: 0,
  options: [
    { label: 'Open', value: 0 },
    { label: 'Close', value: 1 },
  ],
};

/**
 * Reveal amount (1 = incoming) for a sawtooth coordinate `f` (0..1 inside each cell). Cells fill
 * from f = 0 up to `edge` with feather `s`; the hard seam at the cell boundary is anti-aliased
 * over `w` (the width of a pixel in cell units).
 */
const SAW_REVEAL = `
float sawReveal(float f, float edge, float s, float w) {
  float fs = f > 0.5 ? f - 1.0 : f;
  float side = clamp(fs / max(w, 1e-5) + 0.5, 0.0, 1.0);
  float plus = 1.0 - smoothstep(edge - s, edge + s, max(fs, 0.0));
  float minus = 1.0 - smoothstep(edge - s, edge + s, 1.0 + min(fs, 0.0));
  return mix(minus, plus, side);
}`;

const transitions: TransitionDef[] = [
  {
    id: 'border-wipe',
    name: 'Border Wipe',
    category: 'wipe',
    duration: 0.7,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'borderWidth', label: 'Border Width', type: 'float', default: 0.012, min: 0, max: 0.1, step: 0.001 },
      { key: 'borderColor', label: 'Border Color', type: 'color', default: '#ffffff' },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float extent = 0.5 * (abs(dir.x) * ratio + abs(dir.y));
  float d = dot(p, dir);
  float w = borderWidth * 0.5;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float edge = mix(-extent - w - px, extent + w + px, e);
  float toW = 1.0 - smoothstep(-px, px, d - (edge - w));
  float fromW = smoothstep(-px, px, d - (edge + w));
  float borderW = max(1.0 - toW - fromW, 0.0);
  return getToColor(uv) * toW + getFromColor(uv) * fromW + vec4(borderColor, 1.0) * borderW;
}`,
  },
  {
    id: 'clock-wipe',
    name: 'Clock Wipe',
    category: 'wipe',
    duration: 0.8,
    params: [
      {
        key: 'sweep',
        label: 'Sweep',
        type: 'select',
        default: 0,
        options: [
          { label: 'Clockwise', value: 0 },
          { label: 'Counter-clockwise', value: 1 },
          { label: 'Both Ways', value: 2 },
        ],
      },
      { key: 'startAngle', label: 'Start Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      softness(0.01, 0.25),
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float r = length(p);
  // Angle measured clockwise from 12 o'clock.
  float a = atan(p.x, p.y) - radians(startAngle);
  float aw = px / max(r, px);
  float reveal;
  if (sweep > 1.5) {
    float th = abs(mod(a + PI, TAU) - PI);
    float soft = softness * PI + aw;
    float phi = mix(-soft, PI + soft, progress);
    reveal = 1.0 - smoothstep(phi - soft, phi + soft, th);
  } else {
    if (sweep > 0.5) a = -a;
    float th = mod(a, TAU);
    float tw = th > PI ? th - TAU : th;
    float soft = softness * PI + aw;
    float phi = mix(-soft, TAU + soft, progress);
    // The fixed hand at the start angle is a hard seam: blend both sides by pixel coverage.
    float side = clamp(tw / aw * 0.75 + 0.5, 0.0, 1.0);
    float plus = 1.0 - smoothstep(phi - soft, phi + soft, max(tw, 0.0));
    float minus = 1.0 - smoothstep(phi - soft, phi + soft, TAU + min(tw, 0.0));
    reveal = mix(minus, plus, side);
  }
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'fan-wipe',
    name: 'Fan Wipe',
    category: 'wipe',
    duration: 0.8,
    params: [
      {
        key: 'origin',
        label: 'Pivot',
        type: 'select',
        default: 0,
        options: [
          { label: 'Bottom', value: 0 },
          { label: 'Top', value: 1 },
          { label: 'Left', value: 2 },
          { label: 'Right', value: 3 },
        ],
      },
      softness(0.02, 0.3),
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  vec2 q;
  if (origin < 0.5) q = vec2(p.x, p.y + 0.5);
  else if (origin < 1.5) q = vec2(p.x, 0.5 - p.y);
  else if (origin < 2.5) q = vec2(p.y, p.x + 0.5 * ratio);
  else q = vec2(p.y, 0.5 * ratio - p.x);
  float r = length(q);
  float th = abs(atan(q.x, q.y));
  float aw = px / max(r, px);
  float soft = softness * PI * 0.5 + aw;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float phi = mix(-soft, PI * 0.5 + soft, e);
  float reveal = 1.0 - smoothstep(phi - soft, phi + soft, th);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'barn-doors',
    name: 'Barn Doors',
    category: 'wipe',
    duration: 0.7,
    params: [orientation('Vertical Split', 'Horizontal Split'), openClose, softness(0, 0.5)],
    glsl: `
vec4 transition(vec2 uv) {
  float d = abs((orientation < 0.5 ? uv.x : uv.y) - 0.5) * 2.0;
  float px = orientation < 0.5 ? fwidth(uv.x) : fwidth(uv.y);
  float s = max(softness, px * 1.5);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float edge = mix(-s, 1.0 + s, e);
  float reveal = mode < 0.5
    ? 1.0 - smoothstep(edge - s, edge + s, d)
    : smoothstep(1.0 - edge - s, 1.0 - edge + s, d);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'box-iris',
    name: 'Box Iris',
    category: 'wipe',
    duration: 0.7,
    params: [openClose, softness(0, 0.5)],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 q = abs(uv - 0.5) * 2.0;
  vec2 px = fwidth(uv) * 1.5;
  float e = progress * progress * (3.0 - 2.0 * progress);
  // Evaluate each axis with its own pixel size so both pairs of edges stay equally crisp.
  vec2 s = max(vec2(softness), px);
  vec2 edge = mix(-s, 1.0 + s, e);
  float reveal;
  if (mode < 0.5) {
    vec2 m = 1.0 - smoothstep(edge - s, edge + s, q);
    reveal = m.x * m.y;
  } else {
    vec2 m = 1.0 - smoothstep(1.0 - edge - s, 1.0 - edge + s, q);
    reveal = 1.0 - m.x * m.y;
  }
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'corner-wipe',
    name: 'Corner Wipe',
    category: 'wipe',
    duration: 0.7,
    params: [
      {
        key: 'corner',
        label: 'Corner',
        type: 'select',
        default: 0,
        options: [
          { label: 'Top Left', value: 0 },
          { label: 'Top Right', value: 1 },
          { label: 'Bottom Left', value: 2 },
          { label: 'Bottom Right', value: 3 },
        ],
      },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 0,
        options: [
          { label: 'Diagonal', value: 0 },
          { label: 'Box', value: 1 },
        ],
      },
      softness(0.02, 0.5),
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 q = uv;
  if (mod(corner, 2.0) > 0.5) q.x = 1.0 - q.x;
  if (corner < 1.5) q.y = 1.0 - q.y;
  vec2 px = fwidth(uv) * 1.5;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float reveal;
  if (style < 0.5) {
    // The edge runs exactly from corner to corner half-way through, on any aspect ratio.
    float d = (q.x + q.y) * 0.5;
    float s = max(softness, 0.5 * (px.x + px.y));
    float edge = mix(-s, 1.0 + s, e);
    reveal = 1.0 - smoothstep(edge - s, edge + s, d);
  } else {
    vec2 s = max(vec2(softness), px);
    vec2 edge = mix(-s, 1.0 + s, e);
    vec2 m = 1.0 - smoothstep(edge - s, edge + s, q);
    reveal = m.x * m.y;
  }
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'venetian-blinds',
    name: 'Venetian Blinds',
    category: 'wipe',
    duration: 0.8,
    params: [
      { key: 'count', label: 'Slats', type: 'int', default: 10, min: 2, max: 40, step: 1 },
      orientation('Horizontal', 'Vertical'),
      softness(0.04, 0.5),
    ],
    glsl: `${SAW_REVEAL}
vec4 transition(vec2 uv) {
  float t = (orientation < 0.5 ? 1.0 - uv.y : uv.x) * max(count, 1.0);
  float w = fwidth(t);
  float s = max(softness, w * 0.75);
  float edge = mix(-s, 1.0 + s, progress);
  float reveal = sawReveal(fract(t), edge, s, w * 1.5);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'band-wipe',
    name: 'Band Wipe',
    category: 'wipe',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Bands', type: 'int', default: 6, min: 2, max: 24, step: 1 },
      orientation('Horizontal', 'Vertical'),
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: 0,
        options: [
          { label: 'Alternating', value: 0 },
          { label: 'Cascade', value: 1 },
          { label: 'Random', value: 2 },
        ],
      },
      softness(0.03, 0.5),
    ],
    glsl: `
float bandReveal(float i, float n, float along, float aa) {
  i = clamp(i, 0.0, n - 1.0);
  float delay = 0.0;
  float flip = 0.0;
  if (pattern < 0.5) {
    flip = mod(i, 2.0);
  } else if (pattern < 1.5) {
    delay = i / max(n - 1.0, 1.0);
  } else {
    delay = hash11(i * 7.31 + 2.0);
    flip = step(0.5, hash11(i * 3.17 + 9.0));
  }
  float lp = pattern < 0.5 ? progress : clamp((progress - delay * 0.5) / 0.5, 0.0, 1.0);
  lp = lp * lp * (3.0 - 2.0 * lp);
  float t = flip > 0.5 ? 1.0 - along : along;
  float s = max(softness, aa);
  float edge = mix(-s, 1.0 + s, lp);
  return 1.0 - smoothstep(edge - s, edge + s, t);
}
vec4 transition(vec2 uv) {
  float n = max(count, 1.0);
  bool vert = orientation > 0.5;
  float across = (vert ? uv.x : 1.0 - uv.y) * n;
  float along = vert ? 1.0 - uv.y : uv.x;
  float w = fwidth(across);
  float aa = fwidth(along) * 1.5;
  // Neighbouring bands move independently: blend the two nearest bands across their seam.
  float fa = fract(across);
  float fs = fa > 0.5 ? fa - 1.0 : fa;
  float side = clamp(fs / w * 0.75 + 0.5, 0.0, 1.0);
  float iPlus = floor(across + 0.5);
  float reveal = mix(bandReveal(iPlus - 1.0, n, along, aa), bandReveal(iPlus, n, along, aa), side);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'checker-wipe',
    name: 'Checker Wipe',
    category: 'wipe',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Rows', type: 'int', default: 6, min: 2, max: 24, step: 1 },
      softness(0.03, 0.5),
    ],
    glsl: `${SAW_REVEAL}
vec4 transition(vec2 uv) {
  float n = max(count, 1.0);
  // Square cells on any aspect ratio, centred on the frame.
  vec2 g = vec2((uv.x - 0.5) * ratio, 0.5 - uv.y) * n + vec2(0.0, n * 0.5);
  float w = fwidth(g.y);
  float s = max(softness, w * 0.4);
  float edge = mix(-s, 1.0 + s, progress);
  float fy = fract(g.y);
  float fs = fy > 0.5 ? fy - 1.0 : fy;
  float side = clamp(fs / w * 0.75 + 0.5, 0.0, 1.0);
  float rowPlus = floor(g.y + 0.5);
  // Each wipe spans two cells; odd rows are offset by one cell to form the checkerboard.
  float rp = sawReveal(fract((g.x + rowPlus) * 0.5), edge, s, w * 0.75);
  float rm = sawReveal(fract((g.x + rowPlus - 1.0) * 0.5), edge, s, w * 0.75);
  float reveal = mix(rm, rp, side);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'zigzag-wipe',
    name: 'Zigzag Wipe',
    category: 'wipe',
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
      { key: 'teeth', label: 'Teeth', type: 'int', default: 8, min: 1, max: 40, step: 1 },
      { key: 'depth', label: 'Depth', type: 'float', default: 0.08, min: 0, max: 0.4, step: 0.005 },
      softness(0, 0.3),
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec2 dir = direction < 0.5 ? vec2(-1.0, 0.0) : direction < 1.5 ? vec2(1.0, 0.0) : direction < 2.5 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float len = abs(dir.x) * ratio + abs(dir.y);
  float d = dot(p, dir) / len + 0.5;
  float across = dot(p, vec2(-dir.y, dir.x));
  float tri = abs(fract(across * max(teeth, 1.0)) - 0.5) * 2.0;
  float dep = depth / len;
  float v = d + (tri - 0.5) * dep;
  float s = max(softness, fwidth(v) * 0.75);
  float e = progress * progress * (3.0 - 2.0 * progress);
  float edge = mix(-0.5 * dep - s, 1.0 + 0.5 * dep + s, e);
  float keep = smoothstep(edge - s, edge + s, v);
  return mix(getToColor(uv), getFromColor(uv), keep);
}`,
  },
  {
    id: 'organic-wipe',
    name: 'Organic Wipe',
    category: 'wipe',
    duration: 0.9,
    params: [
      { key: 'angle', label: 'Angle', type: 'float', default: 0, min: 0, max: 360, step: 1, unit: '°' },
      { key: 'roughness', label: 'Roughness', type: 'float', default: 0.45, min: 0, max: 1.5, step: 0.01 },
      { key: 'detail', label: 'Detail', type: 'float', default: 3, min: 0.5, max: 12, step: 0.1 },
      softness(0.02, 0.4),
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float extent = abs(dir.x) * ratio + abs(dir.y);
  float d = dot(p, dir) / extent + 0.5;
  float n = fbm(p * detail + 3.1) * 0.75 + fbm(p * detail * 3.7 + 11.0) * 0.25;
  float v = d + (n - 0.5) * roughness;
  float s = max(softness, fwidth(v) * 0.75);
  float edge = mix(-0.5 * roughness - s, 1.0 + 0.5 * roughness + s, progress);
  float keep = smoothstep(edge - s, edge + s, v);
  return mix(getToColor(uv), getFromColor(uv), keep);
}`,
  },
  {
    id: 'wind-wipe',
    name: 'Wind',
    category: 'wipe',
    duration: 0.9,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 1,
        options: [
          { label: 'Left', value: 0 },
          { label: 'Right', value: 1 },
        ],
      },
      { key: 'size', label: 'Streak Length', type: 'float', default: 0.35, min: 0.05, max: 1, step: 0.01 },
      { key: 'streak', label: 'Streak Width', type: 'float', default: 5, min: 1, max: 40, step: 0.5, unit: 'px' },
      { key: 'drift', label: 'Drift', type: 'float', default: 0.06, min: 0, max: 0.3, step: 0.005 },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float sgn = direction < 0.5 ? -1.0 : 1.0;
  float x = sgn > 0.0 ? uv.x : 1.0 - uv.x;
  // Streak rows are sized against a 1080-line frame so previews and exports match.
  float rows = uv.y * 1080.0 / max(streak, 1.0);
  float n = vnoise(vec2(rows, 3.7)) * 0.6 + vnoise(vec2(rows * 0.21, 9.1)) * 0.4;
  float v = x - n * size;
  float s = max(0.12 * size, fwidth(v) * 0.75);
  float edge = mix(-size - s, 1.0 + s, progress);
  float keep = smoothstep(edge - s, edge + s, v);
  // The outgoing picture is dragged along with the gust while it breaks up.
  vec2 q = vec2(uv.x - sgn * (1.0 - keep) * drift, uv.y);
  return mix(getToColor(uv), getFromColor(q), keep);
}`,
  },
];

export default transitions;
