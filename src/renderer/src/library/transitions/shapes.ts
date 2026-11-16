import type { ParamDef, TransitionDef } from '../types';

const softness = (def = 0, max = 0.3): ParamDef => ({ key: 'softness', label: 'Softness', type: 'float', default: def, min: 0, max, step: 0.005 });

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

const order: ParamDef = {
  key: 'pattern',
  label: 'Order',
  type: 'select',
  default: 0,
  options: [
    { label: 'Center Out', value: 0 },
    { label: 'Left to Right', value: 1 },
    { label: 'Top to Bottom', value: 2 },
    { label: 'Diagonal', value: 3 },
    { label: 'Random', value: 4 },
  ],
};

const stagger: ParamDef = { key: 'stagger', label: 'Stagger', type: 'float', default: 1.5, min: 0, max: 4, step: 0.05 };

/**
 * Shared by the single-shape irises: `sd` is the signed distance (frame heights, negative inside)
 * to the shape at its current size and `grow` runs 0 → 1. The distance is biased by one feather at
 * both ends so the frame is exactly empty at grow = 0 and exactly full at grow = 1.
 */
const SHAPE_LIB = `
float easeIO(float t) {
  return t * t * (3.0 - 2.0 * t);
}
vec4 irisMix(vec2 uv, float sd, float grow, float feather) {
  float inside = 1.0 - smoothstep(-feather, feather, sd + feather * (1.0 - 2.0 * grow));
  // Open: the incoming picture grows inside the shape. Close: the outgoing picture shrinks inside it.
  if (mode < 0.5) return mix(getFromColor(uv), getToColor(uv), inside);
  return mix(getToColor(uv), getFromColor(uv), inside);
}`;

/**
 * Shared by the tiled reveals: every cell grows its own shape from `g` = 0 (cell centre) to 1 (cell
 * border); `lp` is the cell's local progress and `aa` one pixel in g units.
 */
const TILE_LIB = `
float easeIO(float t) {
  return t * t * (3.0 - 2.0 * t);
}
// Local progress of a cell whose place in the reveal order is o (0 = first, 1 = last).
float cellProgress(float o) {
  return easeIO(clamp(progress * (1.0 + stagger) - o * stagger, 0.0, 1.0));
}
float cellReveal(float g, float lp, float aa) {
  return 1.0 - smoothstep(-aa, aa, g - lp + aa * (1.0 - 2.0 * lp));
}`;

/** Place of a grid cell in the reveal order, chosen by the `pattern` param. */
const TILE_ORDER = `
// cc: cell centre in frame heights, centred on the frame. id: integer cell id (for the random order).
float cellOrder(vec2 cc, vec2 id) {
  vec2 n = vec2(cc.x / ratio, cc.y);
  float o;
  if (pattern < 0.5) o = length(cc) / (0.5 * length(vec2(ratio, 1.0)));
  else if (pattern < 1.5) o = n.x + 0.5;
  else if (pattern < 2.5) o = 0.5 - n.y;
  else if (pattern < 3.5) o = 0.5 * (n.x + 0.5) + 0.5 * (0.5 - n.y);
  else o = hash21(id * 1.31 + 7.0);
  return clamp(o, 0.0, 1.0);
}`;

const transitions: TransitionDef[] = [
  {
    id: 'circle-reveal',
    name: 'Circle',
    category: 'shape',
    duration: 0.7,
    params: [
      openClose,
      { key: 'centerX', label: 'Center X', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'centerY', label: 'Center Y', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01 },
      softness(0, 0.5),
      { key: 'borderWidth', label: 'Border Width', type: 'float', default: 0, min: 0, max: 0.1, step: 0.001 },
      { key: 'borderColor', label: 'Border Color', type: 'color', default: '#ffffff' },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 asp = vec2(ratio, 1.0);
  // centerY is measured from the top of the frame.
  vec2 c = vec2(centerX, 1.0 - centerY);
  float d = length((uv - c) * asp);
  // The farthest corner decides when the circle has covered the frame.
  float rmax = length(max(c, 1.0 - c) * asp);
  float s = max(softness * rmax, px);
  float hw = 0.5 * borderWidth;
  float e = progress * progress * (3.0 - 2.0 * progress);
  float grow = mode < 0.5 ? e : 1.0 - e;
  float rad = mix(-s - hw, rmax + s + hw, grow);
  float inner = 1.0 - smoothstep(rad - hw - s, rad - hw + s, d);
  float outer = smoothstep(rad + hw - s, rad + hw + s, d);
  float ring = max(1.0 - inner - outer, 0.0);
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  vec4 inC = mode < 0.5 ? b : a;
  vec4 outC = mode < 0.5 ? a : b;
  return inC * inner + outC * outer + vec4(borderColor, 1.0) * ring;
}`,
  },
  {
    id: 'diamond-reveal',
    name: 'Diamond',
    category: 'shape',
    duration: 0.7,
    params: [openClose, softness(0, 0.5)],
    glsl: `
vec4 transition(vec2 uv) {
  // A diamond with the proportions of the frame: its tips reach the edge midpoints half-way through.
  float g = abs(uv.x - 0.5) + abs(uv.y - 0.5);
  float s = max(softness, fwidth(g));
  float e = progress * progress * (3.0 - 2.0 * progress);
  float rad = mode < 0.5 ? mix(-s, 1.0 + s, e) : mix(1.0 + s, -s, e);
  float inside = 1.0 - smoothstep(rad - s, rad + s, g);
  if (mode < 0.5) return mix(getFromColor(uv), getToColor(uv), inside);
  return mix(getToColor(uv), getFromColor(uv), inside);
}`,
  },
  {
    id: 'polygon-reveal',
    name: 'Polygon',
    category: 'shape',
    duration: 0.8,
    params: [
      openClose,
      { key: 'sides', label: 'Sides', type: 'int', default: 6, min: 3, max: 12, step: 1 },
      { key: 'rotation', label: 'Rotation', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'spin', label: 'Spin', type: 'float', default: 60, min: -360, max: 360, step: 5, unit: '°' },
      softness(0),
    ],
    glsl: `${SHAPE_LIB}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float e = easeIO(progress);
  float grow = mode < 0.5 ? e : 1.0 - e;
  vec2 p = rot2(radians(rotation) + radians(spin) * (1.0 - grow)) * vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = max(floor(sides + 0.5), 3.0);
  float an = PI / n;
  // Fold the angle into one sector; the distance to the nearest side is then r * cos(a).
  float a = mod(atan(p.x, p.y) + an, 2.0 * an) - an;
  float rc = 0.5 * length(vec2(ratio, 1.0));
  float sd = length(p) * cos(a) - grow * rc;
  return irisMix(uv, sd, grow, max(softness, px));
}`,
  },
  {
    id: 'star-reveal',
    name: 'Star',
    category: 'shape',
    duration: 0.8,
    params: [
      openClose,
      { key: 'points', label: 'Points', type: 'int', default: 5, min: 3, max: 16, step: 1 },
      { key: 'inner', label: 'Inner Radius', type: 'float', default: 0.45, min: 0.15, max: 0.9, step: 0.01 },
      { key: 'spin', label: 'Spin', type: 'float', default: 36, min: -360, max: 360, step: 4, unit: '°' },
      softness(0),
    ],
    glsl: `${SHAPE_LIB}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float e = easeIO(progress);
  float grow = mode < 0.5 ? e : 1.0 - e;
  vec2 p = rot2(radians(spin) * (1.0 - grow)) * vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = max(floor(points + 0.5), 3.0);
  float an = PI / n;
  // Fold into half a sector: a = 0 points at a tip, a = an at a notch.
  float a = abs(mod(atan(p.x, p.y) + an, 2.0 * an) - an);
  vec2 q = length(p) * vec2(cos(a), sin(a));
  // Outward normal of the edge that joins the tip (1, 0) to the notch of a unit star.
  float ri = clamp(inner, 0.05, 0.98);
  vec2 ed = ri * vec2(cos(an), sin(an)) - vec2(1.0, 0.0);
  vec2 nrm = normalize(vec2(ed.y, -ed.x));
  // The star is large enough once its notches reach the corners of the frame.
  float send = 0.5 * length(vec2(ratio, 1.0)) / ri;
  float sd = dot(q, nrm) - grow * send * nrm.x;
  return irisMix(uv, sd, grow, max(softness, px));
}`,
  },
  {
    id: 'heart-reveal',
    name: 'Heart',
    category: 'shape',
    duration: 0.8,
    params: [openClose, softness(0)],
    glsl: `${SHAPE_LIB}
// Signed distance to a heart about one unit tall, centred on the origin: a diamond with a circle on
// each of its two upper sides.
float heartSd(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.05;
  float diamond = (p.x + abs(p.y) - 0.5) * 0.70710678;
  float lobe = length(p - vec2(0.25, 0.25)) - 0.35355339;
  return min(diamond, lobe);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float e = easeIO(progress);
  float grow = mode < 0.5 ? e : 1.0 - e;
  // Large enough to swallow the frame corners (the heart's inscribed circle is about 0.36 units).
  float send = 0.5 * length(vec2(ratio, 1.0)) / 0.36;
  float sc = max(grow * send, 1e-4);
  float sd = sc * heartSd(p / sc);
  return irisMix(uv, sd, grow, max(softness, px));
}`,
  },
  {
    id: 'pinwheel',
    name: 'Pinwheel',
    category: 'shape',
    duration: 0.8,
    params: [
      { key: 'blades', label: 'Blades', type: 'int', default: 6, min: 2, max: 24, step: 1 },
      { key: 'spin', label: 'Spin', type: 'float', default: 45, min: -360, max: 360, step: 5, unit: '°' },
      softness(0.02, 0.5),
    ],
    glsl: `
float sawReveal(float f, float edge, float s, float w) {
  float fs = f > 0.5 ? f - 1.0 : f;
  float side = clamp(fs / max(w, 1e-5) + 0.5, 0.0, 1.0);
  float plus = 1.0 - smoothstep(edge - s, edge + s, max(fs, 0.0));
  float minus = 1.0 - smoothstep(edge - s, edge + s, 1.0 + min(fs, 0.0));
  return mix(minus, plus, side);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = max(floor(blades + 0.5), 2.0);
  float r = length(p);
  // Every blade is a small clock wipe; the whole wheel turns while it opens.
  float t = (atan(p.x, p.y) + radians(spin) * progress) / TAU * n;
  float w = n * px / (TAU * max(r, px));
  float s = max(softness, w * 0.75);
  float edge = mix(-s, 1.0 + s, progress);
  float reveal = sawReveal(fract(t), edge, s, w * 1.5);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'hex-reveal',
    name: 'Hexagons',
    category: 'shape',
    duration: 1.0,
    params: [{ key: 'count', label: 'Rows', type: 'int', default: 7, min: 2, max: 30, step: 1 }, order, stagger],
    glsl: `${TILE_LIB}${TILE_ORDER}
// Nearest centre of a pointy-top hexagon lattice (centres one unit apart): xy = offset, zw = centre.
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = (floor(p / s) + 0.5) * s;
  vec2 b = floor(p / s + 0.5) * s;
  vec2 da = p - a;
  vec2 db = p - b;
  return dot(da, da) < dot(db, db) ? vec4(da, a) : vec4(db, b);
}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float n = max(count, 1.0);
  vec4 hc = hexCell(vec2((uv.x - 0.5) * ratio, uv.y - 0.5) * n);
  vec2 q = abs(hc.xy);
  float g = 2.0 * max(q.x, dot(q, vec2(0.5, 0.8660254)));
  float lp = cellProgress(cellOrder(hc.zw / n, hc.zw));
  float reveal = cellReveal(g, lp, 2.0 * n * px);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'polka-dot-reveal',
    name: 'Polka Dots',
    category: 'shape',
    duration: 1.0,
    params: [{ key: 'count', label: 'Rows', type: 'int', default: 9, min: 2, max: 40, step: 1 }, { ...order, default: 3 }, stagger],
    glsl: `${TILE_LIB}${TILE_ORDER}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float n = max(count, 1.0);
  vec2 g = vec2((uv.x - 0.5) * ratio, uv.y - 0.5) * n;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  // A dot has to reach the cell corners (radius 0.707 cells) before the grid closes up.
  float r = length(f) / 0.70710678;
  float lp = cellProgress(cellOrder((id + 0.5) / n, id));
  float reveal = cellReveal(r, lp, n * px / 0.70710678);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'square-reveal',
    name: 'Squares',
    category: 'shape',
    duration: 1.0,
    params: [
      { key: 'count', label: 'Rows', type: 'int', default: 7, min: 2, max: 40, step: 1 },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 0,
        options: [
          { label: 'Squares', value: 0 },
          { label: 'Diamonds', value: 1 },
        ],
      },
      { ...order, default: 3 },
      stagger,
    ],
    glsl: `${TILE_LIB}${TILE_ORDER}
vec4 transition(vec2 uv) {
  float px = fwidth(uv.y);
  float n = max(count, 1.0);
  // Diamonds are the same lattice turned by 45 degrees.
  float turn = style < 0.5 ? 0.0 : PI * 0.25;
  vec2 g = rot2(turn) * vec2((uv.x - 0.5) * ratio, uv.y - 0.5) * n;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float sq = 2.0 * max(abs(f.x), abs(f.y));
  vec2 cc = rot2(-turn) * (id + 0.5) / n;
  float lp = cellProgress(cellOrder(cc, id));
  float reveal = cellReveal(sq, lp, 2.0 * n * px);
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'stripe-reveal',
    name: 'Stripes',
    category: 'shape',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Stripes', type: 'int', default: 10, min: 2, max: 60, step: 1 },
      { key: 'angle', label: 'Angle', type: 'float', default: 45, min: 0, max: 360, step: 1, unit: '°' },
      stagger,
    ],
    glsl: `${TILE_LIB}
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 nrm = vec2(cos(a), sin(a));
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = max(count, 1.0);
  // Stripes lie across 'angle' and open one after another along it, each from its own centre line.
  float t = (dot(p, nrm) / (abs(nrm.x) * ratio + abs(nrm.y)) + 0.5) * n;
  float g = 2.0 * abs(fract(t) - 0.5);
  float lp = cellProgress(clamp((floor(t) + 0.5) / n, 0.0, 1.0));
  float reveal = cellReveal(g, lp, 2.0 * fwidth(t));
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
  {
    id: 'ring-reveal',
    name: 'Rings',
    category: 'shape',
    duration: 0.9,
    params: [
      { key: 'count', label: 'Rings', type: 'int', default: 7, min: 2, max: 40, step: 1 },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 0,
        options: [
          { label: 'Center Out', value: 0 },
          { label: 'Edges In', value: 1 },
        ],
      },
      stagger,
    ],
    glsl: `${TILE_LIB}
vec4 transition(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * ratio, uv.y - 0.5);
  float n = max(count, 1.0);
  // Concentric bands, each opening from its own middle; the outermost band ends at the corners.
  float t = length(p) / (0.5 * length(vec2(ratio, 1.0))) * n;
  float g = 2.0 * abs(fract(t) - 0.5);
  float o = clamp((floor(t) + 0.5) / n, 0.0, 1.0);
  float lp = cellProgress(direction < 0.5 ? o : 1.0 - o);
  float reveal = cellReveal(g, lp, 2.0 * fwidth(t));
  return mix(getFromColor(uv), getToColor(uv), reveal);
}`,
  },
];

export default transitions;
